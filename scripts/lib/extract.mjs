import { stripHtml } from './util.mjs';

const PROVIDER_RULES = [
  { key: 'sci99', test: /卓创/ },
  { key: 'mysteel', test: /钢联|mysteel/i },
];

const TOTAL_PATTERN = /(?:冷库)?(?:库存量|入库量)(?:为|达到|约|达)?\s*([\d.]+)\s*万吨/;

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[。；;！？])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function detectProvider(sentence, previous) {
  const context = `${previous || ''} ${sentence}`;
  for (const rule of PROVIDER_RULES) {
    if (rule.test.test(context)) return rule.key;
  }
  return 'unknown';
}

function resolveDate(month, day, articleDate) {
  if (!articleDate || Number.isNaN(articleDate.getTime())) return null;
  const year = articleDate.getUTCFullYear();
  let date = new Date(Date.UTC(year, month - 1, day));
  if (date.getTime() > articleDate.getTime() + 2 * 86400000) {
    date = new Date(Date.UTC(year - 1, month - 1, day));
  }
  return date.toISOString().slice(0, 10);
}

function parseDate(sentence, articleDate) {
  const full = sentence.match(/截至\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (full) {
    return {
      date: `${full[1]}-${String(full[2]).padStart(2, '0')}-${String(full[3]).padStart(2, '0')}`,
      inferred: false,
    };
  }
  const short = sentence.match(/截至\s*(\d{1,2})月(\d{1,2})日/);
  if (short) {
    return { date: resolveDate(Number(short[1]), Number(short[2]), articleDate), inferred: false };
  }
  if (/本周|周度|当周/.test(sentence) && articleDate && !Number.isNaN(articleDate.getTime())) {
    const date = new Date(articleDate.getTime() - 86400000);
    return { date: date.toISOString().slice(0, 10), inferred: true };
  }
  return { date: null, inferred: false };
}

/**
 * 从一篇资讯正文里抽取所有「苹果冷库库存量」数据点。
 * 同一篇可能同时给出钢联和卓创两个口径，分别返回。
 */
export function extractPoints(text, article = {}) {
  const articleDate = article.date instanceof Date ? article.date : null;
  const context = `${article.title || ''} ${article.snippet || ''}`;
  const sentences = splitSentences(stripHtml(text));
  const points = [];

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (!/万吨/.test(sentence)) continue;
    if (!/(库存量|入库量)/.test(sentence)) continue;
    if (!/苹果/.test(sentence) && !/苹果/.test(context)) continue;

    const totalMatch = sentence.match(TOTAL_PATTERN);
    if (!totalMatch) continue;
    const total = Number.parseFloat(totalMatch[1]);
    if (!(total >= 50 && total <= 2500)) continue;

    const { date, inferred } = parseDate(sentence, articleDate);
    if (!date) continue;

    const provider = detectProvider(sentence, sentences[index - 1]);
    const point = { date, provider, total, inferred };

    const delta = sentence.match(/(?:较去年同期|同比)(增加|增|上升|上涨|下降|减少|回落|低|少)?\s*([\d.]+)\s*万吨/);
    if (delta) {
      const negative = /减少|下降|回落|低|少/.test(delta[1] || '');
      point.yoyDelta = (negative ? -1 : 1) * Number.parseFloat(delta[2]);
    }

    const pct = sentence.match(/(增幅|涨幅|降幅|同比(?:增长|增加|上涨|下降|减少))\s*([\d.]+)%/);
    if (pct) {
      const negative = /降幅|下降|减少/.test(pct[1]);
      point.yoyPct = (negative ? -1 : 1) * Number.parseFloat(pct[2]);
    }

    const lastYear = sentence.match(/去年同期[（(][^)）]{0,40}?([\d.]+)\s*万吨[)）]/);
    if (lastYear) point.lastYear = Number.parseFloat(lastYear[1]);

    const ratio = sentence.match(/山东产区库容比为\s*([\d.]+)%/);
    if (ratio) point.shandongRatio = Number.parseFloat(ratio[1]);

    point.evidence = sentence.slice(0, 240);
    points.push(point);
  }

  // 同一篇里「其他口径」与已具名口径数值相同，视为重复。
  return points.filter((point) => {
    if (point.provider !== 'unknown') return true;
    return !points.some(
      (other) =>
        other !== point &&
        other.provider !== 'unknown' &&
        other.date === point.date &&
        Math.abs(other.total - point.total) < 0.01,
    );
  });
}

export function pointScore(point) {
  let score = 0;
  if (point.date) score += 2;
  if (point.total) score += 1;
  if (point.provider && point.provider !== 'unknown') score += 1;
  if (point.yoyPct != null || point.yoyDelta != null) score += 2;
  if (point.lastYear != null) score += 1;
  return score;
}
