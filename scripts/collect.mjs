#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPoints, pointScore } from './lib/extract.mjs';
import { fetchArticle, searchNews } from './lib/search.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'sources.json');
const MANUAL_PATH = path.join(ROOT, 'config', 'manual-data.json');
const DATA_DIR = path.join(ROOT, 'docs', 'data');
const POINTS_PATH = path.join(DATA_DIR, 'points.json');
const ARTICLES_PATH = path.join(DATA_DIR, 'articles.json');
const META_PATH = path.join(DATA_DIR, 'meta.json');

const DRY_RUN = process.argv.includes('--dry-run');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  const parsed = Number(hit.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function pointKey(point) {
  return `${point.provider}|${point.date}`;
}

function comparePoints(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const order = { mysteel: 0, sci99: 1, unknown: 2 };
  return (order[a.provider] ?? 9) - (order[b.provider] ?? 9);
}

function compact(point) {
  const result = {
    date: point.date,
    provider: point.provider || 'unknown',
    total: Number(point.total.toFixed(2)),
  };
  for (const key of ['yoyDelta', 'yoyPct', 'lastYear', 'shandongRatio']) {
    if (point[key] != null && Number.isFinite(Number(point[key]))) result[key] = Number(point[key]);
  }
  // 由同比增减量反推去年同期和同比百分比，便于对比展示。
  if (result.lastYear == null && result.yoyDelta != null) {
    result.lastYear = Number((result.total - result.yoyDelta).toFixed(2));
  }
  if (result.yoyPct == null && result.yoyDelta != null && result.lastYear) {
    result.yoyPct = Number(((result.yoyDelta / result.lastYear) * 100).toFixed(2));
  }
  if (point.inferred) result.inferred = true;
  if (point.manual) result.manual = true;
  if (point.evidence) result.evidence = point.evidence;
  if (point.sourceTitle) result.sourceTitle = point.sourceTitle;
  if (point.sourceUrl) result.sourceUrl = point.sourceUrl;
  if (point.sourceMedia) result.sourceMedia = point.sourceMedia;
  if (point.collectedAt) result.collectedAt = point.collectedAt;
  return result;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const pages = arg('pages', Number(config.pagesPerRun) || 4);
  const maxAgeDays = arg('max-age', Number(config.maxAgeDays) || 14);
  const maxArticles = arg('max-articles', Number(config.maxArticles) || 40);
  const queries = Array.isArray(config.queries) ? config.queries.filter(Boolean) : [];
  if (!queries.length) throw new Error('config/sources.json 里没有配置 queries');

  const previousPoints = await readJson(POINTS_PATH, { points: [] });
  const previousArticles = await readJson(ARTICLES_PATH, { articles: [] });
  const cutoff = Date.now() - maxAgeDays * 86400000;

  log(`搜索 ${queries.length} 组关键词 × ${pages} 页`);

  const candidates = new Map();
  const searchErrors = [];

  for (const query of queries) {
    try {
      const pagesToScan = await mapLimit(
        Array.from({ length: pages }, (_, index) => index + 1),
        4,
        async (page) => {
          try {
            return { page, rows: await searchNews(query, { page }) };
          } catch (error) {
            return { page, error };
          }
        },
      );
      for (const result of pagesToScan) {
        if (result.error) {
          searchErrors.push(`${query} 第 ${result.page} 页：${result.error.message}`);
          continue;
        }
        for (const row of result.rows) {
          if (!row.publishedAt || row.publishedAt.getTime() < cutoff) continue;
          const haystack = `${row.title} ${row.snippet}`;
          if (!/苹果/.test(haystack)) continue;
          if (!/冷库|入库量|库存量|库容比/.test(haystack)) continue;
          if (!candidates.has(row.url)) candidates.set(row.url, row);
        }
      }
      log(`「${query}」累计候选 ${candidates.size} 篇`);
    } catch (error) {
      searchErrors.push(`${query}：${error.message}`);
      log(`搜索失败：${query} ${error.message}`);
    }
  }

  if (!candidates.size && searchErrors.length) {
    log('搜索全部失败，保留原数据。');
    process.exitCode = 1;
    return;
  }

  const selected = [...candidates.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, maxArticles);

  log(`抓取 ${selected.length} 篇候选正文`);

  let fetched = 0;
  const failures = [];
  const extracted = [];

  await mapLimit(selected, 5, async (item, index) => {
    try {
      let { text } = await fetchArticle(item.url);
      let points = extractPoints(text, { date: item.publishedAt, title: item.title, snippet: item.snippet });

      if (!points.length && item.originalUrl && item.originalUrl !== item.url) {
        const fallback = await fetchArticle(item.originalUrl);
        points = extractPoints(fallback.text, {
          date: item.publishedAt,
          title: item.title,
          snippet: item.snippet,
        });
      }

      fetched += 1;
      if (points.length) {
        extracted.push({ item, points });
        log(`  + ${item.publishedAt.toISOString().slice(0, 10)} ${item.media}：${points.length} 个数据点`);
      }
      if ((index + 1) % 20 === 0) log(`  进度 ${index + 1}/${selected.length}`);
    } catch (error) {
      failures.push(`${item.url} ${error.message}`);
    }
  });

  const pointMap = new Map();
  for (const point of previousPoints.points || []) {
    if (point?.date && point?.total && !point.manual) pointMap.set(pointKey(point), point);
  }

  const collectedAt = new Date().toISOString();
  let added = 0;

  for (const { item, points } of extracted) {
    for (const point of points) {
      const record = compact({
        ...point,
        sourceTitle: item.title,
        sourceUrl: item.url,
        sourceMedia: item.media,
        collectedAt,
      });
      const old = pointMap.get(pointKey(record));
      if (!old || pointScore(record) > pointScore(old)) {
        pointMap.set(pointKey(record), record);
        if (!old) added += 1;
      }
    }
  }

  const manual = await readJson(MANUAL_PATH, []);
  let manualCount = 0;
  for (const entry of Array.isArray(manual) ? manual : []) {
    if (!entry?.date || !entry?.total) continue;
    const record = compact({
      provider: entry.provider || 'unknown',
      ...entry,
      manual: true,
      collectedAt: entry.collectedAt || collectedAt,
      evidence: entry.note || entry.evidence,
    });
    pointMap.set(pointKey(record), record);
    manualCount += 1;
  }

  const all = [...pointMap.values()].filter(
    (point) =>
      /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number(point.total) >= 50 && Number(point.total) <= 2500,
  );

  // 苹果产季从 9 月开始，避免把上一季的尾库混进本季入库曲线。
  const now = new Date();
  const seasonYear = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const seasonStart = config.seasonStart || `${seasonYear}-09-01`;
  const seasonLabel = `${seasonStart.slice(0, 4)}/${String(Number(seasonStart.slice(0, 4)) + 1).slice(2)}`;

  // 同一天同数值的「其他口径」并入具名口径，避免重复展示。
  const points = all
    .filter((point) => point.date >= seasonStart)
    .filter(
      (point) =>
        point.provider !== 'unknown' ||
        !all.some(
          (other) =>
            other.provider !== 'unknown' &&
            other.date === point.date &&
            Math.abs(Number(other.total) - Number(point.total)) < 0.01,
        ),
    )
    .sort(comparePoints);

  const articleMap = new Map();
  for (const article of previousArticles.articles || []) {
    if (article?.url) articleMap.set(article.url, article);
  }
  for (const { item, points: articlePoints } of extracted) {
    articleMap.set(item.url, {
      title: item.title,
      url: item.url,
      media: item.media,
      publishedAt: item.publishedAt.toISOString(),
      points: articlePoints.length,
      collectedAt,
    });
  }
  const articles = [...articleMap.values()]
    .filter((article) => String(article.publishedAt || '').slice(0, 10) >= seasonStart)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 200);

  const latestDate = points.reduce((max, point) => (point.date > max ? point.date : max), '');
  const meta = {
    title: config.title || '苹果入库数据',
    subtitle: config.subtitle || '',
    updatedAt: collectedAt,
    latestDate: latestDate || null,
    seasonStart,
    seasonLabel,
    totalPoints: points.length,
    newPoints: added,
    manualPoints: manualCount,
    scanned: candidates.size,
    fetched,
    failed: failures.length,
    queries,
    pagesPerRun: pages,
    providers: config.providers || {},
    searchErrors,
  };

  log(`新增 ${added} 个数据点 · 累计 ${points.length} 个 · 最新 ${latestDate || '无'}`);

  if (DRY_RUN) {
    log('--dry-run：不写入文件');
    for (const point of points.slice(0, 8)) {
      log(`  ${point.date} ${point.provider} ${point.total} 万吨 同比 ${point.yoyPct ?? '-'}%`);
    }
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(POINTS_PATH, `${JSON.stringify({ updatedAt: collectedAt, points }, null, 2)}\n`, 'utf8');
  await writeFile(ARTICLES_PATH, `${JSON.stringify({ updatedAt: collectedAt, articles }, null, 2)}\n`, 'utf8');
  await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  log('已写入 docs/data/points.json、articles.json、meta.json');

  if (points.length) {
    console.log('\n最近数据点：');
    for (const point of points.slice(0, 6)) {
      console.log(
        `  ${point.date}  ${point.provider.padEnd(8)} ${String(point.total).padStart(7)} 万吨  ` +
          `同比 ${point.yoyPct != null ? `${point.yoyPct}%` : '-'}  ${point.sourceMedia || ''}`,
      );
    }
  }
}

main().catch((error) => {
  console.error('采集失败：', error);
  process.exitCode = 1;
});
