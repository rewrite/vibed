/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/"/gi, '"')
    .replace(/&#39;|'/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)));
}

/**
 * @param {number} code
 * @returns {string}
 */
function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * @param {string} tag
 * @param {string} name
 * @returns {string | null}
 */
function attr(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s\"'=<>]+)", "i");
  const match = tag.match(re);
  if (!match) return null;
  let value = match[1];
  if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, -1);
  return decodeEntities(value);
}

/**
 * @param {string} title
 * @returns {string}
 */
export function letterIcon(title) {
  const raw = (title || "?").trim().charAt(0).toUpperCase() || "?";
  const letter = raw.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#222"/>' +
    '<text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#fff">' +
    letter +
    "</text></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @returns {{ title: string, iconUrls: string[], appleUrls: string[] }}
 */
export function parsePageIdentity(html, baseUrl) {
  const title = parseTitle(html);
  const base = resolveBase(html, baseUrl);
  /** @type {{ href: string, size: number, apple: boolean }[]} */
  const found = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const tokens = rel.split(/\s+/).filter(Boolean);
    if (tokens.includes("mask-icon") || tokens.includes("prefetch") || tokens.includes("dns-prefetch")) continue;
    const apple = tokens.some((token) => token.includes("apple-touch"));
    const icon = tokens.includes("icon") || tokens.includes("shortcut");
    if (!apple && !icon) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    let absolute;
    try {
      absolute = new URL(href, base).href;
    } catch {
      continue;
    }
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) continue;
    found.push({ href: absolute, size: iconSize(attr(tag, "sizes")), apple });
  }
  found.sort((a, b) => {
    if (a.apple !== b.apple) return a.apple ? 1 : -1;
    return rankSize(a.size) - rankSize(b.size);
  });
  /** @type {string[]} */
  const iconUrls = [];
  /** @type {string[]} */
  const appleUrls = [];
  for (const icon of found) {
    const list = icon.apple ? appleUrls : iconUrls;
    if (!list.includes(icon.href)) list.push(icon.href);
  }
  return { title, iconUrls, appleUrls };
}

/**
 * @param {string} html
 * @returns {string}
 */
function parseTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveBase(html, baseUrl) {
  const match = html.match(/<base\b[^>]*>/i);
  if (!match) return baseUrl;
  const href = attr(match[0], "href");
  if (!href) return baseUrl;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return baseUrl;
  }
}

/**
 * @param {string | null} sizes
 * @returns {number}
 */
function iconSize(sizes) {
  if (!sizes) return 0;
  if (sizes.toLowerCase() === "any") return 256;
  let max = 0;
  for (const part of sizes.split(/\s+/)) {
    const value = parseInt(part, 10);
    if (value > max) max = value;
  }
  return max;
}

/**
 * @param {number} size
 * @returns {number}
 */
function rankSize(size) {
  if (!size) return 24;
  return Math.abs(size - 48);
}

/**
 * Order matches what a browser tab shows: declared rel="icon" links first
 * (PNG/SVG before ICO), then /favicon.ico, then apple-touch icons as a last resort.
 * @param {string[]} urls rel="icon" / "shortcut icon" URLs
 * @param {string} pageUrl
 * @param {string[]} [appleUrls] apple-touch-icon URLs
 * @returns {string[]}
 */
export function orderIconUrls(urls, pageUrl, appleUrls = []) {
  /** @type {string[]} */
  const all = [];
  for (const url of urls) {
    if (!all.includes(url)) all.push(url);
  }
  try {
    const favicon = new URL("/favicon.ico", pageUrl).href;
    if (!all.includes(favicon)) all.push(favicon);
  } catch {
    // Ignore a bad base URL. Callers still have the parsed list.
  }
  const icons = all.filter((url) => !isIco(url));
  const icos = all.filter((url) => isIco(url));
  const apple = appleUrls.filter((url) => !all.includes(url));
  return [...icons, ...icos, ...apple];
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isIco(url) {
  return /\.ico(?:[?#]|$)/i.test(url);
}
