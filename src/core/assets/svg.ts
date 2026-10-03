import { hashString } from '../../shared/hash';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that can run code or load active content; removed together with their contents. */
const DANGEROUS_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'applet'];

function stripElements(markup: string): string {
  let out = markup;
  for (const name of DANGEROUS_ELEMENTS) {
    out = out.replace(new RegExp(`<${name}\\b[^>]*?/>`, 'gi'), '');
    out = out.replace(new RegExp(`<${name}\\b[\\s\\S]*?</${name}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`</?${name}\\b[^>]*>`, 'gi'), ''); // unclosed leftovers
  }
  return out;
}

/**
 * Make inline SVG markup safe to keep as a file: no scripts or other active elements, no `on*`
 * handlers, no `javascript:` / `data:text` links, no CSS imports. Returns null when the result is
 * not an `<svg>` or is longer than `maxChars`. Adds the SVG namespace so it opens standalone.
 * Repeats until stable so nested tricks like `<scr<script>ipt>` do not survive one pass.
 */
export function sanitizeSvg(markup: string, maxChars: number): string | null {
  let out = markup.trim();
  for (let pass = 0; pass < 5; pass++) {
    const before = out;
    out = out.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
    out = stripElements(out);
    // Event handlers: onclick="...", onload='...', onfoo=bar (also after a slash: <svg/onload=...>).
    out = out.replace(/[\s/]+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, ' ');
    // Script-bearing links.
    out = out.replace(
      /\s+(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript|vbscript|data:text)[^"]*"|'\s*(?:javascript|vbscript|data:text)[^']*')/gi,
      '',
    );
    out = out.replace(/@import\s+[^;}]*[;}]?/gi, '');
    out = out.replace(/expression\s*\(/gi, '(');
    if (out === before) break;
  }
  if (!/^<svg[\s>/]/i.test(out) || !/<\/svg\s*>\s*$/i.test(out)) return null;
  if (!/^<svg\b[^>]*\sxmlns\s*=/i.test(out)) out = out.replace(/^<svg\b/i, `<svg xmlns="${SVG_NS}"`);
  return out.length > maxChars ? null : out;
}

/** Stable id for deduplicating icons: the same markup (ignoring whitespace between tags) hashes the same. */
export function svgHash(sanitized: string): string {
  return hashString(sanitized.replace(/>\s+</g, '><').replace(/\s+/g, ' '));
}
