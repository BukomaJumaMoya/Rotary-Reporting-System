import { healthResponseSchema } from '@dis/contracts';

// Proves the shared contracts package resolves and executes in the browser build.
// Replaced by real feature code from M1 onwards; there is nothing else to this page.
const contractsWired = healthResponseSchema.safeParse({ status: 'ok' }).success;

export function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          Rotaract District 9218
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">District Information System</h1>
        <p className="mt-4 text-sm text-slate-600">
          Scaffold only — M0 foundations. Authentication arrives in the next session.
        </p>
        <dl className="mt-6 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Shared contracts</dt>
            <dd className="font-medium text-slate-900">{contractsWired ? 'wired' : 'broken'}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
