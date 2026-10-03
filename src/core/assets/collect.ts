import { SCHEMA_VERSION } from '../../shared/types';
import type { AssetLimits, CaptureWarning, RawAssetCollection, RawFavicon, RawImage, RawSvg } from '../../shared/types';

/**
 * Page-side: read images, inline SVGs and favicons from the elements of the last capture.
 * Bundled into the extractor, so it must stay free of heavy imports. Never modifies the page.
 */

const FAVICON_SELECTOR =
  'link[rel~="icon" i], link[rel="apple-touch-icon" i], link[rel="apple-touch-icon-precomposed" i], link[rel="mask-icon" i]';

function absolute(raw: string | null, base: string): string {
  if (!raw || !raw.trim()) return '';
  try {
    return new URL(raw.trim(), base).href;
  } catch {
    return '';
  }
}

function textOf(el: Element | null): string | null {
  const text = el?.textContent?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : null;
}

/** The inline SVG's markup, with any element it pulls in through `<use href="#id">` appended in a `<defs>`. */
function svgMarkup(svg: Element, doc: Document, maxChars: number): string | null {
  let markup = svg.outerHTML;
  if (markup.length > maxChars) return null;
  const wanted = new Set<string>();
  for (const use of svg.querySelectorAll('use')) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (href.startsWith('#') && href.length > 1) wanted.add(href.slice(1));
  }
  if (wanted.size > 0) {
    let defs = '';
    for (const id of wanted) {
      const target = doc.getElementById(id);
      if (target && !svg.contains(target)) defs += target.outerHTML;
    }
    const end = markup.lastIndexOf('</svg>');
    if (defs && end !== -1 && markup.length + defs.length + 14 <= maxChars) {
      markup = `${markup.slice(0, end)}<defs>${defs}</defs>${markup.slice(end)}`;
    }
  }
  return markup;
}

export function collectAssets(doc: Document, elements: ReadonlyMap<number, Element>, limits: AssetLimits): RawAssetCollection {
  const base = doc.baseURI;
  const images: RawImage[] = [];
  const svgs: RawSvg[] = [];
  const warnings: CaptureWarning[] = [];
  let skippedLarge = 0;
  let overImages = 0;
  let overSvgs = 0;

  for (const [nodeId, el] of elements) {
    const tag = el.localName;
    if (tag === 'img') {
      const img = el as HTMLImageElement;
      const url = img.currentSrc || absolute(img.getAttribute('src'), base) || absolute(img.getAttribute('data-src'), base);
      if (!url) continue;
      if (url.startsWith('data:') && url.length > limits.maxDataUrlChars) {
        skippedLarge++;
        continue;
      }
      if (images.length >= limits.maxImages) {
        overImages++;
        continue;
      }
      const srcset = img.getAttribute('srcset');
      images.push({
        nodeId,
        url,
        srcset: srcset ? srcset.slice(0, 500) : null,
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        alt: img.getAttribute('alt'),
        inPicture: img.parentElement?.localName === 'picture',
      });
    } else if (tag === 'svg') {
      if (svgs.length >= limits.maxSvgs) {
        overSvgs++;
        continue;
      }
      const markup = svgMarkup(el, doc, limits.maxSvgChars);
      if (markup === null) {
        skippedLarge++;
        continue;
      }
      const box = el.getBoundingClientRect();
      svgs.push({
        nodeId,
        markup,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        label: el.getAttribute('aria-label') ?? textOf(el.querySelector('title')),
      });
    }
  }

  if (skippedLarge > 0) {
    warnings.push({ code: 'assets-too-large', message: `${skippedLarge} image/SVG element(s) were too large to read from the page and were skipped.` });
  }
  if (overImages > 0) {
    warnings.push({ code: 'assets-image-limit', message: `${overImages} more <img> element(s) were not read (limit ${limits.maxImages}).` });
  }
  if (overSvgs > 0) {
    warnings.push({ code: 'assets-svg-limit', message: `${overSvgs} more inline SVG(s) were not read (limit ${limits.maxSvgs}).` });
  }

  const favicons: RawFavicon[] = [];
  for (const link of doc.querySelectorAll<HTMLLinkElement>(FAVICON_SELECTOR)) {
    const href = absolute(link.getAttribute('href'), base);
    if (href) favicons.push({ rel: (link.getAttribute('rel') ?? 'icon').toLowerCase(), href, sizes: link.getAttribute('sizes') });
  }

  return { schemaVersion: SCHEMA_VERSION, images, svgs, favicons, warnings };
}
