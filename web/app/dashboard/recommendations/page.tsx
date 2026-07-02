'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type Recommendation = {
  id: string
  environment_id?: string
  schedule_id?: string
  orphan_finding_id?: string
  rec_type?: string
  title?: string
  detail?: string
  recoverable_cents?: number
  status?: string
  created_at?: string
}

const STATUSES = ['open', 'applied', 'dismissed'] as const
type Status = (typeof STATUSES)[number]

function money(cents?: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function titleCase(s?: string): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function statusTone(s?: string): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  switch ((s || '').toLowerCase()) {
    case 'open':
      return 'warning'
    case 'applied':
      return 'success'
    case 'dismissed':
      return 'default'
    default:
      return 'default'
  }
}

function typeTone(t?: string): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  switch ((t || '').toLowerCase()) {
    case 'orphan':
    case 'delete':
      return 'danger'
    case 'schedule':
      return 'info'
    default:
      return 'default'
  }
}

export default function RecommendationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [recs, setRecs] = useState<Recommendation[]>([])
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function loadRecs(wsId: string) {
    const res = await api.getRecommendations(wsId)
    setRecs(Array.isArray(res) ? res : [])
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
        await loadRecs(wsId)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load recommendations')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const r of recs) if (r.rec_type) set.add(r.rec_type)
    return Array.from(set).sort()
  }, [recs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recs
      .filter((r) => {
        if (statusFilter !== 'all' && (r.status || 'open').toLowerCase() !== statusFilter) return false
        if (typeFilter !== 'all' && r.rec_type !== typeFilter) return false
        if (q) {
          const hay = `${r.title ?? ''} ${r.detail ?? ''} ${r.rec_type ?? ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => (b.recoverable_cents ?? 0) - (a.recoverable_cents ?? 0))
  }, [recs, statusFilter, typeFilter, search])

  const totals = useMemo(() => {
    let open = 0
    let openRecoverable = 0
    let appliedRecoverable = 0
    for (const r of recs) {
      const st = (r.status || 'open').toLowerCase()
      if (st === 'open') {
        open += 1
        openRecoverable += r.recoverable_cents ?? 0
      } else if (st === 'applied') {
        appliedRecoverable += r.recoverable_cents ?? 0
      }
    }
    return { open, openRecoverable, appliedRecoverable }
  }, [recs])

  const maxRecoverable = Math.max(1, ...filtered.map((r) => r.recoverable_cents ?? 0))

  async function runGenerate() {
    if (!workspaceId) return
    setGenerating(true)
    setGenMsg(null)
    setError(null)
    try {
      const res = await api.generateRecommendations({ workspace_id: workspaceId })
      const created = res?.created ?? 0
      const total = res?.total_recoverable_cents
      setGenMsg(
        `Generated ${created} recommendation(s)${
          total != null ? ` worth ${money(total)} / mo recoverable` : ''
        }.`,
      )
      await loadRecs(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to generate recommendations')
    } finally {
      setGenerating(false)
    }
  }

  async function changeStatus(r: Recommendation, status: Status) {
    if (!workspaceId) return
    setBusyId(r.id)
    setError(null)
    try {
      await api.setRecommendationStatus(r.id, { workspace_id: workspaceId, status })
      setRecs((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)))
    } catch (e: any) {
      setError(e?.message || 'Failed to update recommendation')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading recommendations..." />

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        <Header onGenerate={runGenerate} generating={generating} disabled />
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard to generate recommendations."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onGenerate={runGenerate} generating={generating} />

      {genMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {genMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Recoverable / mo"
          value={money(totals.openRecoverable)}
          tone="success"
          sub="From open recommendations"
        />
        <Stat label="Open Recommendations" value={totals.open} tone="warning" sub="Awaiting action" />
        <Stat
          label="Applied / mo"
          value={money(totals.appliedRecoverable)}
          tone="default"
          sub="Recoverable from applied"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(['all', ...STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'border-emerald-500/50 bg-emerald-400/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recommendations…"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={recs.length === 0 ? 'No recommendations yet' : 'No recommendations match your filters'}
              description={
                recs.length === 0
                  ? 'Generate recommendations from your savings estimates and orphan findings.'
                  : 'Try clearing the type filter or search term.'
              }
              action={
                recs.length === 0 ? (
                  <Button onClick={runGenerate} disabled={generating}>
                    {generating ? 'Generating…' : 'Generate Recommendations'}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ol className="space-y-3">
              {filtered.map((r, i) => {
                const status = (r.status || 'open').toLowerCase() as Status
                return (
                  <li
                    key={r.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 transition-colors hover:border-slate-700"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold tabular-nums text-slate-600">#{i + 1}</span>
                          {r.rec_type && <Badge tone={typeTone(r.rec_type)}>{titleCase(r.rec_type)}</Badge>}
                          <Badge tone={statusTone(status)} className="capitalize">
                            {status}
                          </Badge>
                        </div>
                        <h3 className="mt-2 text-sm font-semibold text-slate-100">{r.title || 'Recommendation'}</h3>
                        {r.detail && <p className="mt-1 text-sm text-slate-400">{r.detail}</p>}
                        <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-400"
                            style={{ width: `${((r.recoverable_cents ?? 0) / maxRecoverable) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-3">
                        <div className="text-right">
                          <div className="text-lg font-bold tabular-nums text-emerald-300">
                            {money(r.recoverable_cents)}
                          </div>
                          <div className="text-xs text-slate-500">recoverable / mo</div>
                        </div>
                        <div className="inline-flex gap-1">
                          {status !== 'applied' && (
                            <Button
                              className="px-2 py-1 text-xs"
                              disabled={busyId === r.id}
                              onClick={() => changeStatus(r, 'applied')}
                            >
                              Apply
                            </Button>
                          )}
                          {status !== 'dismissed' && (
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs"
                              disabled={busyId === r.id}
                              onClick={() => changeStatus(r, 'dismissed')}
                            >
                              Dismiss
                            </Button>
                          )}
                          {status !== 'open' && (
                            <Button
                              variant="secondary"
                              className="px-2 py-1 text-xs"
                              disabled={busyId === r.id}
                              onClick={() => changeStatus(r, 'open')}
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Header({
  onGenerate,
  generating,
  disabled,
}: {
  onGenerate: () => void
  generating: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Recommendations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ranked, actionable ways to cut nonprod burn — sourced from savings estimates and orphan findings.
        </p>
      </div>
      <Button onClick={onGenerate} disabled={generating || disabled}>
        {generating ? 'Generating…' : 'Generate Recommendations'}
      </Button>
    </div>
  )
}
