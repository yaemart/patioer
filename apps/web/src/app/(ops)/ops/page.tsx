const OPS_MODULES = [
  {
    slug: 'autonomy',
    title: 'Autonomy',
    description: '30-day acceptance logs, overall health score, and agent-native operating posture.',
  },
  {
    slug: 'circuit-breaker',
    title: 'Circuit Breaker',
    description: 'Global breaker state, trigger history, and recovery workflow for critical incidents.',
  },
  {
    slug: 'inter-layer',
    title: 'Inter-layer',
    description: 'ElectroOS, DevOS, and DataOS monitor reports for cross-layer debugging.',
  },
  {
    slug: 'devos-loops',
    title: 'DevOS Loops',
    description: 'Autonomous loop queue, retry posture, and deployment diagnostics for platform agents.',
  },
  {
    slug: 'emergency',
    title: 'Emergency',
    description: 'Reserved area for global emergency stop and incident coordination controls.',
  },
]

export default function OpsPlaceholderPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
        <p className="text-sm font-medium text-cyan-300">Phase 6 Placeholder</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Super-admin route group is now wired</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Day 1 only requires the `(ops)` route group and middleware split to exist. Seller roles stay in
          the tenant experience, while admin roles can land here for future cross-tenant operations.
        </p>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {OPS_MODULES.map((module) => (
          <article
            key={module.slug}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">{module.title}</h3>
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                Phase 6
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{module.description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
