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

## Layout

- `entrypoints/background.ts` — minimal service worker
- `entrypoints/sidepanel/` — React app (the orchestrator)
- `src/core/**` — pure analysis logic: `extract`, `css`, `tokens`, `components`, `assets`, `output`, `ai`
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

## Roadmap

- **0 Setup — current**
- 1 Capture engine
- 2 CSS parser
- 3 Design tokens
- 4 Layout + components
- 5 Assets + screenshots + zip
- 6 Rule-based design.md
- 7 AI layer (Gemini default, provider-pluggable)
- 8 Polish
