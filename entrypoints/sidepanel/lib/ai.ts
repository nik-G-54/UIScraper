import { assembleFinalDesignMd, createGeminiProvider, decideAi, runAi, summarizeMotion } from '@/src/core/ai';
import type { AiImage, AiInputs, AiOutcome } from '@/src/core/ai';
import { withSiteNotes } from '@/src/core/output';
import { AI_LIMITS } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import type { AiSummary, MotionData, MotionFrameIndex, PageSection, ScreenshotIndex, Settings } from '@/src/shared/types';
import { getAiUsageToday, recordAiRequest } from '@/src/shared/usage';
import type { PackFile } from './zip';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Downscale a JPEG to at most `maxWidth` px wide and return it as base64. */
async function downscale(bytes: Uint8Array, maxWidth: number, label: string): Promise<AiImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
  try {
    const width = Math.min(maxWidth, bitmap.width);
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: AI_LIMITS.jpegQuality / 100 });
    const out = new Uint8Array(await blob.arrayBuffer());
    return { label, base64: toBase64(out), bytes: out.byteLength };
  } finally {
    bitmap.close();
  }
}

const asBytes = (file: PackFile | undefined): Uint8Array | null => (file && typeof file.data !== 'string' ? file.data : null);

/** Gather the screenshots and frames the AI may see, downscaled and capped (count and bytes). */
export async function buildAiInputs(args: {
  title: string;
  url: string;
  designMd: string;
  sections: readonly PageSection[];
  screens: ScreenshotIndex;
  imageFiles: readonly PackFile[];
  motion: MotionData | null;
  motionFrames: MotionFrameIndex;
}): Promise<AiInputs> {
  const byPath = new Map(args.imageFiles.map((f) => [f.path, f]));
  let bytes = 0;
  const room = () => bytes < AI_LIMITS.maxImageBytes;
  const take = async (path: string, width: number, label: string): Promise<AiImage | null> => {
    const data = asBytes(byPath.get(path));
    if (!data || !room()) return null;
    try {
      const image = await downscale(data, width, label);
      bytes += image.bytes;
      return image;
    } catch {
      return null;
    }
  };

  const fullPage = args.screens.fullPage ? await take(args.screens.fullPage.path, AI_LIMITS.fullPageImageWidth, 'full page (512px wide)') : null;
  const sectionShots: AiImage[] = [];
  for (const shot of args.screens.sections.slice(0, AI_LIMITS.maxSectionImages)) {
    const image = await take(shot.path, AI_LIMITS.sectionImageWidth, `section ${shot.name}`);
    if (image) sectionShots.push(image);
  }
  const hero = args.motionFrames.frames.filter((f) => f.kind === 'hero');
  const picks = hero.length <= AI_LIMITS.maxHeroFrames ? hero : [hero[0], hero[Math.floor(hero.length / 2)], hero[hero.length - 1]].filter((f): f is NonNullable<typeof f> => f !== undefined);
  const heroFrames: AiImage[] = [];
  for (const frame of picks.slice(0, AI_LIMITS.maxHeroFrames)) {
    const image = await take(frame.path, AI_LIMITS.sectionImageWidth, `motion frame ${frame.path.split('/').pop()}`);
    if (image) heroFrames.push(image);
  }
  return {
    title: args.title,
    url: args.url,
    sectionNames: args.sections.map((s) => s.name),
    designMd: args.designMd,
    motionSummary: summarizeMotion(args.motion, args.motionFrames),
    sectionShots,
    fullPage,
    heroFrames,
  };
}

export interface AiRun {
  summary: AiSummary;
  designMd: string;
  agentPrompt: string;
}

type AiSettings = Pick<Settings, 'aiMode' | 'apiKey' | 'model' | 'fallbackModel' | 'dailyAiLimit' | 'maskPersonalData'>;

/**
 * The optional AI step. Never throws and never blocks the pack: any problem leaves the rule-based
 * design.md and AGENT_PROMPT.md as they are and records why (CLAUDE.md rule 8).
 */
export async function enhanceWithAi(args: {
  settings: AiSettings;
  rulesMd: string;
  agentPrompt: string;
  inputs: () => Promise<AiInputs>;
}): Promise<AiRun> {
  const { settings } = args;
  const summary = (outcome: AiOutcome | { reason: string }): AiSummary => {
    const full = 'enhanced' in outcome ? outcome : null;
    const enhanced = full?.enhanced === true;
    return {
      enhanced,
      model: full?.model ?? null,
      reason: enhanced ? null : (outcome.reason ?? 'unknown reason'),
      level: !enhanced && settings.aiMode === 'always' ? 'error' : 'info',
      requests: full?.requests ?? 0,
      tokens: full?.tokens ?? null,
      usedToday: full?.usedToday ?? null,
      dropped: full?.dropped ?? [],
    };
  };
  try {
    const used = await getAiUsageToday();
    const pre = decideAi({ mode: settings.aiMode, apiKey: settings.apiKey, used, limit: settings.dailyAiLimit });
    if (!pre.run) return { summary: { ...summary({ reason: pre.reason }), usedToday: used }, designMd: args.rulesMd, agentPrompt: args.agentPrompt };

    const outcome = await runAi({
      provider: createGeminiProvider({ apiKey: settings.apiKey.trim(), timeoutMs: AI_LIMITS.timeoutMs }),
      mode: settings.aiMode,
      apiKey: settings.apiKey,
      model: settings.model,
      fallbackModel: settings.fallbackModel,
      dailyLimit: settings.dailyAiLimit,
      getUsed: getAiUsageToday,
      recordRequest: recordAiRequest,
      inputs: await args.inputs(),
      mask: settings.maskPersonalData,
      inputTokenBudget: AI_LIMITS.inputTokenBudget,
      maxOutputTokens: AI_LIMITS.maxOutputTokens,
      maxRetries: AI_LIMITS.maxRetries,
      backoffMs: AI_LIMITS.backoffMs,
    });
    if (!outcome.enhanced || !outcome.text || !outcome.model) return { summary: summary(outcome), designMd: args.rulesMd, agentPrompt: args.agentPrompt };
    return {
      summary: summary(outcome),
      designMd: assembleFinalDesignMd(args.rulesMd, outcome.text, outcome.model),
      agentPrompt: outcome.siteNotes ? withSiteNotes(args.agentPrompt, outcome.siteNotes) : args.agentPrompt,
    };
  } catch (error) {
    return { summary: summary({ reason: toErrorMessage(error) }), designMd: args.rulesMd, agentPrompt: args.agentPrompt };
  }
}
