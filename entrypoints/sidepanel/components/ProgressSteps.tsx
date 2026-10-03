import type { AnalysisStep } from '@/src/shared/types';

const STEPS: { id: AnalysisStep; label: string }[] = [
  { id: 'emulating-width', label: 'Setting capture width' },
  { id: 'capturing-page-load', label: 'Filming the page load' },
  { id: 'sampling-motion', label: 'Sampling motion' },
  { id: 'capturing-frames', label: 'Motion frames' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'scrolling', label: 'Scrolling' },
  { id: 'stabilizing', label: 'Stabilizing' },
  { id: 'capturing', label: 'Capturing' },
  { id: 'cleaning-up', label: 'Cleaning up' },
  { id: 'collecting-css', label: 'Collecting CSS' },
  { id: 'parsing-css', label: 'Parsing CSS' },
  { id: 'generating-tokens', label: 'Generating tokens' },
  { id: 'analyzing-layout', label: 'Layout and components' },
  { id: 'collecting-assets', label: 'Collecting assets' },
  { id: 'taking-screenshots', label: 'Screenshots' },
  { id: 'downloading-assets', label: 'Downloading images' },
  { id: 'writing-design-md', label: 'Writing design.md' },
  { id: 'zipping', label: 'Building the zip' },
  { id: 'done', label: 'Done' },
];

export function ProgressSteps({
  step,
  autoScroll,
  emulate,
  motion = true,
  pageLoad = false,
}: {
  step: AnalysisStep;
  autoScroll: boolean;
  /** False when the capture width is "Current window": no width override step. */
  emulate: boolean;
  motion?: boolean;
  pageLoad?: boolean;
}) {
  const currentIndex = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Progress">
      {STEPS.map((s, index) => {
        const skipped = (s.id === 'scrolling' && !autoScroll) || (s.id === 'emulating-width' && !emulate) || ((s.id === 'sampling-motion' || s.id === 'capturing-frames') && !motion) || (s.id === 'capturing-page-load' && !pageLoad);
        const state = skipped ? 'skipped' : index < currentIndex || step === 'done' ? 'done' : index === currentIndex ? 'active' : 'pending';
        return (
          <li
            key={s.id}
            aria-current={state === 'active' ? 'step' : undefined}
            className={`flex items-center gap-2 ${state === 'pending' || state === 'skipped' ? 'text-slate-400' : 'text-slate-800'}`}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
              {state === 'done' && <span className="text-green-600">✓</span>}
              {state === 'active' && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              )}
              {state === 'pending' && <span className="h-2 w-2 rounded-full border border-slate-300" />}
              {state === 'skipped' && <span>–</span>}
            </span>
            <span className={state === 'active' ? 'font-semibold' : ''}>
              {s.label}
              {skipped && (s.id === 'emulating-width' ? ' (current window width)' : ' (off in Settings)')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
