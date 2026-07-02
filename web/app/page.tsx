import Link from 'next/link'

const FEATURES = [
  {
    title: 'Environment inventory & classification',
    body: 'Catalogs every cloud resource. Tags it dev, staging, QA, sandbox, preview, or prod. Rule-matched, with a confidence score.',
  },
  {
    title: 'Idle-window detection',
    body: 'Reads usage samples. Finds hours where compute ran and nothing used it. Splits off-hours idle from business-hours idle, down to an hour-of-week heatmap.',
  },
  {
    title: 'Always-on waste ledger',
    body: 'Tracks dollars burned while idle, per environment, per team. Running monthly and trailing-30-day totals. Broken down by provider, service, and region.',
  },
  {
    title: 'Schedule-savings calculator',
    body: 'Models a nights/weekends/holidays off-hours schedule. Shows projected monthly savings in dollars and as a percent of spend.',
  },
  {
    title: 'Timezone & holiday awareness',
    body: 'Per-environment timezones. Per-region holiday calendars. Savings models count company shutdowns and weekends as real off-days, not guesses.',
  },
  {
    title: 'Orphaned non-prod finder',
    body: 'Flags long-lived sandboxes, forgotten PR/preview stacks, and zero-usage environments. Severity score and estimated monthly cost on each.',
  },
  {
    title: 'Monthly recovery report',
    body: 'Generates a report of non-prod spend, idle waste, and recoverable dollars by team and environment. Shareable read-only link.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2 text-xl font-black text-emerald-400">
          <span>🔥</span> NonprodBurnWarden
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-slate-300 hover:text-slate-100">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-slate-100">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-emerald-400 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-300"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
          Non-prod cost monitoring
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">
          Your dev environments run all night. <span className="text-emerald-400">Nobody's using them.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          NonprodBurnWarden watches dev, staging, QA, sandbox, and preview environments. It builds a ledger of exactly
          how much they burn while idle, and models what an off-hours schedule would save. It reports and calculates.
          It does not touch your infrastructure.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-emerald-400 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-300"
          >
            Start for free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-900"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-y border-slate-800 bg-slate-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-slate-100">The waste is real and it repeats every month</h2>
          <p className="mt-4 text-slate-400">
            Dev, staging, QA, sandbox, and PR/preview stacks run nights, weekends, and holidays with nobody on them.
            That's commonly 20 to 40 percent of an org&apos;s compute spend. An off-hours schedule can cut that in
            half. Getting budget approval for it needs two things: a ledger that attributes wasted dollars to a
            specific environment and team, and a number that says exactly what a schedule would save. That's what
            this tool produces.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold">What it does</h2>
        <p className="mt-3 text-center text-slate-400">
          Deterministic. Demo-ready. Free for every signed-in user.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-lg font-semibold text-emerald-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-800 px-6 py-20 text-center">
        <h2 className="text-3xl font-bold">Get numbers before your next cost review</h2>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Seed a demo workspace in one click, or upload your own CSV billing and usage exports. A recovery report is
          ready in minutes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-emerald-400 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-300"
          >
            Create your workspace
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-900"
          >
            See pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>NonprodBurnWarden — per-environment idle-spend ledger and schedule-savings model.</p>
      </footer>
    </main>
  )
}
