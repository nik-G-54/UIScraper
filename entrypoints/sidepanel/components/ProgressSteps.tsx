import type { ProgressStep } from '@/src/shared/types';

const STEPS: { id: ProgressStep; label: string }[] = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'scrolling', label: 'Scrolling' },
  { id: 'stabilizing', label: 'Stabilizing' },
  { id: 'capturing', label: 'Capturing' },
  { id: 'cleaning-up', label: 'Cleaning up' },
  { id: 'done', label: 'Done' },
];

export function ProgressSteps({ step, autoScroll }: { step: ProgressStep; autoScroll: boolean }) {
  const currentIndex = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Capture progress">
      {STEPS.map((s, index) => {
        const skipped = s.id === 'scrolling' && !autoScroll;
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
              {skipped && ' (off in Settings)'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
