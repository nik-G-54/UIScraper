// Phase 1: the capture engine. The page-side entry is entrypoints/extractor.ts.
export { createBrowserEnv } from './env';
export { installListener } from './install';
export { createExtractorListener, isExtractorRequest } from './messaging';
export { runCapture } from './run';
export { STYLE_PROPERTIES } from './styleProps';
export { validateCaptureResult } from './validate';
export type { ValidationOutcome } from './validate';
