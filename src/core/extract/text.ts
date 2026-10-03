import { ATTRIBUTE_ALLOWLIST } from './rules';

/** Collapse whitespace, trim, and cut to `max` characters (with an ellipsis when cut). */
export function trimText(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  let end = Math.max(0, max - 1);
  // Do not split a surrogate pair.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Resolve against `base`; unparseable values are returned unchanged. Long data: URIs are shortened. */
export function resolveUrl(raw: string, base: string, maxLength: number): string {
  const value = raw.trim();
  if (!value) return '';
  let resolved = value;
  try {
    resolved = new URL(value, base).href;
  } catch {
    // keep the raw value
  }
  if (resolved.length > maxLength && resolved.startsWith('data:')) {
    const comma = resolved.indexOf(',');
    const head = resolved.slice(0, comma === -1 ? 40 : Math.min(comma, 80));
    return `${head},…[${resolved.length} chars truncated]`;
  }
  return resolved.length > maxLength ? trimText(resolved, maxLength) : resolved;
}

/** Resolve every URL in a srcset, keeping its width/density descriptors. */
export function resolveSrcset(raw: string, base: string, maxLength: number): string {
  const candidates: string[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (/\s/.test(raw.charAt(i)) || raw.charAt(i) === ',')) i++;
    if (i >= raw.length) break;
    const start = i;
    while (i < raw.length && !/\s/.test(raw.charAt(i))) i++;
    let url = raw.slice(start, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      while (i < raw.length && /\s/.test(raw.charAt(i))) i++;
      const descriptorStart = i;
      while (i < raw.length && raw.charAt(i) !== ',') i++;
      descriptor = raw.slice(descriptorStart, i).trim();
    }
    if (url) candidates.push(`${resolveUrl(url, base, maxLength)}${descriptor ? ` ${descriptor}` : ''}`);
  }
  return candidates.join(', ');
}

const URL_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'src', 'data-src']);

/** Pick the allow-listed attributes, resolving URLs to absolute form and capping lengths. */
export function collectAttributes(
  getAttribute: (name: string) => string | null,
  base: string,
  maxLength: number,
): Record<string, string> | undefined {
  let attrs: Record<string, string> | undefined;
  for (const name of ATTRIBUTE_ALLOWLIST) {
    const raw = getAttribute(name);
    if (raw === null) continue;
    const value = URL_ATTRIBUTES.has(name)
      ? resolveUrl(raw, base, maxLength)
      : name === 'srcset'
        ? resolveSrcset(raw, base, maxLength)
        : trimText(raw, maxLength);
    attrs ??= {};
    attrs[name] = value;
  }
  return attrs;
}

/** True when `url` has the same origin as `pageUrl`. about:/data:/blob: documents inherit it. */
export function isSameOrigin(url: string, pageUrl: string): boolean {
  try {
    const target = new URL(url, pageUrl);
    if (target.protocol === 'about:' || target.protocol === 'data:' || target.protocol === 'blob:') return true;
    return target.origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}
