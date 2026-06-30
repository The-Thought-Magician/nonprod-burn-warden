'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import api from '@/lib/api'

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPct(num: number, denom: number): string {
  if (!denom) return '0%'
  return `${Math.round((num / denom) * 100)}%`
}

interface LineItem {
  id: string
  label: string
  spend_cents: number
  waste_cents: number
  recoverable_cents: number
  environment_id?: string | null
  team_id?: string | null
}

interface SharedReport {
  id: string
  period: string
  title: string
  total_spend_cents: number
  nonprod_spend_cents: number
  idle_waste_cents: number
  recoverable_cents: number
  recovered_cents: number
  created_at: string
  line_items: LineItem[]
  summary?: Record<string, unknown> | null
}

export default function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [report, setReport] = useState<SharedReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await api.getSharedReport(token)
        if (!active) return
        setReport(data)
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Report not found')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [token])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-yellow-400" />
      </main>
    )
  }

  if (error || !report) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mb-3 text-3xl">🔥</div>
          <h1 className="text-lg font-semibold text-zinc-100">Report unavailable</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {error || 'This shared report link is invalid or has expired.'}
          </p>
        </div>
      </main>
    )
  }

  const items = report.line_items ?? []
  const maxRecoverable = Math.max(1, ...items.map((i) => i.recoverable_cents ?? 0))

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* Brand bar */}
        <div className="mb-8 flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔥</span>
            <span className="text-sm font-bold tracking-tight text-zinc-100">NonprodBurnWarden</span>
          </div>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-400">
            Read-only report
          </span>
        </div>

        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{report.period}</p>
        <h1 className="mt-1 text-2xl font-bold text-zinc-100 sm:text-3xl">{report.title}</h1>

        {/* Headline recoverable */}
        <div className="mt-8 rounded-2xl border border-yellow-500/40 bg-gradient-to-br from-yellow-400/10 to-zinc-900 p-8 text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-yellow-300/80">
            Recoverable spend
          </div>
          <div className="mt-2 text-5xl font-black tabular-nums text-yellow-300">
            {fmtMoney(report.recoverable_cents)}
          </div>
          <div className="mt-2 text-sm text-zinc-400">
            {fmtPct(report.recoverable_cents, report.total_spend_cents)} of total cloud spend is recoverable
          </div>
        </div>

        {/* Stat grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Total spend</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-zinc-100">
              {fmtMoney(report.total_spend_cents)}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Non-prod spend</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-zinc-100">
              {fmtMoney(report.nonprod_spend_cents)}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Idle waste</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-red-300">
              {fmtMoney(report.idle_waste_cents)}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Recovered</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-emerald-300">
              {fmtMoney(report.recovered_cents)}
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Breakdown ({items.length})
          </h2>
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center text-sm text-zinc-500">
              No line items recorded for this report.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Line item</th>
                    <th className="px-4 py-3 text-right font-medium">Spend</th>
                    <th className="px-4 py-3 text-right font-medium">Waste</th>
                    <th className="px-4 py-3 text-right font-medium">Recoverable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-900/50">
                      <td className="px-4 py-3 text-zinc-200">
                        <div className="font-medium">{item.label}</div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-yellow-400/70"
                            style={{
                              width: `${Math.round(((item.recoverable_cents ?? 0) / maxRecoverable) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                        {fmtMoney(item.spend_cents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-red-300">
                        {fmtMoney(item.waste_cents)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-yellow-300">
                        {fmtMoney(item.recoverable_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-10 text-center text-xs text-zinc-600">
          Generated by NonprodBurnWarden · {new Date(report.created_at).toLocaleDateString()}
        </p>
      </div>
    </main>
  )
}
