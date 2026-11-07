const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  bull: '\u2022',
  middot: '\u00b7',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  times: '\u00d7',
  divide: '\u00f7',
};

export function decodeEntities(input) {
  if (!input) return '';
  return String(input).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1].toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
}

export function stripHtml(input) {
  if (!input) return '';
  let text = String(input).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/[\s\u00a0]+/g, ' ').trim();
}

export function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
