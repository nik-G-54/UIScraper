import { shortUrl } from '../assets/files';
import type {
  AssetIndex,
  CapturedNode,
  CaptureResult,
  ComponentGroup,
  CssData,
  DesignTokens,
  MotionData,
  MotionFrameIndex,
  MotionTarget,
  PageSection,
} from '../../shared/types';
import { adviceFor, revealSnippet } from '../motion/advice';

export interface MotionMdInput {
  capture: Pick<CaptureResult, 'placeholders' | 'nodes'>;
  tokens: DesignTokens;
  css: CssData;
  layout: { sections: PageSection[]; components: ComponentGroup[] };
  assets: AssetIndex;
  motion?: MotionData | null;
  motionFrames?: MotionFrameIndex | null;
}

/** How much the motion section lists. */
export interface MotionCaps {
  items: number;
  frames: number;
  keyframes: number;
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const code = (value: string): string => `\`${value.replace(/`/g, "'")}\``;
const more = (shown: number, total: number, what: string): string[] => (total > shown ? [`- … and ${total - shown} more ${what} (see capture.json)`] : []);

const sectionAt = (sections: readonly PageSection[], target: MotionTarget): string | null => {
  const y = target.rect.y + target.rect.height / 2;
  return sections.find((s) => y >= s.rect.y && y < s.rect.y + s.rect.height)?.name ?? null;
};

const where = (sections: readonly PageSection[], target: MotionTarget): string => {
  const section = sectionAt(sections, target);
  return `${code(`<${target.tag}>`)}${target.label ? ` “${clip(target.label, 40)}”` : ''}${section ? ` in ${section}` : ''}`;
};

const CANVAS_LIKE = new Set(['canvas', 'lottie-player', 'dotlottie-player', 'dotlottie-wc', 'lottie-animation', 'rive-canvas']);

/** Canvas / WebGL / Lottie / Rive areas of the page (visible, sized). */
export function graphicAreas(capture: Pick<CaptureResult, 'placeholders' | 'nodes'>): CapturedNode[] {
  return capture.nodes.filter((n) => CANVAS_LIKE.has(n.tag) && n.styleId !== null && n.rect.width >= 40 && n.rect.height >= 40);
}

function componentOf(components: readonly ComponentGroup[], nodeId: number | null): string | null {
  if (nodeId === null) return null;
  return components.find((c) => c.members.includes(nodeId))?.name ?? null;
}

/** Section 8: everything about motion and interactions, with the Next.js way to build each part. */
export function motionSection(input: MotionMdInput, caps: MotionCaps): string[] {
  const { motion, motionFrames, layout } = input;
  const sections = layout.sections;
  const lines = ['## 8. Motion & interactions', ''];

  if (!motion) {
    lines.push('Motion was not captured (turned off in Settings, or the scan failed: see the warnings), so only the CSS transitions and keyframes below are known. Keep the page static apart from those.', '');
  } else {
    lines.push(
      `Sampled: ${motion.libraries.length} libraries, ${motion.animations.length} running animations, ${motion.reveals.length} scroll reveals in ${motion.revealPresets.length} presets, ${motion.scrollEffects.length} scroll-linked effects, ${motion.carousels.length} carousels, ${motion.videos.length} videos${motion.stats.truncated ? ' (some limits were hit; the lists may be incomplete)' : ''}.`,
      '',
      '### Libraries and the Next.js equivalent',
      '',
    );
    if (motion.libraries.length === 0) {
      lines.push('None detected from script URLs or DOM markers (libraries bundled into the page’s own JavaScript cannot be seen). Use `motion` (Framer Motion) for reveals and scroll effects and plain CSS for the rest.');
    }
    for (const lib of motion.libraries) {
      const advice = adviceFor(lib.name);
      lines.push(`- **${lib.name}** — evidence: ${lib.evidence.slice(0, 3).join('; ')}. Next.js: ${code(`npm i ${advice.packages}`)}. ${advice.note}`);
    }

    lines.push('', '### Scroll reveals', '');
    if (motion.revealPresets.length === 0) lines.push('No elements changed when scrolled into view.');
    for (const preset of motion.revealPresets.slice(0, caps.items)) {
      const examples = preset.targets
        .slice(0, 3)
        .map((i) => motion.reveals.find((r) => r.target.index === i)?.target)
        .filter((t): t is MotionTarget => t !== undefined)
        .map((t) => where(sections, t));
      const snippet = revealSnippet(preset);
      lines.push(`- ${code(preset.description)} — ${preset.count} element${preset.count === 1 ? '' : 's'}, e.g. ${examples.join('; ') || 'n/a'}${snippet ? `. With motion: ${code(snippet)}` : ''}`);
    }
    lines.push(...more(Math.min(caps.items, motion.revealPresets.length), motion.revealPresets.length, 'reveal presets'));

    lines.push('', '### Scroll-linked effects', '', 'Ranges are scroll positions in document px.', '');
    if (motion.scrollEffects.length === 0) lines.push('None detected.');
    for (const e of motion.scrollEffects.slice(0, caps.items)) {
      const how = {
        pinned: 'CSS `position: sticky` in a tall wrapper, or GSAP ScrollTrigger `pin`',
        parallax: '`useScroll` + `useTransform` from motion (map scroll range to a y offset)',
        progress: '`useScroll({ target, offset })` + `useTransform` for the changing properties',
        horizontal: 'a tall wrapper with a sticky viewport; `useTransform` maps vertical scroll to x',
      }[e.kind];
      lines.push(`- **${e.kind}** on ${where(sections, e.target)} — y ${e.startPx}–${e.endPx} (${e.endPx - e.startPx}px): ${e.description}. Build with ${how}.`);
    }
    lines.push(...more(Math.min(caps.items, motion.scrollEffects.length), motion.scrollEffects.length, 'scroll effects'));

    lines.push('', '### Carousels', '');
    if (motion.carousels.length === 0) lines.push('None detected.');
    for (const c of motion.carousels.slice(0, caps.items)) {
      lines.push(
        `- ${where(sections, c.target)} — ${c.slideCount} slides, ${c.direction}, ${c.autoplayIntervalMs ? `autoplay every ${c.autoplayIntervalMs}ms` : 'no autoplay seen'}${c.transitionMs ? `, ${c.transitionMs}ms transition` : ''}, arrows ${c.controls.arrows ? 'yes' : 'no'}, dots ${c.controls.dots ? 'yes' : 'no'}.`,
      );
    }

    lines.push('', '### Videos', '');
    if (motion.videos.length === 0) lines.push('None.');
    for (const v of motion.videos.slice(0, caps.items)) {
      const poster = v.poster ? input.assets.images.find((i) => i.url === v.poster) : undefined;
      lines.push(
        `- ${where(sections, v.target)} — ${v.width}×${v.height}, ${[v.autoplay && 'autoplay', v.loop && 'loop', v.muted && 'muted'].filter(Boolean).join(', ') || 'no autoplay'}; poster ${poster?.path ? code(poster.path) : v.poster ? shortUrl(v.poster, 60) : 'none'}; the video file is not in the pack${v.src ? ` (source ${shortUrl(v.src, 60)})` : ''}: use the poster in a \`<video poster>\` or an \`<img>\`.`,
      );
    }

    lines.push('', '### Running animations (per element and component)', '');
    if (motion.animations.length === 0) lines.push('None were running during the scan.');
    for (const a of motion.animations.slice(0, caps.items)) {
      const props = new Set<string>();
      for (const k of a.keyframes) for (const key of Object.keys(k)) if (key !== 'offset' && key !== 'easing') props.add(key);
      const comp = componentOf(layout.components, a.target.nodeId);
      lines.push(
        `- ${a.animationName ?? a.transitionProperty ?? a.type} on ${where(sections, a.target)}${comp ? ` (component ${comp})` : ''} — ${a.durationMs ?? '?'}ms ${a.easing}, delay ${a.delayMs}ms, ${a.iterations === null ? 'infinite' : `${a.iterations}×`}${a.direction !== 'normal' ? `, ${a.direction}` : ''}${props.size ? `; animates ${[...props].slice(0, 6).join(', ')}` : ''}`,
      );
    }
    lines.push(...more(Math.min(caps.items, motion.animations.length), motion.animations.length, 'animations'));
  }

  if (motionFrames?.loader) {
    lines.push('', '### Loader / intro', '', motionFrames.loader.description);
    if (motionFrames.loader.detected) lines.push('Build it as a client component overlay that is removed (fade out) once the page has loaded.');
  }

  const areas = graphicAreas(input.capture);
  const libs = new Set(motion?.libraries.map((l) => l.name) ?? []);
  if (areas.length > 0) {
    lines.push('', '### Canvas, WebGL, Lottie and Rive areas', '');
    for (const n of areas.slice(0, caps.items)) {
      const section = sections.find((s) => n.rect.y + n.rect.height / 2 >= s.rect.y && n.rect.y + n.rect.height / 2 < s.rect.y + s.rect.height)?.name;
      const lib = [...libs].find((l) => ['Three.js', 'Lottie', 'Rive'].includes(l));
      lines.push(`- ${code(`<${n.tag}>`)} ${Math.round(n.rect.width)}×${Math.round(n.rect.height)}${section ? ` in ${section}` : ''} — reproduce with ${lib ? `the detected library (${lib}: ${adviceFor(lib).packages})` : 'a matching library'} or a placeholder box of the same size; the content cannot be extracted.`);
    }
  }

  if (motionFrames && motionFrames.frames.length > 0) {
    lines.push('', '### Motion frames', '', 'Look at these before building each animation. Paths are inside the pack.', '');
    for (const f of motionFrames.frames.slice(0, caps.frames)) lines.push(`- ${code(f.path)} — ${clip(f.description, 160)}`);
    lines.push(...more(Math.min(caps.frames, motionFrames.frames.length), motionFrames.frames.length, 'frames'));
  }

  const { motion: transitions } = input.tokens;
  lines.push('', '### CSS transitions and keyframes', '');
  lines.push(`- **Transition durations:** ${transitions.durations.map((d) => `${d.ms}ms (${d.count})`).join(', ') || 'none'}`);
  lines.push(`- **Easings:** ${transitions.easings.map((e) => `${code(clip(e.value, 60))} (${e.count})`).join(', ') || 'none'}`);
  if (input.css.keyframes.length === 0) lines.push('- **Keyframes:** none.');
  for (const k of input.css.keyframes.slice(0, caps.keyframes)) lines.push(`- keyframes ${code(k.name)}: ${k.steps} steps, animates ${k.properties.join(', ') || 'n/a'}`);
  lines.push(...more(Math.min(caps.keyframes, input.css.keyframes.length), input.css.keyframes.length, 'keyframes'), '');
  return lines;
}
