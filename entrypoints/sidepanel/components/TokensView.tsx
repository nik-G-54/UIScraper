import { useState } from 'react';
import { generateTailwindV3Extend, generateThemeCss } from '@/src/core/tokens';
import { toErrorMessage } from '@/src/shared/errors';
import type { CssData, DesignTokens } from '@/src/shared/types';
import { downloadThemeCss, downloadTokensJson } from '../lib/download';
import { Card, ErrorBanner, Notice } from './ui';

type ActionState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

const rem = (px: number) => `${Number((px / 16).toFixed(3))}rem`;

function Swatches({ tokens }: { tokens: DesignTokens }) {
  if (tokens.colors.length === 0) return <p className="text-slate-500">No colours were found.</p>;
  return (
    <ul className="grid grid-cols-2 gap-2">
      {tokens.colors.map((color) => (
        <li key={color.hex} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-9 w-9 shrink-0 rounded border border-slate-300"
            style={{ backgroundColor: color.hex }}
          />
          <span className="min-w-0">
            <span className="block font-mono text-xs">{color.hex}</span>
            <span className="block truncate text-xs text-slate-500" title={color.variable ?? undefined}>
              {color.role ?? color.variable ?? `${color.count} uses`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Subheading({ children }: { children: string }) {
  return <h3 className="mt-3 mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{children}</h3>;
}

export function TokensView({ tokens, css }: { tokens: DesignTokens; css: CssData }) {
  const [action, setAction] = useState<ActionState>({ status: 'idle' });

  const run = async (task: () => Promise<string>) => {
    setAction({ status: 'busy' });
    try {
      setAction({ status: 'done', message: await task() });
    } catch (error) {
      setAction({ status: 'error', message: toErrorMessage(error) });
    }
  };
  const saveTokens = () => run(async () => `Saved ${await downloadTokensJson(tokens)} to your Downloads folder.`);
  const saveTheme = () =>
    run(async () => `Saved ${await downloadThemeCss(generateThemeCss(tokens), tokens.source.url)} to your Downloads folder.`);
  const copyV3 = () =>
    run(async () => {
      await navigator.clipboard.writeText(generateTailwindV3Extend(tokens));
      return 'Copied the Tailwind v3 theme.extend object to the clipboard.';
    });

  const { typography, spacing } = tokens;
  const maxSpace = Math.max(1, ...spacing.scale.map((s) => s.px));
  const busy = action.status === 'busy';
  const buttonClass =
    'rounded-md border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="flex flex-col gap-3">
      {css.warnings.length > 0 && (
        <Notice tone="warning">
          <p className="font-semibold">CSS warnings ({css.warnings.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {css.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="break-words">
                {warning.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <Card title="Design tokens">
        <p className="text-xs text-slate-500">
          {css.stats.sheets} stylesheets ({css.stats.fetchedSheets} downloaded
          {css.stats.unreadableSheets > 0 ? `, ${css.stats.unreadableSheets} unreadable` : ''}), {css.stats.rules.toLocaleString()} rules,{' '}
          {Object.keys(tokens.cssVariables.default).length} custom properties
          {tokens.darkMode ? ', dark mode' : ''}
          {tokens.frameworks.length > 0 ? ` · ${tokens.frameworks.map((f) => (f.version ? `${f.name} ${f.version}` : f.name)).join(', ')}` : ''}
        </p>

        <Subheading>Colors</Subheading>
        <Swatches tokens={tokens} />

        <Subheading>Fonts</Subheading>
        {typography.families.length === 0 ? (
          <p className="text-slate-500">No text was found.</p>
        ) : (
          <ul className="space-y-1">
            {typography.families.map((family) => (
              <li key={family.stack} className="break-words">
                <span className="font-medium">{family.name}</span>{' '}
                <span className="text-xs text-slate-500">
                  {family.role ?? family.category} · {family.count}×
                </span>
                <span className="block font-mono text-xs text-slate-500">{family.stack}</span>
              </li>
            ))}
          </ul>
        )}

        <Subheading>Type scale</Subheading>
        <ul className="space-y-0.5">
          {typography.sizes.map((size) => (
            <li key={size.px} className="flex items-baseline gap-3">
              <span className="w-20 shrink-0 font-mono text-xs text-slate-500">
                {size.px}px · {rem(size.px)}
              </span>
              <span className="truncate leading-tight" style={{ fontSize: Math.min(size.px, 32) }}>
                Aa
              </span>
              <span className="ml-auto text-xs text-slate-400">{size.count}×</span>
            </li>
          ))}
        </ul>
        {typography.weights.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            Weights: {typography.weights.map((w) => `${w.value} (${w.count}×)`).join(', ')}
          </p>
        )}

        <Subheading>Spacing</Subheading>
        <p className="mb-1 text-xs text-slate-500">
          {spacing.baseUnit !== null
            ? `${spacing.baseUnit}px base unit (${Math.round(spacing.coverage * 100)}% of values fit)`
            : `No 4px or 8px grid (${Math.round(spacing.coverage * 100)}% of values fit 4px)`}
        </p>
        <ul className="space-y-0.5">
          {spacing.scale.map((step) => (
            <li key={step.px} className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{step.px}px</span>
              <span className="h-2.5 rounded-sm bg-slate-700" style={{ width: `${(step.px / maxSpace) * 70}%` }} />
              <span className="ml-auto text-xs text-slate-400">{step.count}×</span>
            </li>
          ))}
        </ul>

        {tokens.radius.length > 0 && (
          <>
            <Subheading>Radius</Subheading>
            <ul className="flex flex-wrap gap-3">
              {tokens.radius.map((r) => (
                <li key={r.value} className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="h-10 w-10 border-2 border-slate-700 bg-slate-100"
                    style={{ borderRadius: r.value }}
                  />
                  <span className="font-mono text-xs text-slate-500">{r.px === 9999 ? 'full' : r.value}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {tokens.shadows.length > 0 && (
          <>
            <Subheading>Shadows</Subheading>
            <ul className="flex flex-wrap gap-4 p-1">
              {tokens.shadows.map((s) => (
                <li key={s.value} title={s.value}>
                  <span
                    aria-hidden="true"
                    className="block h-10 w-14 rounded bg-white"
                    style={{ boxShadow: s.value }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {(tokens.breakpoints.length > 0 || tokens.motion.durations.length > 0) && (
          <>
            <Subheading>Breakpoints and motion</Subheading>
            {tokens.breakpoints.length > 0 && (
              <p className="text-xs text-slate-600">Breakpoints: {tokens.breakpoints.map((b) => `${b.px}px`).join(', ')}</p>
            )}
            {tokens.motion.durations.length > 0 && (
              <p className="text-xs text-slate-600">
                Transitions: {tokens.motion.durations.map((d) => `${d.ms}ms`).join(', ')}
                {tokens.motion.easings[0] ? ` · ${tokens.motion.easings[0].value}` : ''}
              </p>
            )}
          </>
        )}
      </Card>

      <div className="flex flex-col gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void saveTokens()}>
          Download tokens.json
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void saveTheme()}>
          Download theme.css
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void copyV3()}>
          Copy Tailwind v3 theme.extend
        </button>
      </div>
      {action.status === 'done' && <Notice tone="success">{action.message}</Notice>}
      {action.status === 'error' && <ErrorBanner title="That did not work" message={action.message} />}
    </div>
  );
}
