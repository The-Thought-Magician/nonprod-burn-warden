'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const FREE_FEATURES = [
  'Unlimited workspaces, environments, and resources',
  'Environment inventory & rule-based classification',
  'Idle-window detection & hour-of-week heatmaps',
  'Always-on waste ledger by environment and team',
  'Schedule-savings calculator & what-if modeling',
  'Timezone & holiday-aware off-hours schedules',
  'Orphaned non-prod finder',
  'Per-team budgets, showback & allocation',
  'Monthly recovery reports with shareable links',
  'CSV imports, alerts, recommendations & audit log',
  'One-click sample data seeder',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    api
      .getBillingPlan()
      .then((res: any) => {
        if (active) setStripeEnabled(Boolean(res?.stripeEnabled))
      })
      .catch(() => {
        if (active) setStripeEnabled(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-black text-emerald-400">
          <span>🔥</span> NonprodBurnWarden
        </Link>
        <div className="flex items-center gap-4 text-sm">
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

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple, honest pricing</h1>
        <p className="mt-4 text-lg text-slate-400">
          Every feature is free for signed-in users. No seat limits, no usage metering, no credit card.
        </p>
      </section>

      <section className="mx-auto max-w-2xl px-6 pb-24">
        <div className="rounded-2xl border border-emerald-500/40 bg-slate-900 p-8">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-bold text-emerald-300">Free</h2>
              <p className="mt-1 text-sm text-slate-400">Everything, for everyone.</p>
            </div>
            <div className="text-right">
              <span className="text-4xl font-black">$0</span>
              <span className="text-sm text-slate-500"> / month</span>
            </div>
          </div>

          <ul className="mt-8 space-y-3">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-0.5 text-emerald-400">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/auth/sign-up"
            className="mt-8 block w-full rounded-lg bg-emerald-400 py-3 text-center font-semibold text-slate-950 hover:bg-emerald-300"
          >
            Start for free
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          {stripeEnabled === null
            ? 'Checking billing status...'
            : stripeEnabled
              ? 'An optional Pro plan is available for organizations that want it.'
              : 'A Pro plan is wired but currently disabled. Billing is optional and the product is fully free today.'}
        </p>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>NonprodBurnWarden — per-environment idle-spend ledger and schedule-ROI model.</p>
      </footer>
    </main>
  )
}
