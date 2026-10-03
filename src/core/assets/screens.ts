import type { PageSection } from '../../shared/types';

export interface Clip {
  y: number;
  height: number;
}

/** Vertical slices of at most `maxClipHeight` that cover `docHeight` (the page is cut at `maxDocHeight`). */
export function planClips(docHeight: number, maxClipHeight: number, maxDocHeight: number): { clips: Clip[]; capped: boolean } {
  const total = Math.max(1, Math.min(Math.ceil(docHeight), maxDocHeight));
  const clips: Clip[] = [];
  for (let y = 0; y < total; y += maxClipHeight) clips.push({ y, height: Math.min(maxClipHeight, total - y) });
  return { clips, capped: docHeight > maxDocHeight };
}

export interface Crop {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The section was taller than the cap and its bottom is not in the crop. */
  cut: boolean;
}

/** One crop per section, clamped to the canvas; sections with no visible area are dropped. */
export function planCrops(
  sections: readonly Pick<PageSection, 'name' | 'rect'>[],
  canvasWidth: number,
  canvasHeight: number,
  maxCropHeight: number,
  maxShots: number,
): Crop[] {
  const crops: Crop[] = [];
  for (const section of sections) {
    if (crops.length >= maxShots) break;
    const x = Math.max(0, Math.floor(section.rect.x));
    const y = Math.max(0, Math.floor(section.rect.y));
    const width = Math.min(canvasWidth - x, Math.ceil(section.rect.width));
    const fullHeight = Math.min(canvasHeight - y, Math.ceil(section.rect.height));
    if (width < 1 || fullHeight < 1) continue;
    const height = Math.min(fullHeight, maxCropHeight);
    crops.push({ name: section.name, x, y, width, height, cut: height < fullHeight });
  }
  return crops;
}
