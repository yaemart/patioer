export default function OpsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Ops Console</p>
            <h1 className="text-lg font-semibold text-white">ElectroOS Global Operations</h1>
          </div>
          <a
            href="/dashboard"
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-900"
          >
            Back to Tenant View
          </a>
        </div>
      </header>
      {children}
    </div>
  )
}
