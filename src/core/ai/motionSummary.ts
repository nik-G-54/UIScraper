import type { MotionData, MotionFrameIndex } from '../../shared/types';

/** Compact plain-text motion summary for the AI (the full detail is in design.md section 8). */
export function summarizeMotion(motion: MotionData | null, frames: MotionFrameIndex | null): string {
  if (!motion) return 'Motion was not captured.';
  const lines: string[] = [];
  lines.push(`Libraries: ${motion.libraries.map((l) => l.name).join(', ') || 'none detected'}.`);
  for (const p of motion.revealPresets.slice(0, 8)) lines.push(`Reveal preset: ${p.description} (${p.count} elements).`);
  for (const e of motion.scrollEffects.slice(0, 8)) lines.push(`Scroll effect: ${e.kind} on <${e.target.tag}>${e.target.label ? ` “${e.target.label}”` : ''}, y ${e.startPx}–${e.endPx}.`);
  for (const c of motion.carousels.slice(0, 6)) lines.push(`Carousel: ${c.slideCount} slides, ${c.direction}, ${c.autoplayIntervalMs ? `autoplay every ${c.autoplayIntervalMs}ms` : 'no autoplay'}.`);
  for (const a of motion.animations.slice(0, 8)) lines.push(`Animation: ${a.animationName ?? a.transitionProperty ?? a.type} on <${a.target.tag}>, ${a.durationMs ?? '?'}ms ${a.easing}${a.iterations === null ? ', infinite' : ''}.`);
  for (const v of motion.videos.slice(0, 4)) lines.push(`Video: ${v.width}×${v.height}${v.autoplay ? ', autoplay' : ''}${v.loop ? ', loop' : ''}.`);
  if (frames?.loader) lines.push(frames.loader.description);
  if (frames && frames.frames.length > 0) lines.push(`Motion frames in the pack: ${frames.frames.length}.`);
  return lines.join('\n');
}
