'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Resource = { id: string; name?: string; resource_type?: string; provider?: string; region?: string }
type Finding = {
  id: string
  resource_id?: string
  environment_id?: string
  finding_type?: string
  reason?: string
  severity?: string
  age_days?: number
  monthly_cost_cents?: number
  status?: string
  created_at?: string
  resource?: Resource
}

const STATUSES = ['open', 'acknowledged', 'dismissed', 'recovered'] as const
type Status = (typeof STATUSES)[number]

function money(cents?: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function sevTone(sev?: string): 'danger' | 'warning' | 'info' | 'default' {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'danger'
    case 'medium':
      return 'warning'
    case 'low':
      return 'info'
    default:
      return 'default'
  }
}

function statusTone(s?: string): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  switch ((s || '').toLowerCase()) {
    case 'open':
      return 'warning'
    case 'acknowledged':
      return 'info'
    case 'dismissed':
      return 'default'
    case 'recovered':
      return 'success'
    default:
      return 'default'
  }
}

function titleCase(s?: string): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function OrphansPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [findings, setFindings] = useState<Finding[]>([])
  const [detecting, setDetecting] = useState(false)
  const [detectMsg, setDetectMsg] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function loadFindings(wsId: string, status: 'all' | Status) {
    const query: Record<string, string> = { workspace_id: wsId }
    if (status !== 'all') query.status = status
    const res = await api.getOrphans(query)
    setFindings(Array.isArray(res) ? res : [])
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
        await loadFindings(wsId, 'all')
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load orphan findings')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // refetch when server-side status filter changes
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      try {
        await loadFindings(workspaceId, statusFilter)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load orphan findings')
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const f of findings) if (f.finding_type) set.add(f.finding_type)
    return Array.from(set).sort()
  }, [findings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return findings.filter((f) => {
      if (typeFilter !== 'all' && f.finding_type !== typeFilter) return false
      if (q) {
        const hay = `${f.resource?.name ?? ''} ${f.reason ?? ''} ${f.finding_type ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [findings, typeFilter, search])

  const totals = useMemo(() => {
    let monthly = 0
    let open = 0
    let recovered = 0
    for (const f of findings) {
      monthly += f.monthly_cost_cents ?? 0
      if ((f.status || '').toLowerCase() === 'open') open += 1
      if ((f.status || '').toLowerCase() === 'recovered') recovered += f.monthly_cost_cents ?? 0
    }
    return { monthly, open, recovered }
  }, [findings])

  async function runDetect() {
    if (!workspaceId) return
    setDetecting(true)
    setDetectMsg(null)
    setError(null)
    try {
      const res = await api.detectOrphans({ workspace_id: workspaceId })
      const created = res?.findings_created ?? 0
      const byType = res?.by_type
        ? Object.entries(res.by_type)
            .map(([k, v]) => `${titleCase(k)}: ${v}`)
            .join(', ')
        : ''
      setDetectMsg(`Detection complete — ${created} finding(s) created${byType ? ` (${byType})` : ''}.`)
      await loadFindings(workspaceId, statusFilter)
    } catch (e: any) {
      setError(e?.message || 'Orphan detection failed')
    } finally {
      setDetecting(false)
    }
  }

  async function changeStatus(f: Finding, status: Status) {
    if (!workspaceId) return
    setBusyId(f.id)
    setError(null)
    try {
      await api.setOrphanStatus(f.id, { workspace_id: workspaceId, status })
      // optimistic update; if server filter active and status no longer matches, reload
      if (statusFilter !== 'all' && status !== statusFilter) {
        await loadFindings(workspaceId, statusFilter)
      } else {
        setFindings((prev) => prev.map((x) => (x.id === f.id ? { ...x, status } : x)))
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update status')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading orphan findings..." />

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        <Header onDetect={runDetect} detecting={detecting} disabled />
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard to detect orphaned resources."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onDetect={runDetect} detecting={detecting} />

      {detectMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {detectMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Wasted Spend / mo" value={money(totals.monthly)} tone="danger" sub="Across all findings" />
        <Stat label="Open Findings" value={totals.open} tone="warning" sub="Need triage" />
        <Stat label="Recovered / mo" value={money(totals.recovered)} tone="success" sub="Marked recovered" />
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
              placeholder="Search findings…"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={findings.length === 0 ? 'No orphan findings' : 'No findings match your filters'}
                description={
                  findings.length === 0
                    ? 'Run detection to scan for sandbox-age, forgotten previews, and zero-usage resources.'
                    : 'Try clearing the type filter or search term.'
                }
                action={
                  findings.length === 0 ? (
                    <Button onClick={runDetect} disabled={detecting}>
                      {detecting ? 'Detecting…' : 'Run Detection'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Resource</TH>
                  <TH>Type</TH>
                  <TH>Reason</TH>
                  <TH>Severity</TH>
                  <TH className="text-right">Age</TH>
                  <TH className="text-right">Cost / mo</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((f) => {
                  const status = (f.status || 'open').toLowerCase() as Status
                  return (
                    <TR key={f.id}>
                      <TD className="text-slate-100">
                        <div className="font-medium">{f.resource?.name || f.resource_id?.slice(0, 8) || '—'}</div>
                        {f.resource?.provider && (
                          <div className="text-xs text-slate-500">
                            {f.resource.provider}
                            {f.resource.region ? ` · ${f.resource.region}` : ''}
                          </div>
                        )}
                      </TD>
                      <TD>{titleCase(f.finding_type)}</TD>
                      <TD className="max-w-xs text-slate-400">{f.reason || '—'}</TD>
                      <TD>
                        <Badge tone={sevTone(f.severity)}>{titleCase(f.severity) || 'Unknown'}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{f.age_days != null ? `${f.age_days}d` : '—'}</TD>
                      <TD className="text-right tabular-nums text-red-300">{money(f.monthly_cost_cents)}</TD>
                      <TD>
                        <Badge tone={statusTone(status)} className="capitalize">
                          {status}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        <div className="inline-flex gap-1">
                          {status !== 'acknowledged' && status !== 'recovered' && (
                            <Button
                              variant="secondary"
                              className="px-2 py-1 text-xs"
                              disabled={busyId === f.id}
                              onClick={() => changeStatus(f, 'acknowledged')}
                            >
                              Ack
                            </Button>
                          )}
                          {status !== 'recovered' && (
                            <Button
                              className="px-2 py-1 text-xs"
                              disabled={busyId === f.id}
                              onClick={() => changeStatus(f, 'recovered')}
                            >
                              Recover
                            </Button>
                          )}
                          {status !== 'dismissed' && (
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs"
                              disabled={busyId === f.id}
                              onClick={() => changeStatus(f, 'dismissed')}
                            >
                              Dismiss
                            </Button>
                          )}
                          {(status === 'dismissed' || status === 'recovered') && (
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs"
                              disabled={busyId === f.id}
                              onClick={() => changeStatus(f, 'open')}
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Header({
  onDetect,
  detecting,
  disabled,
}: {
  onDetect: () => void
  detecting: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Orphaned Resources</h1>
        <p className="mt-1 text-sm text-slate-500">
          Forgotten sandboxes, stale previews, and zero-usage resources quietly burning budget.
        </p>
      </div>
      <Button onClick={onDetect} disabled={detecting || disabled}>
        {detecting ? 'Detecting…' : 'Run Detection'}
      </Button>
    </div>
  )
}
