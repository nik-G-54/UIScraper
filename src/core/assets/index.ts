// Phase 5: assets. Pure index building here; fetching and zipping happen in the side panel.
import { ASSET_DOWNLOAD, ASSET_LIMITS } from '../../shared/config';
import type {
  AssetIndex,
  CapturedNode,
  CaptureWarning,
  CssData,
  FaviconAsset,
  FontAsset,
  IconAsset,
  ImageAsset,
  LogoAsset,
  PageSection,
  RawAssetCollection,
} from '../../shared/types';
import { sectionOfNode } from '../components/sections';
import type { Tree } from '../components/tree';
import { sanitizeSvg, svgHash } from './svg';

const BACKGROUND_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** Image URLs in a computed `background-image` value (gradients are ignored). */
export function backgroundUrls(value: string): string[] {
  const urls: string[] = [];
  for (const match of value.matchAll(BACKGROUND_URL)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (url && !url.startsWith('#')) urls.push(url);
  }
  return urls;
}

interface ImageDraft {
  url: string;
  kind: ImageAsset['kind'];
  nodeIds: number[];
  naturalWidth: number | null;
  naturalHeight: number | null;
  alt: string | null;
}

function collectImages(tree: Tree, raw: RawAssetCollection | null): ImageDraft[] {
  const drafts = new Map<string, ImageDraft>();
  for (const image of raw?.images ?? []) {
    const existing = drafts.get(image.url);
    if (existing) {
      existing.nodeIds.push(image.nodeId);
      existing.naturalWidth ??= image.naturalWidth || null;
      existing.naturalHeight ??= image.naturalHeight || null;
      existing.alt ??= image.alt;
      continue;
    }
    drafts.set(image.url, {
      url: image.url,
      kind: 'img',
      nodeIds: [image.nodeId],
      naturalWidth: image.naturalWidth || null,
      naturalHeight: image.naturalHeight || null,
      alt: image.alt,
    });
  }
  for (const node of tree.nodes) {
    if (!tree.isVisible(node)) continue;
    const background = tree.style(node)['background-image'];
    if (!background || !background.includes('url(')) continue;
    for (const url of backgroundUrls(background)) {
      if (url.startsWith('data:') && url.length > ASSET_LIMITS.maxDataUrlChars) continue;
      const existing = drafts.get(url);
      if (existing) existing.nodeIds.push(node.id);
      else drafts.set(url, { url, kind: 'css-background', nodeIds: [node.id], naturalWidth: null, naturalHeight: null, alt: null });
    }
  }
  return [...drafts.values()];
}

function buildFonts(css: CssData): FontAsset[] {
  const byFamily = new Map<string, FontAsset>();
  for (const face of css.fontFaces) {
    let font = byFamily.get(face.family);
    if (!font) byFamily.set(face.family, (font = { family: face.family, weights: [], styles: [], display: face.display, sources: [] }));
    if (!font.weights.includes(face.weight)) font.weights.push(face.weight);
    if (!font.styles.includes(face.style)) font.styles.push(face.style);
    for (const source of face.sources) {
      if (font.sources.length < 6 && !font.sources.some((s) => s.url === source.url)) font.sources.push(source);
    }
  }
  return [...byFamily.values()];
}

const isRootLink = (href: string | undefined, pageUrl: string): boolean => {
  if (!href) return false;
  try {
    const url = new URL(href, pageUrl);
    return url.origin === new URL(pageUrl).origin && (url.pathname === '/' || url.pathname === '');
  } catch {
    return false;
  }
};

/** First img/svg in a header or nav of a sensible logo size, preferring one that links to the home page. */
function findLogo(tree: Tree, nodeToAsset: Map<number, { kind: 'img' | 'svg'; id: string }>, sections: readonly PageSection[]): LogoAsset | null {
  let fallback: CapturedNode | null = null;
  const pageUrl = tree.capture.meta.url;
  for (const [nodeId, asset] of [...nodeToAsset.entries()].sort((a, b) => a[0] - b[0])) {
    const node = tree.nodes[nodeId] as CapturedNode;
    if (!tree.isVisible(node) || node.rect.width < 16 || node.rect.height < 12 || node.rect.width > 500 || node.rect.height > 200) continue;
    const bar = tree.findAncestor(node, (a) => a.tag === 'header' || a.tag === 'nav' || a.attrs?.role === 'banner');
    if (!bar) continue;
    const link = tree.findAncestor(node, (a) => a.tag === 'a');
    if (isRootLink(link?.attrs?.href, pageUrl)) return { kind: asset.kind, assetId: asset.id, section: sectionOfNode(tree, sections, nodeId)?.name ?? null };
    fallback ??= node;
  }
  if (!fallback) return null;
  const asset = nodeToAsset.get(fallback.id) as { kind: 'img' | 'svg'; id: string };
  return { kind: asset.kind, assetId: asset.id, section: sectionOfNode(tree, sections, fallback.id)?.name ?? null };
}

/**
 * Everything the page uses: images (with the section they appear in), de-duplicated sanitized SVG
 * icons, favicons, fonts and the likely logo. Paths stay null until the side panel downloads them.
 */
export function buildAssetIndex(tree: Tree, sections: readonly PageSection[], raw: RawAssetCollection | null, css: CssData): AssetIndex {
  const warnings: CaptureWarning[] = [...(raw?.warnings ?? [])];
  const nodeToAsset = new Map<number, { kind: 'img' | 'svg'; id: string }>();

  const drafts = collectImages(tree, raw)
    .map((draft) => {
      const first = tree.nodes[draft.nodeIds[0] ?? 0] as CapturedNode;
      return { draft, first, area: first.rect.width * first.rect.height };
    })
    .sort((a, b) => b.area - a.area);
  const images: ImageAsset[] = drafts.map(({ draft, first }, i) => {
    const id = `img-${i + 1}`;
    for (const nodeId of draft.nodeIds) if (draft.kind === 'img') nodeToAsset.set(nodeId, { kind: 'img', id });
    return {
      id,
      url: draft.url,
      kind: draft.kind,
      nodeIds: draft.nodeIds.slice(0, 20),
      count: draft.nodeIds.length,
      naturalWidth: draft.naturalWidth,
      naturalHeight: draft.naturalHeight,
      displayWidth: Math.round(first.rect.width),
      displayHeight: Math.round(first.rect.height),
      alt: draft.alt,
      section: sectionOfNode(tree, sections, first.id)?.name ?? null,
      path: null,
      bytes: null,
      skipped: null,
    };
  });

  const icons: IconAsset[] = [];
  const byHash = new Map<string, IconAsset>();
  let unsafe = 0;
  let overIconLimit = 0;
  for (const svg of raw?.svgs ?? []) {
    const markup = sanitizeSvg(svg.markup, ASSET_DOWNLOAD.maxSvgChars);
    if (markup === null) {
      unsafe++;
      continue;
    }
    const hash = svgHash(markup);
    const section = sectionOfNode(tree, sections, svg.nodeId)?.name;
    let icon = byHash.get(hash);
    if (!icon) {
      if (icons.length >= ASSET_DOWNLOAD.maxIcons) {
        overIconLimit++;
        continue;
      }
      icon = { id: `icon-${icons.length + 1}`, hash, markup, width: Math.round(svg.width), height: Math.round(svg.height), label: svg.label, count: 0, sections: [], path: null };
      byHash.set(hash, icon);
      icons.push(icon);
    }
    icon.count++;
    if (section && !icon.sections.includes(section)) icon.sections.push(section);
    nodeToAsset.set(svg.nodeId, { kind: 'svg', id: icon.id });
  }
  if (unsafe > 0) warnings.push({ code: 'svg-dropped', message: `${unsafe} inline SVG(s) were dropped (too large, or not a plain <svg> after sanitizing).` });
  if (overIconLimit > 0) warnings.push({ code: 'svg-limit', message: `${overIconLimit} more distinct SVG icon(s) were not kept (limit ${ASSET_DOWNLOAD.maxIcons}).` });

  const favicons: FaviconAsset[] = [];
  for (const favicon of raw?.favicons ?? []) {
    if (favicons.length >= ASSET_DOWNLOAD.maxFavicons || favicons.some((f) => f.url === favicon.href)) continue;
    favicons.push({ rel: favicon.rel, url: favicon.href, sizes: favicon.sizes, path: null });
  }

  return {
    images,
    icons,
    favicons,
    fonts: buildFonts(css),
    logo: findLogo(tree, nodeToAsset, sections),
    warnings,
  };
}

export { assetPath, imageExtension, shortUrl, slugFromUrl } from './files';
export { planClips, planCrops } from './screens';
export { sanitizeSvg, svgHash } from './svg';
