const PROVIDERS = {
  mysteel: { name: '钢联 Mysteel', short: '钢联', color: '#7aa2ff' },
  sci99: { name: '卓创资讯', short: '卓创', color: '#4fd6b8' },
  unknown: { name: '其他口径', short: '其他', color: '#b79cff' },
};

const ORDER = ['mysteel', 'sci99', 'unknown'];

const els = {
  title: document.querySelector('#page-title'),
  subtitle: document.querySelector('#page-subtitle'),
  updated: document.querySelector('#updated'),
  refresh: document.querySelector('#refresh'),
  banner: document.querySelector('#banner'),
  season: document.querySelector('#season'),
  latestDate: document.querySelector('#latest-date'),
  metrics: document.querySelector('#metrics'),
  diffNote: document.querySelector('#diff-note'),
  compare: document.querySelector('#compare'),
  comparePanel: document.querySelector('#compare-panel'),
  legend: document.querySelector('#legend'),
  chart: document.querySelector('#chart'),
  chartPanel: document.querySelector('#chart-panel'),
  tableBody: document.querySelector('#table-body'),
  tablePanel: document.querySelector('#table-panel'),
  sources: document.querySelector('#sources'),
  sourcesPanel: document.querySelector('#sources-panel'),
};

const state = {
  points: [],
  meta: null,
  articles: [],
  loading: false,
  updatedAt: null,
};

function providerInfo(key) {
  return PROVIDERS[key] || { name: key || '未知口径', short: key || '未知', color: '#b79cff' };
}

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function fmtDelta(value) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(2)} 万吨`;
}

function formatRelative(value) {
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatAbsolute(value) {
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function groupByDate(points) {
  const map = new Map();
  for (const point of points) {
    if (!map.has(point.date)) map.set(point.date, {});
    map.get(point.date)[point.provider] = point;
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, providers]) => ({ date, ...providers }));
}

function tagFor(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) {
    return { text: '同比待补充', cls: 'tag-neutral' };
  }
  if (pct >= 10) return { text: '同比明显偏高 · 抛压偏大', cls: 'tag-warn' };
  if (pct >= 0) return { text: '同比略高 · 中性偏空', cls: 'tag-warn' };
  if (pct > -10) return { text: '同比略低 · 中性偏多', cls: 'tag-good' };
  return { text: '同比明显偏低 · 近月有修复空间', cls: 'tag-good' };
}

function showBanner(message) {
  els.banner.textContent = message;
  els.banner.hidden = false;
}

function hideBanner() {
  els.banner.textContent = '';
  els.banner.hidden = true;
}

async function load({ silent = false } = {}) {
  if (state.loading) return false;
  state.loading = true;
  els.refresh.classList.add('is-busy');
  els.refresh.disabled = true;

  try {
    const stamp = Date.now();
    const [pointsRes, metaRes, articlesRes] = await Promise.all([
      fetch(`./data/points.json?v=${stamp}`, { cache: 'no-store' }),
      fetch(`./data/meta.json?v=${stamp}`, { cache: 'no-store' }).catch(() => null),
      fetch(`./data/articles.json?v=${stamp}`, { cache: 'no-store' }).catch(() => null),
    ]);
    if (!pointsRes.ok) throw new Error(`HTTP ${pointsRes.status}`);

    const payload = await pointsRes.json();
    state.points = Array.isArray(payload.points) ? payload.points : [];
    state.meta = metaRes && metaRes.ok ? await metaRes.json().catch(() => null) : null;
    const articlePayload = articlesRes && articlesRes.ok ? await articlesRes.json().catch(() => null) : null;
    state.articles = Array.isArray(articlePayload?.articles) ? articlePayload.articles : [];
    state.updatedAt = Date.now();

    hideBanner();
    renderAll();
    return true;
  } catch (error) {
    const suffix = silent ? '显示的是上次加载的数据。' : '请稍后重试，或检查 GitHub Actions 是否正常。';
    showBanner(`加载失败：${error.message}。${suffix}`);
    return false;
  } finally {
    state.loading = false;
    els.refresh.classList.remove('is-busy');
    els.refresh.disabled = false;
  }
}

function renderAll() {
  renderHeader();
  renderHero();
  renderCompare();
  renderChart();
  renderTable();
  renderSources();
}

function renderHeader() {
  const meta = state.meta;
  if (meta?.title) {
    document.title = meta.title;
    els.title.textContent = meta.title;
  }
  if (meta?.subtitle) els.subtitle.textContent = meta.subtitle;
  if (meta?.updatedAt) {
    els.updated.textContent = `更新于 ${formatRelative(meta.updatedAt)}`;
    els.updated.title = `上次更新：${formatAbsolute(meta.updatedAt)}`;
  }
}

function renderHero() {
  const groups = groupByDate(state.points);
  const latest = groups[0];

  els.season.textContent = state.meta?.seasonLabel ? `${state.meta.seasonLabel} 产季` : '当前产季';
  els.metrics.replaceChildren();

  if (!latest) {
    els.latestDate.textContent = '暂无数据';
    const empty = document.createElement('p');
    empty.className = 'hero-note';
    empty.textContent = '还没有抓到入库数据。可以稍后刷新，或在 config/manual-data.json 里手工补录。';
    els.metrics.append(empty);
    els.diffNote.textContent = '';
    return;
  }

  els.latestDate.textContent = `数据截至 ${latest.date}`;

  const present = ORDER.filter((key) => latest[key]);
  for (const key of present) {
    const point = latest[key];
    const info = providerInfo(key);

    const card = document.createElement('article');
    card.className = 'metric';
    card.style.setProperty('--metric-color', info.color);

    const head = document.createElement('div');
    head.className = 'metric-head';
    const dot = document.createElement('span');
    dot.className = 'metric-dot';
    const name = document.createElement('span');
    name.textContent = info.name;
    head.append(dot, name);

    if (point.manual) {
      const badge = document.createElement('span');
      badge.className = 'metric-badge';
      badge.textContent = '手工补录';
      head.append(badge);
    }

    const value = document.createElement('div');
    value.className = 'metric-value';
    value.textContent = fmt(point.total);
    const unit = document.createElement('span');
    unit.textContent = '万吨';
    value.append(unit);

    const delta = document.createElement('div');
    delta.className = 'metric-delta';
    if (point.yoyPct != null || point.yoyDelta != null) {
      const isDown = (point.yoyPct ?? point.yoyDelta ?? 0) < 0;
      delta.classList.add(isDown ? 'is-down' : 'is-up');
      const pct = document.createElement('b');
      pct.textContent = fmtPct(point.yoyPct);
      delta.append('同比 ', pct);
      if (point.yoyDelta != null) delta.append(` · ${fmtDelta(point.yoyDelta)}`);
    } else {
      delta.textContent = '同比数据待补充';
    }

    const tag = tagFor(point.yoyPct);
    const tagEl = document.createElement('span');
    tagEl.className = `metric-tag ${tag.cls}`;
    tagEl.textContent = tag.text;

    card.append(head, value, delta, tagEl);
    els.metrics.append(card);
  }

  const mysteel = latest.mysteel;
  const sci99 = latest.sci99;
  if (mysteel && sci99) {
    const diff = sci99.total - mysteel.total;
    els.diffNote.textContent = `两口径相差 ${fmt(Math.abs(diff))} 万吨（${diff >= 0 ? '卓创高于钢联' : '钢联高于卓创'}），主要分歧在山东入库统计，不要混用。`;
  } else if (present.length === 1) {
    els.diffNote.textContent = '另一口径暂未获取到，可查看下方来源里的研报原文。';
  } else {
    els.diffNote.textContent = '';
  }
}

function renderCompare() {
  const groups = groupByDate(state.points);
  const latest = groups[0];
  els.compare.replaceChildren();

  if (!latest) {
    els.comparePanel.hidden = true;
    return;
  }

  const rows = ORDER.filter((key) => latest[key] && latest[key].lastYear != null).map((key) => ({
    key,
    info: providerInfo(key),
    current: latest[key].total,
    last: latest[key].lastYear,
  }));

  if (!rows.length) {
    els.comparePanel.hidden = true;
    return;
  }
  els.comparePanel.hidden = false;

  const max = Math.max(...rows.flatMap((row) => [row.current, row.last]));

  for (const row of rows) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cmp-row';

    const label = document.createElement('span');
    label.className = 'cmp-name';
    label.textContent = row.info.short;

    const bars = document.createElement('div');
    bars.className = 'cmp-bars';

    for (const [kind, value, text] of [
      ['current', row.current, '本期'],
      ['last', row.last, '去年'],
    ]) {
      const bar = document.createElement('div');
      bar.className = 'cmp-bar';
      const fill = document.createElement('span');
      fill.className = `cmp-fill${kind === 'last' ? ' is-last' : ''}`;
      fill.style.width = `${Math.max((value / max) * 100, 2)}%`;
      if (kind === 'current') fill.style.background = row.info.color;
      const textEl = document.createElement('span');
      textEl.className = 'cmp-label';
      const tag = document.createElement('em');
      tag.textContent = text;
      textEl.append(tag, `${fmt(value)} 万吨`);
      bar.append(fill, textEl);
      bars.append(bar);
    }

    wrapper.append(label, bars);
    els.compare.append(wrapper);
  }
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function renderChart() {
  els.legend.replaceChildren();
  const groups = groupByDate(state.points);
  const dateKeys = groups.map((group) => group.date).sort();
  const present = ORDER.filter((key) => state.points.some((point) => point.provider === key));

  for (const key of present) {
    const info = providerInfo(key);
    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = info.color;
    item.append(dot, info.name);
    els.legend.append(item);
  }

  els.chart.replaceChildren();

  if (dateKeys.length < 2) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent =
      dateKeys.length === 0
        ? '暂无数据，抓取到第一期后即可显示。'
        : '目前只有 1 期数据，下一期入库数据出来后会自动生成趋势线。';
    els.chart.append(empty);
    return;
  }

  const width = 800;
  const height = 260;
  const pad = { left: 58, right: 18, top: 18, bottom: 34 };
  const values = state.points.map((point) => Number(point.total));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, 30);
  const yMin = Math.max(0, Math.floor((rawMin - span * 0.2) / 10) * 10);
  const yMax = Math.ceil((rawMax + span * 0.2) / 10) * 10;
  const yRange = yMax - yMin || 1;

  const x = (index) => pad.left + (index / (dateKeys.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - yMin) / yRange) * (height - pad.top - pad.bottom);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': '苹果冷库库存趋势图',
  });

  for (let step = 0; step <= 4; step += 1) {
    const value = yMin + (yRange * step) / 4;
    const yPos = y(value);
    svg.append(
      svgEl('line', {
        x1: pad.left,
        y1: yPos,
        x2: width - pad.right,
        y2: yPos,
        stroke: '#222731',
        'stroke-width': 1,
      }),
    );
    const label = svgEl('text', {
      x: pad.left - 10,
      y: yPos + 4,
      'text-anchor': 'end',
      fill: '#79818f',
      'font-size': 11,
    });
    label.textContent = `${Math.round(value)}`;
    svg.append(label);
  }

  const stepSize = Math.ceil(dateKeys.length / 6);
  dateKeys.forEach((date, index) => {
    if (index % stepSize !== 0 && index !== dateKeys.length - 1) return;
    const label = svgEl('text', {
      x: x(index),
      y: height - 10,
      'text-anchor': 'middle',
      fill: '#79818f',
      'font-size': 11,
    });
    label.textContent = date.slice(5);
    svg.append(label);
  });

  for (const key of present) {
    const info = providerInfo(key);
    const series = state.points
      .filter((point) => point.provider === key)
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    if (series.length > 1) {
      const d = series
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(dateKeys.indexOf(point.date))} ${y(point.total)}`)
        .join(' ');
      svg.append(
        svgEl('path', {
          d,
          fill: 'none',
          stroke: info.color,
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }

    for (const point of series) {
      const cx = x(dateKeys.indexOf(point.date));
      const cy = y(point.total);
      const circle = svgEl('circle', {
        cx,
        cy,
        r: 3.6,
        fill: '#11141a',
        stroke: info.color,
        'stroke-width': 2,
      });
      const title = svgEl('title');
      title.textContent = `${point.date} ${info.name} ${fmt(point.total)} 万吨`;
      circle.append(title);
      svg.append(circle);

      if (series.length <= 8) {
        const label = svgEl('text', {
          x: cx,
          y: cy - 10,
          'text-anchor': 'middle',
          fill: info.color,
          'font-size': 10.5,
        });
        label.textContent = fmt(point.total, 0);
        svg.append(label);
      }
    }
  }

  els.chart.append(svg);
}

function renderTable() {
  const groups = groupByDate(state.points);
  els.tableBody.replaceChildren();

  if (!groups.length) {
    els.tablePanel.hidden = true;
    return;
  }
  els.tablePanel.hidden = false;

  for (const group of groups) {
    const row = document.createElement('tr');

    const dateCell = document.createElement('td');
    dateCell.className = 'strong';
    dateCell.textContent = group.date;

    row.append(dateCell);

    for (const key of ['mysteel', 'sci99']) {
      const point = group[key];
      const valueCell = document.createElement('td');
      valueCell.className = point ? 'strong' : 'muted';
      if (point) {
        valueCell.textContent = fmt(point.total);
        if (point.manual) {
          const mark = document.createElement('span');
          mark.className = 'manual-mark';
          mark.textContent = '*';
          mark.title = '手工补录';
          valueCell.append(mark);
        }
      } else {
        valueCell.textContent = '—';
      }

      const yoyCell = document.createElement('td');
      const pct = point?.yoyPct;
      if (pct != null) {
        yoyCell.textContent = fmtPct(pct);
        yoyCell.className = pct >= 0 ? 'up' : 'down';
      } else {
        yoyCell.textContent = '—';
        yoyCell.className = 'muted';
      }

      row.append(valueCell, yoyCell);
    }

    const diffCell = document.createElement('td');
    if (group.mysteel && group.sci99) {
      diffCell.textContent = fmt(group.sci99.total - group.mysteel.total);
    } else {
      diffCell.textContent = '—';
      diffCell.className = 'muted';
    }
    row.append(diffCell);

    els.tableBody.append(row);
  }
}

function renderSources() {
  const map = new Map();
  for (const point of state.points) {
    if (!point.sourceUrl) continue;
    map.set(point.sourceUrl, {
      title: point.sourceTitle || '来源',
      url: point.sourceUrl,
      media: point.sourceMedia || '',
      date: point.date,
      points: 1,
    });
  }
  for (const article of state.articles) {
    if (!article?.url) continue;
    const existing = map.get(article.url) || {};
    map.set(article.url, {
      ...existing,
      title: article.title || existing.title || '来源',
      media: article.media || existing.media || '',
      date: existing.date || (article.publishedAt ? String(article.publishedAt).slice(0, 10) : ''),
      points: article.points || existing.points || 1,
    });
  }

  const list = [...map.values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 15);

  els.sources.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('li');
    empty.className = 'source-meta';
    empty.textContent = '暂无来源记录。';
    els.sources.append(empty);
    return;
  }

  for (const item of list) {
    const li = document.createElement('li');
    li.className = 'source-item';
    const link = document.createElement('a');
    link.href = /^https?:\/\//i.test(item.url) ? item.url : '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.title;
    const meta = document.createElement('div');
    meta.className = 'source-meta';
    meta.textContent = [item.media, item.date, item.points ? `${item.points} 个数据点` : '']
      .filter(Boolean)
      .join(' · ');
    li.append(link, meta);
    els.sources.append(li);
  }
}

function tick() {
  if (state.meta?.updatedAt) {
    els.updated.textContent = `更新于 ${formatRelative(state.meta.updatedAt)}`;
  }
}

els.refresh.addEventListener('click', () => load());
window.setInterval(tick, 30_000);
window.setInterval(() => {
  if (document.visibilityState === 'visible') load({ silent: true });
}, 10 * 60_000);

load();
