import { maskPersonalData } from './mask';
import type { AiPart } from './provider';
import { userIntro } from './prompt';

export interface AiImage {
  /** What it shows, e.g. `section hero` or `hero frame 2`. */
  label: string;
  base64: string;
  bytes: number;
}

/** Everything the AI may see, already downscaled and capped. */
export interface AiInputs {
  title: string;
  url: string;
  sectionNames: string[];
  designMd: string;
  motionSummary: string;
  sectionShots: AiImage[];
  fullPage: AiImage | null;
  heroFrames: AiImage[];
}

/** What is left in the request after dropping things to fit the token budget. */
export interface InputPlan {
  frames: boolean;
  screenshots: boolean;
  /** 0 = full design.md, 1 = without assets and responsive sections, 2 = also without overview/tokens, truncated. */
  textLevel: 0 | 1 | 2;
}

const FULL_PLAN: InputPlan = { frames: true, screenshots: true, textLevel: 0 };

/** The order in which things are given up: frames, then section screenshots, then text. */
export const DROP_STEPS: ReadonlyArray<{ label: string; plan: InputPlan }> = [
  { label: '', plan: FULL_PLAN },
  { label: 'motion frames', plan: { frames: false, screenshots: true, textLevel: 0 } },
  { label: 'section screenshots', plan: { frames: false, screenshots: false, textLevel: 0 } },
  { label: 'asset and responsive details', plan: { frames: false, screenshots: false, textLevel: 1 } },
  { label: 'overview and token details', plan: { frames: false, screenshots: false, textLevel: 2 } },
];

const MAX_LEVEL2_CHARS = 40_000;

/** Shorter design.md: level 1 drops the assets index and responsive sections, level 2 also the overview and token tables. */
export function shortenDesignMd(md: string, level: 0 | 1 | 2): string {
  if (level === 0) return md;
  const dropped = level === 1 ? [/^## 6\./, /^## 7\./] : [/^## 2\./, /^## 3\./, /^## 6\./, /^## 7\./];
  const pieces = md.split(/\n(?=## )/);
  const kept = pieces.filter((piece) => !dropped.some((re) => re.test(piece)));
  const joined = kept.join('\n');
  if (level === 1 || joined.length <= MAX_LEVEL2_CHARS) return joined;
  const cut = joined.slice(0, MAX_LEVEL2_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0))}\n\n_(shortened to fit the AI input budget)_\n`;
}

/** The request parts for a plan: intro text, images (with labels in the intro), design.md, motion summary. */
export function buildParts(inputs: AiInputs, plan: InputPlan, mask: boolean): AiPart[] {
  const t = (text: string) => (mask ? maskPersonalData(text) : text);
  const images: AiImage[] = [
    ...(inputs.fullPage ? [inputs.fullPage] : []),
    ...(plan.screenshots ? inputs.sectionShots : []),
    ...(plan.frames ? inputs.heroFrames : []),
  ];
  const parts: AiPart[] = [
    { kind: 'text', text: t(userIntro({ title: inputs.title, url: inputs.url, sectionNames: inputs.sectionNames, imageNotes: images.map((i) => i.label) })) },
    ...images.map((i): AiPart => ({ kind: 'image', mimeType: 'image/jpeg', base64: i.base64 })),
    { kind: 'text', text: t(`# Rule-based design.md\n\n${shortenDesignMd(inputs.designMd, plan.textLevel)}`) },
    { kind: 'text', text: t(`# Motion summary\n\n${inputs.motionSummary || 'No motion was captured.'}`) },
  ];
  return parts;
}

/** Rough token estimate, used only when the provider cannot count: 4 characters per token, 300 per image. */
export function estimateTokens(parts: readonly AiPart[], system = ''): number {
  const chars = parts.reduce((n, p) => n + (p.kind === 'text' ? p.text.length : 0), system.length);
  return Math.ceil(chars / 4) + 300 * parts.filter((p) => p.kind === 'image').length;
}

export type Fit = { parts: AiPart[]; tokens: number; dropped: string[] } | { parts: null; reason: string; dropped: string[] };

/**
 * Find the richest request that fits `budget` tokens: full, then without frames, then without section
 * screenshots (the 512px full-page image stays), then with shortened text. Gives up with a reason.
 */
export async function fitInput(inputs: AiInputs, mask: boolean, count: (parts: AiPart[]) => Promise<number>, budget: number): Promise<Fit> {
  const dropped: string[] = [];
  let last = 0;
  for (const step of DROP_STEPS) {
    if (step.label) {
      // Skip steps that would change nothing (no frames to drop, no screenshots to drop).
      if (step.label === 'motion frames' && inputs.heroFrames.length === 0) continue;
      if (step.label === 'section screenshots' && inputs.sectionShots.length === 0) continue;
      dropped.push(step.label);
    }
    const parts = buildParts(inputs, step.plan, mask);
    last = await count(parts);
    if (last <= budget) return { parts, tokens: last, dropped: [...dropped] };
  }
  return { parts: null, reason: `the input is about ${last.toLocaleString('en-US')} tokens, over the ${budget.toLocaleString('en-US')} budget even after dropping ${dropped.join(', ')}`, dropped };
}
