// Phase 7 / M4: the optional AI layer. Pure logic plus a REST provider; nothing here is required for design.md.
export { assembleFinalDesignMd, REFERENCE_HEADING, splitRulesMd } from './assemble';
export { createGeminiProvider } from './gemini';
export { buildParts, DROP_STEPS, estimateTokens, fitInput, shortenDesignMd } from './inputs';
export type { AiImage, AiInputs, InputPlan } from './inputs';
export { maskPersonalData } from './mask';
export { summarizeMotion } from './motionSummary';
export { decideAi } from './precheck';
export type { AiDecision } from './precheck';
export { OPTIONAL_HEADINGS, REQUIRED_HEADINGS, SYSTEM_PROMPT } from './prompt';
export { AiError } from './provider';
export type { AiPart, AiProvider, GenerateRequest, GenerateResponse, KeyTestResult } from './provider';
export { runAi } from './run';
export type { AiOutcome, RunAiOptions } from './run';
export { extractSection, stripFence, validateAiOutput } from './validate';
