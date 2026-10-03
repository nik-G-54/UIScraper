# DesignLens

A personal-use Chrome extension (Manifest V3, built with WXT) that extracts any website's design
(DOM, styles, tokens, components, assets) and generates a `design.md` that an AI coding agent can
use to rebuild the design in Next.js + Tailwind.

It runs locally only, loaded via Chrome's "Load unpacked". No server, no cloud deployment,
no Chrome Web Store packaging.

## Stack

WXT + MV3 (Chrome), TypeScript (strict), React + Tailwind CSS v4 for the side panel, Vitest, ESLint.

## Commands

| Script              | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | WXT dev mode (rebuilds on change)                    |
| `npm run build`     | Production build to `.output/chrome-mv3`             |
| `npm run typecheck` | `tsc --noEmit`                                       |
| `npm run lint`      | ESLint                                               |
| `npm test`          | Vitest (single run)                                  |
| `npm run icons`     | Regenerate `public/icon/*.png` (no dependencies)     |

## Layout

- `entrypoints/background.ts` — minimal service worker
- `entrypoints/extractor.ts` — unlisted script (bundled), injected on demand into the page
- `entrypoints/sidepanel/` — React app (the orchestrator); `lib/capture.ts` runs a capture, `lib/css.ts` collects/downloads CSS, `lib/download.ts` saves files
- `src/core/**` — pure analysis logic: `extract`, `css`, `tokens`, `components`, `assets`, `output`, `ai`
- `entrypoints/sidepanel/lib/pack.ts` — the "Generate design pack" orchestrator; `emulation.ts` (chrome.debugger session), `screenshot.ts`, `assets.ts` (image downloads), `page.ts` (selector/asset messages), `zip.ts` (JSZip)
- `src/core/css/` — `collect.ts` is page-side (bundled into the extractor, so it must not import css-tree); the rest is pure
- `src/shared/` — `types.ts`, `config.ts` (budgets), `storage.ts`, `url.ts`, `errors.ts`, `usage.ts`

Imports use the WXT alias `@/` (project root), e.g. `@/src/shared/types`.

## Architecture rules

1. The SIDE PANEL is the orchestrator. It runs all long tasks (extraction coordination, fetching,
   AI calls, zip creation). The background service worker stays minimal because MV3 can terminate
   it at any time.
2. Page scripts are injected on demand into the ISOLATED world only
   (`chrome.scripting.executeScript`; no declarative `content_scripts`). Never inject `<script>`
   tags into the page. Any temporary change made to a page (e.g. pausing animations, hiding
   elements) must be fully reverted afterwards. Injected functions are serialized, so they must be
   fully self-contained (no runtime imports or outer-scope references).
3. All data passed between contexts must match types in `src/shared/types.ts`. Include a
   `schemaVersion` field in extraction results.
4. Never infer design meaning from class names (they may be hashed by CSS-in-JS). Use computed
   styles and CSS rules.
5. Analysis logic (tokens, clustering, component detection, markdown generation) must be pure
   functions in `src/core/**` with unit tests.
6. Extraction must respect configurable budgets (max nodes, max time, max scroll height) defined in
   one config file: `src/shared/config.ts`.
7. API keys are stored only in `chrome.storage.local`. Never hardcode keys.
8. The rule-based `design.md` is always generated first. AI is an optional enhancement layer; any AI
   failure (missing key, quota, token limit, network, invalid output) must fall back to the
   rule-based output and show the reason in the UI.
9. Every phase must end with typecheck, lint, test, and build all passing.
10. Errors must never fail silently; surface them in the side panel UI with a readable message.
11. Local-only project: no servers, no remote deployment.

## Capture engine (Phase 1)

How a capture runs (side panel = orchestrator, extractor = page-side worker):

1. `lib/capture.ts` injects `extractor.js` with `executeScript({ files, world: 'ISOLATED' })` (top frame
   only), pings it, and pauses CSS animations with `insertCSS` (USER origin). Transitions are left
   alone so their durations are recorded.
2. It sends a typed `designlens/extract` message (`ExtractorRequest` in `src/shared/types.ts`) with
   the budgets from `src/shared/config.ts` and gets the result in the response. Progress comes back
   as `designlens/progress` runtime messages. On any failure it sends `designlens/abort`.
3. The extractor (`src/core/extract/run.ts`) runs: remember scroll -> lazy-load scroll -> wait for
   DOM quiet -> scroll to top -> walk DOM -> cleanup. Cleanup (restore scroll, remove the temporary
   defaults iframe) is in a `finally` and always runs. The panel then calls `removeCSS`, also always.
4. The panel validates the result (`validateCaptureResult`) before using it.

Injecting twice is safe: `installListener` replaces the previous listener instead of adding one.

Data semantics worth knowing before consuming a capture:

- `nodes[i].id === i`; parents always have a lower id than their children.
- A style property that is **absent** from a `styleTable` entry has the browser's default value for
  that tag (computed in a hidden about:blank iframe). Border colours with no border and
  text-decoration colour/style with no decoration are pruned as invisible.
- Hidden nodes (`visibility:hidden`, opacity 0, zero-size, descendants of opacity 0) have
  `styleId: null`; `display:none` subtrees are skipped entirely.
- Rects are document coordinates, captured with the page scrolled to the top.
- The walk follows the flat tree: open shadow roots, and slotted nodes under their `<slot>`.
  Closed shadow hosts are flagged opaque. iframes/canvas/video/embed/object are placeholders;
  inline `<svg>` is one node.
- The only whitelist of captured properties is `src/core/extract/styleProps.ts`.
- `stats.truncated` means **data may be missing**. Only `maxNodes`, `maxCaptureTimeMs`,
  `maxScrollHeightPx` and `maxScrollTimeMs` set it (named in `stats.truncatedReasons`). A page that
  never goes quiet (`maxStabilizeTimeMs`) is NOT truncated: the capture is complete, so it only adds
  a `page-not-stable` warning.
- Lazy-load scrolling targets the window when it can scroll by at least `scrollMinOverflowPx`. If it
  cannot, or the window gets `stuck`, it scrolls the main inner scroll container instead (largest
  visible element with overflow-y auto/scroll that clearly overflows; time budget is shared).
  `stats.scroll.target` is `"window"` or `"container"`, with a tag + depth `container` descriptor
  (never class names). Cleanup restores the window AND the container `scrollTop`, and the
  container is put at the top for the capture, like the window.

Bump `SCHEMA_VERSION` in `src/shared/types.ts` whenever the result shape changes.

## CSS and tokens (Phases 2-3)

After a capture the panel runs `lib/css.ts` then `generateTokens` (progress steps: collecting CSS, parsing CSS,
generating tokens). CSS collection never throws: any failure is a warning on `CssData.warnings`.

- The extractor answers `designlens/collect-css` (`RawCssCollection`: `document.styleSheets`, `adoptedStyleSheets`,
  open shadow roots). Readable sheets come back as text; cross-origin ones only as `href`, which the panel downloads
  (size cap + timeout in `CSS_LIMITS`). `@import` is followed by the panel up to `maxImportDepth` (2), including in
  readable sheets. `parseCss` (css-tree) resolves `url()` to absolute and wraps a sheet's `media` as its context.
- `CssData`: custom properties on :root/html/body/:host and theme selectors (dark ones split into `darkMode.variables`),
  breakpoints with frequency, state rules (state pseudo removed from `selector`), keyframes, font faces, framework hints
  (from custom-property prefixes and banners, never class names). CSS nesting is not analyzed (warned).
- `generateTokens(capture, css)` is pure (`src/core/tokens`): colours (culori, CIEDE2000 clustering, roles), typography,
  spacing (4/8 base unit), radius, shadows, motion, breakpoints. Outputs: `DesignTokens` (tokens.json),
  `generateThemeCss` (Tailwind v4 `@theme`), `generateTailwindV3Extend` (v3 `theme.extend` string).
- Because the style table omits browser defaults, token code re-applies Chrome's UA defaults for font-size, weight and
  text colour (`typography.ts`, `color.ts`); spacing ignores absent (default) margins/paddings. `outline-color` is not
  in the style whitelist, so it is not a colour source.
- Bump `TOKENS_SCHEMA_VERSION` when `DesignTokens` changes.

## Layout, assets, design pack (Phases 4-6)

"Generate design pack" (`lib/pack.ts`) runs: set capture width -> capture -> CSS -> tokens -> layout/components (+ states) ->
collect assets -> screenshots -> release debugger -> download images -> design.md -> zip -> `chrome.downloads`. Only a failed
capture stops the run; every later failure is a warning and the zip is still produced. `design.md` is complete without AI.

- **Capture width**: Settings `captureWidth` (1440 default, 1280, 768, 390, `window`). The panel attaches `chrome.debugger`
  (permission `debugger`), sets `Emulation.setDeviceMetricsOverride` (width, current height, real DPR), waits for the page to
  report that width, then captures. `DebuggerSession.release()` ALWAYS runs (`finally`, `pagehide`): clears the override and
  detaches, never throws. If attaching fails (DevTools open...) it falls back to the window width with a warning; a capture
  under 1024px also warns. `meta.captureWidth` / `meta.emulated` record what happened. Chrome shows a "debugging" bar meanwhile.
- **Screenshots**: same debugger session, `Page.captureScreenshot` with `captureBeyondViewport` (jpeg ~85, no scroll stitching),
  clips of at most `SCREENSHOT.maxClipHeightPx` stitched on an `OffscreenCanvas`, then one crop per section
  (`assets/screens/NN-<section>.jpg`, plus `full-page.jpg`). Without a debugger there are no screenshots (warning).
- **Extractor keeps `Map<nodeId, Element>`** of the last capture (`runCapture`'s `onElements`). New messages:
  `designlens/match-selectors` (selector -> node ids, for hover/focus/active/disabled) and `designlens/collect-assets`
  (img currentSrc/size/alt, inline SVG markup, favicons).
- **Components** (`src/core/components`): sections (`sections.ts`: follow single-child wrappers, expand `<main>`/tall blocks),
  structural hash (`structure.ts`: tags + child shape to `hashDepth`, never class names; `look` hash adds style ids), groups of
  2+ become components (`components.ts`, split by `classifyComponent`: button/link/nav-item/input/badge/card/list-item/generic),
  variants = differing visual props, states from `states.ts`, Tailwind classes from `tailwind.ts` (names follow the generated
  theme.css via `buildTailwindContext`; arbitrary values like `p-[13px]` otherwise). Node ids are pre-order, so a subtree is
  the id range `[i, i + span[i])`.
- **Assets** (`src/core/assets`): `buildAssetIndex` (images incl. CSS backgrounds, sanitized + hash-deduped SVG icons, favicons,
  fonts from `@font-face`, logo = first img/svg in header/nav). Downloads happen in the panel with caps (`ASSET_DOWNLOAD`).
- **Gradients**: `tokens/gradient.ts` parses `background-image` gradients (raw value + stops + usage count) into
  `tokens.gradients`; their stop colours join the palette as low-weight `gradient` uses.
- **design.md** (`src/core/output`): 8 fixed sections; re-rendered with shorter lists until it fits
  `OUTPUT_LIMITS.maxDesignMdChars`. Zip: `design.md`, `tokens.json`, `theme.css`, `capture.json`, `assets/{images,icons,screens}/`,
  named `designlens-<host>-<timestamp>.zip`.
- Bump `SCHEMA_VERSION` (now 4) / `TOKENS_SCHEMA_VERSION` (now 2) when those shapes change.

## Design fidelity (key elements)

- `analyzeLayout` fills `PageSection.keyElements` (`components/keyElements.ts`: headings, buttons, logos/images, paragraphs, badges by
  priority, capped by `KEY_ELEMENTS.maxPerSection`, output in reading order) and `geometry` (`components/geometry.ts`: container content
  box, ink extent, decorative 1-2px lines). Inline runs come from an element's own text first, then its text-bearing descendants.
- `radius.ts`: exact radius per element; "pill" only when the radius is >= half the element height. Components carry `radius`/`pill`.
- `-webkit-text-fill-color` is captured but pruned when equal to `color` (absent = same as `color`); `mix-blend-mode` is whitelisted.
- design.md keeps the key elements of the first `KEY_ELEMENTS.protectedSections` sections at every size level; later sections shrink first.
- Emulated viewport height is at least `SCREENSHOT.minEmulatedHeightPx` (900).

## Final batch milestones

Resume from the first unticked milestone. After each: typecheck, lint, test, build, tick, commit "M<n>: <title>".

- [x] M1: Motion capture (extractor): libraries, running animations, scroll reveals, scroll-linked effects, carousels, videos -> `motion` in capture.json
- [x] M2: Motion frames (hero, per-effect) + optional page-load capture (loader detection) -> assets/motion/
- [ ] M3: design.md "Motion & interactions" + "## 0. Build checklist" + AGENT_PROMPT.md + "Copy agent prompt" button
- [ ] M4: AI layer (Gemini REST, pre-checks, retry/fallback, validator, final assembly, masking, design.rules.md)

## Motion (final batch)

- `src/core/motion/`: pure `libraries.ts` (signals only: script/link URLs + DOM markers), `reveals.ts` (presets, stagger), `scrollEffects.ts`
  (parallax/pinned/progress/horizontal from samples), `carousel.ts` (interval from position samples); `collect.ts` is the page-side scan.
- The scan runs BEFORE the animation-pause CSS: pack.ts injects the extractor, sends `designlens/collect-motion`, then `captureTab(..., alreadyInjected)`
  (so the extractor keeps the scan's target elements), then `designlens/resolve-motion` fills `nodeId`s. Result goes into capture.json as `motion`.
- Budgets: `MOTION_LIMITS` in config (`maxMotionTimeMs` = MAX_MOTION_TIME). Settings `captureMotion` (default on), `capturePageLoad` (default off).

- Frames (M2): `core/motion/frames.ts` plans them (pure: hero, reveal before/after, carousel, scroll start/middle/end, load times, `detectLoader`);
  `sidepanel/lib/frames.ts` takes them through the debugger (downscaled to `FRAME_LIMITS.maxFrameWidth`, one shared frame/byte budget) into
  `assets/motion/`. Page-load capture (`capturePageLoad`, default off) reloads with the debugger attached, then pack.ts re-injects the extractor.
  Scroll is always restored after frames. Scroll-linked frames capture the viewport (not an element crop); reveal "before" frames show the
  revealed state if the page does not hide elements again when they leave the viewport.

## Roadmap

- 0 Setup
- 1 Capture engine
- 2 CSS parser
- 3 Design tokens
- **4 Layout + components — current**
- **5 Assets + screenshots + zip — current**
- **6 Rule-based design.md — current**
- 7 AI layer (Gemini default, provider-pluggable)
- 8 Polish
