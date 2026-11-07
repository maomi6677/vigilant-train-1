import { stripHtml } from './util.mjs';

const SEARCH_ENDPOINT = 'https://search-api-web.eastmoney.com/search/jsonp';

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function decodeBuffer(buffer, contentType) {
  const charset = (String(contentType).match(/charset=["']?([^;"'\s]+)/i)?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function absoluteDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const iso = text.includes('T') ? text : `${text.replace(' ', 'T')}+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeArticleUrl(raw) {
  try {
    const url = new URL(raw);
    // 东财同一篇文章的 futures 子站经常只渲染摘要，统一走 finance 主站。
    if (url.hostname === 'futures.eastmoney.com') url.hostname = 'finance.eastmoney.com';
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * 东方财富资讯搜索（无需 API key）。
 */
export async function searchNews(keyword, { page = 1, pageSize = 20, timeout = 15000 } = {}) {
  const param = {
    uid: '',
    keyword,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'time',
        pageIndex: page,
        pageSize,
        preTag: '',
        postTag: '',
      },
    },
  };

  const url = `${SEARCH_ENDPOINT}?cb=cb&param=${encodeURIComponent(JSON.stringify(param))}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, referer: 'https://so.eastmoney.com/' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`搜索接口 HTTP ${res.status}`);

  const body = await res.text();
  const start = body.indexOf('(');
  const end = body.lastIndexOf(')');
  const json = JSON.parse(start >= 0 && end > start ? body.slice(start + 1, end) : body);
  const rows = json?.result?.cmsArticleWebOld || [];

  return rows.map((row) => ({
    id: String(row.code || ''),
    title: stripHtml(row.title || ''),
    url: normalizeArticleUrl(row.url || ''),
    originalUrl: row.url || '',
    media: stripHtml(row.mediaName || ''),
    publishedAt: absoluteDate(row.date),
    snippet: stripHtml(row.content || ''),
  }));
}

/**
 * 抓取文章正文纯文本。
 */
export async function fetchArticle(url, { timeout = 20000 } = {}) {
  const res = await fetch(url, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const html = decodeBuffer(buffer, res.headers.get('content-type') || '');
  return { html, text: extractMainText(html) };
}

function extractMainText(html) {
  let scope = html;
  const start = scope.search(/id="ContentBody"|class="txtinfos"/i);
  if (start >= 0) {
    scope = scope.slice(start);
    const end = scope.search(/id="ContentRelated"|class="foot"|id="contentRelated"/i);
    if (end > 0) scope = scope.slice(0, end);
    else scope = scope.slice(0, 20000);
  }
  return stripHtml(scope);
}
