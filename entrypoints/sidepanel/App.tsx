import { useState } from 'react';
import { AnalyzeView } from './components/AnalyzeView';
import { SettingsView } from './components/SettingsView';
import { useActiveTab } from './hooks/useActiveTab';

type View = 'analyze' | 'settings';

const VIEWS: { id: View; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [view, setView] = useState<View>('analyze');
  // Lives here so tab tracking continues while the Settings view is open.
  const activeTab = useActiveTab();

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="border-b border-slate-200 bg-white px-4 pt-3">
        <h1 className="text-base font-semibold">DesignLens</h1>
        <nav className="mt-2 flex gap-4" aria-label="Views">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
              className={`-mb-px border-b-2 pb-2 font-medium ${
                view === id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      {/* Both views stay mounted so a running capture and unsaved edits survive tab switching. */}
      <main className="flex-1 p-4">
        <div hidden={view !== 'analyze'}>
          <AnalyzeView activeTab={activeTab} />
        </div>
        <div hidden={view !== 'settings'}>
          <SettingsView />
        </div>
      </main>
    </div>
  );
}
