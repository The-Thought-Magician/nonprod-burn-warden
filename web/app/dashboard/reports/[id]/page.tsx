'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type LineItem = {
  id: string
  environment_id?: string | null
  team_id?: string | null
  label?: string
  spend_cents?: number
  waste_cents?: number
  recoverable_cents?: number
}

type Report = {
  id: string
  workspace_id?: string
  period?: string
  title?: string
  total_spend_cents?: number
  nonprod_spend_cents?: number
  idle_waste_cents?: number
  recoverable_cents?: number
  recovered_cents?: number
  share_token?: string
  summary?: Record<string, unknown> | string | null
  created_at?: string
  line_items?: LineItem[]
}

function money(cents?: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function moneyPrecise(cents?: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function pct(part?: number | null, whole?: number | null): number {
  if (!whole) return 0
  return Math.round(((part ?? 0) / whole) * 100)
}

function fmtDateTime(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Render summary jsonb whether it's a string, an array of bullet strings,
// or an object of key/value facts.
function summaryLines(summary: Report['summary']): { bullets: string[]; facts: [string, string][] } {
  if (!summary) return { bullets: [], facts: [] }
  if (typeof summary === 'string') return { bullets: [summary], facts: [] }
  if (Array.isArray(summary)) return { bullets: summary.map((s) => String(s)), facts: [] }
  const bullets: string[] = []
  const facts: [string, string][] = []
  for (const [k, v] of Object.entries(summary)) {
    if (Array.isArray(v)) {
      for (const item of v) bullets.push(String(item))
    } else if (v && typeof v === 'object') {
      facts.push([k, JSON.stringify(v)])
    } else {
      const key = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      if (k === 'headline' || k === 'summary' || k === 'narrative') bullets.push(String(v))
      else facts.push([key, String(v)])
    }
  }
  return { bullets, facts }
}

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.getReport(id)
        if (active) setReport(res)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load report')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id])

  const lineItems = useMemo(() => report?.line_items ?? [], [report])

  const shareUrl = useMemo(() => {
    if (!report?.share_token || typeof window === 'undefined') return null
    return `${window.location.origin}/reports/shared/${report.share_token}`
  }, [report])

  async function copyShare() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable; link is shown inline */
    }
  }

  const summary = useMemo(() => summaryLines(report?.summary), [report])

  const maxRecoverable = useMemo(
    () => lineItems.reduce((m, li) => Math.max(m, li.recoverable_cents ?? 0), 0),
    [lineItems],
  )

  if (loading) return <PageSpinner label="Loading report..." />

  if (error || !report) {
    return (
      <div className="space-y-6">
        <Link href="/dashboard/reports" className="text-sm text-slate-500 hover:text-emerald-300">
          ← Back to reports
        </Link>
        <EmptyState
          title="Report not available"
          description={error || 'This recovery report could not be found.'}
          action={
            <Link href="/dashboard/reports">
              <Button>Back to Reports</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const recoveredPct = pct(report.recovered_cents, report.recoverable_cents)
  const wastePct = pct(report.idle_waste_cents, report.nonprod_spend_cents || report.total_spend_cents)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/reports" className="text-sm text-slate-500 hover:text-emerald-300">
          ← Back to reports
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">
              {report.title || `Recovery Report — ${report.period}`}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <Badge tone="warning">{report.period || '—'}</Badge>
              <span>Generated {fmtDateTime(report.created_at)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {shareUrl ? (
              <>
                <Button variant="secondary" onClick={copyShare}>
                  {copied ? 'Copied!' : 'Copy Share Link'}
                </Button>
                <Link href={`/reports/shared/${report.share_token}`} target="_blank">
                  <Button variant="ghost">Open Public View ↗</Button>
                </Link>
              </>
            ) : (
              <Badge tone="default">No share link</Badge>
            )}
          </div>
        </div>
      </div>

      {shareUrl && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Public read-only link</div>
          <code className="mt-1 block break-all text-xs text-emerald-300">{shareUrl}</code>
        </div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total Spend" value={money(report.total_spend_cents)} sub="All resources" />
        <Stat
          label="Non-prod Spend"
          value={money(report.nonprod_spend_cents)}
          sub={`${pct(report.nonprod_spend_cents, report.total_spend_cents)}% of total`}
        />
        <Stat label="Idle Waste" value={money(report.idle_waste_cents)} tone="danger" sub={`${wastePct}% of non-prod`} />
        <Stat label="Recoverable" value={money(report.recoverable_cents)} tone="warning" sub="Potential savings" />
        <Stat
          label="Recovered"
          value={money(report.recovered_cents)}
          tone="success"
          sub={`${recoveredPct}% of recoverable`}
        />
      </div>

      {/* Recovery progress bar */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Recovery Progress</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{money(report.recovered_cents)} recovered</span>
            <span>{money(report.recoverable_cents)} recoverable</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
              style={{ width: `${Math.min(100, recoveredPct)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {recoveredPct}% of identified recoverable spend has been booked as recovered.
          </p>
        </CardBody>
      </Card>

      {/* Executive summary */}
      {(summary.bullets.length > 0 || summary.facts.length > 0) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Executive Summary</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {summary.bullets.length > 0 && (
              <ul className="space-y-2">
                {summary.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-300">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.facts.length > 0 && (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {summary.facts.map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
                    <dd className="mt-1 text-sm text-slate-200">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>
      )}

      {/* Line items */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Line Items by Environment / Team</h2>
        </CardHeader>
        <CardBody className="p-0">
          {lineItems.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No line items"
                description="This report has no per-environment or per-team breakdown."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Waste</TH>
                  <TH className="text-right">Recoverable</TH>
                  <TH className="w-40">Recoverable share</TH>
                </TR>
              </THead>
              <TBody>
                {[...lineItems]
                  .sort((a, b) => (b.recoverable_cents ?? 0) - (a.recoverable_cents ?? 0))
                  .map((li) => (
                    <TR key={li.id}>
                      <TD className="font-medium text-slate-100">{li.label || '—'}</TD>
                      <TD className="text-right tabular-nums">{moneyPrecise(li.spend_cents)}</TD>
                      <TD className="text-right tabular-nums text-red-300">{moneyPrecise(li.waste_cents)}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{moneyPrecise(li.recoverable_cents)}</TD>
                      <TD>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-400/80"
                            style={{
                              width: `${
                                maxRecoverable ? Math.round(((li.recoverable_cents ?? 0) / maxRecoverable) * 100) : 0
                              }%`,
                            }}
                          />
                        </div>
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
