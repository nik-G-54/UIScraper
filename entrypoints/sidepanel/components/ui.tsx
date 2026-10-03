import type { ReactNode } from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-slate-600" role="status">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      {label}
    </span>
  );
}

export function ErrorBanner({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 break-words">{message}</p>
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'warning' | 'success'; children: ReactNode }) {
  const styles =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-green-200 bg-green-50 text-green-900';
  return (
    <div role={tone === 'warning' ? 'note' : 'status'} className={`rounded-md border p-3 ${styles}`}>
      {children}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {title && <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>}
      {children}
    </section>
  );
}
