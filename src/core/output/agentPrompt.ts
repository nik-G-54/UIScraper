import { suggestedPackages } from '../motion/advice';
import type { MotionLibrary } from '../../shared/types';

export interface ChecklistSection {
  name: string;
  /** Path of the section screenshot inside the pack, or null. */
  screenshot: string | null;
}

export interface AgentPromptInput {
  title: string;
  sections: readonly ChecklistSection[];
  libraries: readonly MotionLibrary[];
  hasMotion: boolean;
  hasRevealPresets: boolean;
  hasLoader: boolean;
  /** Site-specific notes written by the AI layer (markdown), appended as their own block. */
  siteNotes?: string | null;
}

export const CHECKLIST_RULE = 'Build ALL sections in one pass. Do not stop after the hero. Do not ask for confirmation between sections.';

/** The `## 0. Build checklist` block of design.md: every section, with its screenshot, as an unchecked box. */
export function buildChecklist(sections: readonly ChecklistSection[]): string[] {
  const lines = ['## 0. Build checklist', '', `**${CHECKLIST_RULE}**`, ''];
  if (sections.length === 0) lines.push('No sections were detected: build the page from the full-page screenshot, top to bottom.');
  sections.forEach((s, i) => lines.push(`${i + 1}. [ ] ${s.name} — screenshot: ${s.screenshot ? `\`${s.screenshot}\`` : 'not available'}`));
  lines.push('', 'Tick each box as you finish the section. When all are ticked, apply the motion in section 8 and verify `app/page.tsx` renders every section above.', '');
  return lines;
}

/**
 * AGENT_PROMPT.md: a ready-to-paste prompt for Claude Code, Antigravity or Cursor. It assumes the
 * unzipped pack is in `./design`.
 */
export function generateAgentPrompt(input: AgentPromptInput): string {
  const packages = suggestedPackages(input.libraries, input.hasRevealPresets);
  const list = input.sections.length > 0 ? input.sections.map((s, i) => `   ${i + 1}. ${s.name}${s.screenshot ? ` (screenshot: design/${s.screenshot})` : ''}`).join('\n') : '   (no sections were detected: use design/assets/screens/full-page.jpg)';
  const motionStep = input.hasMotion
    ? `4. Apply the motion described in section 8 of design.md${packages.length > 0 ? `. Install what it suggests (${packages.map((p) => `\`${p}\``).join(', ')}) and use those libraries` : ''}: scroll reveals as the listed presets, scroll-linked effects over the listed ranges, carousels with the listed interval, videos with their poster${input.hasLoader ? ', and the page loader' : ''}. Put animated pieces in small client components (\`'use client'\`).`
    : '4. design.md has no sampled motion. Add only the CSS transitions and keyframes listed in section 8.';

  const lines = [
    `# Rebuild "${input.title}" from its design pack`,
    '',
    'The design pack is unzipped in `./design` (design.md, tokens.json, theme.css, capture.json, assets/). Work autonomously until everything is built; do not ask me for confirmation between sections.',
    '',
    '1. Read `./design/design.md` completely before writing any code, including the build checklist (section 0), the key elements of every section, and the reference data.',
    '2. Set up the project: Next.js App Router + TypeScript + Tailwind CSS v4 (`npx create-next-app@latest` if there is no project yet). Copy the `@theme` block of `design/theme.css` into `app/globals.css` right after `@import "tailwindcss";`. Copy `design/assets/images` and `design/assets/icons` to `public/`. Use the tokens instead of hard-coded values.',
    `3. Implement EVERY section of the checklist, in this order, in ONE pass (one component per section under \`components/sections/\`, composed in \`app/page.tsx\`). ${CHECKLIST_RULE}`,
    list,
    motionStep,
    '5. After each section, compare it with its screenshot in `design/assets/screens/` (and the motion frames in `design/assets/motion/`) and fix differences. Match every key element’s font-size, colour runs, border-radius, spacing and container geometry exactly. Do not invent decorations, badges, pills or font changes that are not in the screenshots or the data.',
    '6. At the end, verify that `app/page.tsx` imports and renders every checklist section, and that `npm run build` and `npm run lint` pass.',
    '7. Finish with a short list of what still differs from the screenshots and why (missing assets, unknown fonts, motion you could not reproduce).',
    '',
    'Rules: replace brand logos and copyrighted images with neutral placeholders unless I own them; use the closest free Google Font when a font is not available (keep the original name first in the stack); make the layout responsive with the breakpoints in section 7.',
    '',
  ];
  const notes = input.siteNotes?.trim();
  if (notes) lines.push('## Site-specific notes', '', notes, '');
  return lines.join('\n');
}

/** Append (or replace) the AI-written site notes of an existing AGENT_PROMPT.md. */
export function withSiteNotes(prompt: string, notes: string): string {
  const base = prompt.split('\n## Site-specific notes')[0]?.trimEnd() ?? prompt;
  const clean = notes.trim();
  return clean ? `${base}\n\n## Site-specific notes\n\n${clean}\n` : `${base}\n`;
}
