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

## Roadmap

- 0 Setup
- 1 Capture engine
- **2 CSS parser — current**
- **3 Design tokens — current**
- 4 Layout + components
- 5 Assets + screenshots + zip
- 6 Rule-based design.md
- 7 AI layer (Gemini default, provider-pluggable)
- 8 Polish
