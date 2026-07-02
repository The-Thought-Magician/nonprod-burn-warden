'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'

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
  created_at?: string
}

function money(cents?: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function pct(part?: number | null, whole?: number | null): string {
  if (!whole) return '—'
  return `${Math.round(((part ?? 0) / whole) * 100)}%`
}

function fmtDateTime(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function defaultPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function ReportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [reports, setReports] = useState<Report[]>([])
  const [search, setSearch] = useState('')

  const [genOpen, setGenOpen] = useState(false)
  const [genPeriod, setGenPeriod] = useState(defaultPeriod())
  const [genTitle, setGenTitle] = useState('')
  const [generating, setGenerating] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)

  async function loadReports(wsId: string) {
    const res = await api.getReports(wsId)
    setReports(Array.isArray(res) ? res : [])
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const ws = await api.getWorkspaces()
        const list = Array.isArray(ws) ? ws : []
        if (!list.length) {
          if (active) setLoading(false)
          return
        }
        const wsId = list[0].id
        if (!active) return
        setWorkspaceId(wsId)
        await loadReports(wsId)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load reports')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function generate() {
    if (!workspaceId || !genPeriod.trim()) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = { workspace_id: workspaceId, period: genPeriod.trim() }
      if (genTitle.trim()) body.title = genTitle.trim()
      await api.generateReport(body)
      setGenOpen(false)
      setGenTitle('')
      setGenPeriod(defaultPeriod())
      await loadReports(workspaceId)
      setNotice(`Recovery report generated for ${body.period}.`)
    } catch (e: any) {
      setError(e?.message || 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  async function remove(r: Report) {
    if (!confirm(`Delete report "${r.title || r.period}"?`)) return
    setBusyId(r.id)
    setError(null)
    try {
      await api.deleteReport(r.id)
      setReports((prev) => prev.filter((x) => x.id !== r.id))
      setNotice('Report deleted.')
    } catch (e: any) {
      setError(e?.message || 'Failed to delete report')
    } finally {
      setBusyId(null)
    }
  }

  async function copyShareLink(r: Report) {
    if (!r.share_token) return
    const url = `${window.location.origin}/reports/shared/${r.share_token}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice('Share link copied to clipboard.')
    } catch {
      setNotice(`Share link: ${url}`)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports
      .filter((r) => {
        if (!q) return true
        return `${r.title ?? ''} ${r.period ?? ''}`.toLowerCase().includes(q)
      })
      .sort((a, b) => (b.period || '').localeCompare(a.period || ''))
  }, [reports, search])

  const totals = useMemo(() => {
    let recoverable = 0
    let recovered = 0
    let waste = 0
    for (const r of reports) {
      recoverable += r.recoverable_cents ?? 0
      recovered += r.recovered_cents ?? 0
      waste += r.idle_waste_cents ?? 0
    }
    return { recoverable, recovered, waste }
  }, [reports])

  if (loading) return <PageSpinner label="Loading recovery reports..." />

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        <Header onGenerate={() => {}} disabled />
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before generating recovery reports."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onGenerate={() => setGenOpen(true)} />

      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Recoverable / total" value={money(totals.recoverable)} tone="warning" sub="Across all reports" />
        <Stat label="Recovered" value={money(totals.recovered)} tone="success" sub="Realized savings booked" />
        <Stat label="Idle Waste" value={money(totals.waste)} tone="danger" sub="Detected non-prod idle burn" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-200">All Reports</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or period…"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none sm:w-64"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={reports.length === 0 ? 'No recovery reports yet' : 'No reports match your search'}
                description={
                  reports.length === 0
                    ? 'Generate a report for a period to capture spend, idle waste, and recoverable savings with a shareable executive summary.'
                    : 'Try a different title or period.'
                }
                action={
                  reports.length === 0 ? (
                    <Button onClick={() => setGenOpen(true)}>Generate Report</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Report</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Total Spend</TH>
                  <TH className="text-right">Idle Waste</TH>
                  <TH className="text-right">Recoverable</TH>
                  <TH className="text-right">Recovered</TH>
                  <TH>Share</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="text-slate-100">
                      <Link href={`/dashboard/reports/${r.id}`} className="font-medium hover:text-emerald-300">
                        {r.title || `Recovery Report — ${r.period}`}
                      </Link>
                      <div className="text-xs text-slate-500">{fmtDateTime(r.created_at)}</div>
                    </TD>
                    <TD className="tabular-nums">{r.period || '—'}</TD>
                    <TD className="text-right tabular-nums">{money(r.total_spend_cents)}</TD>
                    <TD className="text-right tabular-nums text-red-300">{money(r.idle_waste_cents)}</TD>
                    <TD className="text-right tabular-nums text-emerald-300">{money(r.recoverable_cents)}</TD>
                    <TD className="text-right tabular-nums text-emerald-300">{money(r.recovered_cents)}</TD>
                    <TD>
                      {r.share_token ? (
                        <Badge tone="info">Shareable</Badge>
                      ) : (
                        <Badge tone="default">Private</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="inline-flex gap-1">
                        <Link href={`/dashboard/reports/${r.id}`}>
                          <Button variant="secondary" className="px-2 py-1 text-xs">
                            View
                          </Button>
                        </Link>
                        {r.share_token && (
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-xs"
                            onClick={() => copyShareLink(r)}
                          >
                            Copy link
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          disabled={busyId === r.id}
                          onClick={() => remove(r)}
                        >
                          {busyId === r.id ? '…' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate Recovery Report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={generating || !genPeriod.trim()}>
              {generating ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Period</label>
            <input
              type="month"
              value={genPeriod}
              onChange={(e) => setGenPeriod(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              The report aggregates spend, idle waste, and recoverable savings for this period.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Title (optional)
            </label>
            <input
              value={genTitle}
              onChange={(e) => setGenTitle(e.target.value)}
              placeholder={`Recovery Report — ${genPeriod}`}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Header({ onGenerate, disabled }: { onGenerate: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Recovery Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Period snapshots of cloud spend, idle waste, and recoverable savings, with a shareable executive summary.
        </p>
      </div>
      <Button onClick={onGenerate} disabled={disabled}>
        + Generate Report
      </Button>
    </div>
  )
}
