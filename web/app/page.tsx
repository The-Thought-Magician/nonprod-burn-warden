import Link from 'next/link'

const FEATURES = [
  {
    title: 'Environment Inventory & Classification',
    body: 'Catalog every cloud resource and classify it into dev, staging, QA, sandbox, preview, or prod with rule-matched confidence scores.',
  },
  {
    title: 'Idle-Window Detection',
    body: 'Infer out-of-hours running with no usage from usage samples, separating off-hours idle from business-hours idle down to a hour-of-week heatmap.',
  },
  {
    title: 'Always-On Waste Ledger',
    body: 'A per-environment, per-team ledger of the dollars burned while idle, with running monthly and trailing-30-day totals and breakdowns by provider, service, and region.',
  },
  {
    title: 'Schedule-Savings Calculator',
    body: 'Model nights, weekends, and holidays off-hours schedules and prove projected monthly savings as absolute dollars and as a percent of spend.',
  },
  {
    title: 'Timezone & Holiday Awareness',
    body: 'Per-environment timezones and per-region holiday calendars so savings models treat company shutdowns and weekends as real off-days.',
  },
  {
    title: 'Orphaned Non-Prod Finder',
    body: 'Surface long-lived sandboxes, forgotten PR/preview stacks, and zero-usage environments with severity scoring and estimated monthly cost.',
  },
  {
    title: 'Monthly Recovery Report',
    body: 'Generate a finance-ready report of non-prod spend, idle waste, and recoverable dollars by team and environment, with a shareable read-only link.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <span className="flex items-center gap-2 text-xl font-black text-yellow-400">
          <span>🔥</span> NonprodBurnWarden
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-zinc-300 hover:text-zinc-100">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-zinc-100">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-400 px-4 py-2 font-medium text-zinc-950 hover:bg-yellow-300"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/40 bg-yellow-400/10 px-3 py-1 text-xs font-medium text-yellow-300">
          FinOps for non-production compute
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">
          Stop burning money on <span className="text-yellow-400">always-on</span> dev environments
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          NonprodBurnWarden builds a per-environment idle-spend ledger and a credible schedule-ROI model, so you can
          prove five-to-six-figure monthly savings from off-hours schedules. Report and model only. It never touches
          your infrastructure.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-400 px-6 py-3 font-semibold text-zinc-950 hover:bg-yellow-300"
          >
            Start for free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-200 hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-y border-zinc-800 bg-zinc-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-zinc-100">The single most-repeated FinOps finding</h2>
          <p className="mt-4 text-zinc-400">
            Dev, staging, QA, sandbox, and PR/preview stacks routinely run nights, weekends, and holidays while nobody
            uses them, commonly 20 to 40 percent of an org&apos;s compute spend. Enforcing off-hours schedules often
            halves that category. But the conversation never gets budget authority without two things: a ledger that
            attributes wasted dollars to a specific environment and team, and a model that says exactly how much a
            schedule would save.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold">Everything you need to recover the waste</h2>
        <p className="mt-3 text-center text-zinc-400">
          Deterministic, demo-ready, and free for every signed-in user.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="text-lg font-semibold text-yellow-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-zinc-800 px-6 py-20 text-center">
        <h2 className="text-3xl font-bold">Bring numbers to your next cost-cutting cycle</h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400">
          Seed a realistic demo workspace in one click, or upload your own CSV billing and usage exports. Get a
          finance-ready recovery report in minutes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-400 px-6 py-3 font-semibold text-zinc-950 hover:bg-yellow-300"
          >
            Create your workspace
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-200 hover:bg-zinc-900"
          >
            See pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>NonprodBurnWarden — per-environment idle-spend ledger and schedule-ROI model.</p>
      </footer>
    </main>
  )
}
