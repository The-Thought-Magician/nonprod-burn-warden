'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Allocation = {
  id: string
  workspace_id: string
  team_id?: string | null
  team_name?: string | null
  environment_id?: string | null
  period: string
  allocated_cents?: number | null
  wasted_cents?: number | null
  created_at?: string | null
}

type StatementTeam = {
  team_id: string
  team_name?: string | null
  allocated_cents?: number | null
  wasted_cents?: number | null
}

type Statement = {
  period: string
  teams: StatementTeam[]
  unallocated_cents?: number | null
}

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ShowbackPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [period, setPeriod] = useState(currentPeriod())
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [statement, setStatement] = useState<Statement | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [teamFilter, setTeamFilter] = useState('')

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nbw_workspace_id') : null
    const workspaces = await api.getWorkspaces().catch(() => [])
    const list: any[] = Array.isArray(workspaces) ? workspaces : []
    if (stored && list.some((w) => w.id === stored)) return stored
    const first = list[0]?.id ?? null
    if (first && typeof window !== 'undefined') localStorage.setItem('nbw_workspace_id', first)
    return first
  }, [])

  const loadData = useCallback(async (wsId: string, periodFilter: string) => {
    const query: Record<string, string> = { workspace_id: wsId }
    if (periodFilter) query.period = periodFilter
    const [allocRes, statementRes] = await Promise.all([
      api.getShowback(query),
      periodFilter
        ? api.getShowbackStatement({ workspace_id: wsId, period: periodFilter }).catch(() => null)
        : Promise.resolve(null),
    ])
    setAllocations(Array.isArray(allocRes) ? allocRes : [])
    setStatement(statementRes ?? null)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const wsId = await resolveWorkspace()
        if (!active) return
        if (!wsId) {
          setWorkspaceId(null)
          setLoading(false)
          return
        }
        setWorkspaceId(wsId)
        await loadData(wsId, period)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load showback.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveWorkspace, loadData])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      await loadData(workspaceId, period)
    } catch (e: any) {
      setError(e?.message || 'Failed to reload showback.')
    }
  }, [workspaceId, period, loadData])

  const onPeriodChange = useCallback(
    (next: string) => {
      setPeriod(next)
      if (workspaceId) loadData(workspaceId, next).catch((err: any) => setError(err?.message || 'Filter failed.'))
    },
    [workspaceId, loadData],
  )

  const onRebuild = useCallback(async () => {
    if (!workspaceId) return
    if (!period) {
      setError('Select a period before rebuilding showback.')
      return
    }
    setRebuilding(true)
    setError(null)
    setNotice(null)
    try {
      const res: any = await api.rebuildShowback({ workspace_id: workspaceId, period })
      const created = res?.allocations_created ?? 0
      const unalloc = res?.unallocated_cents
      setNotice(
        `Rebuilt showback for ${period} — ${created} allocation${created === 1 ? '' : 's'}` +
          (unalloc != null ? `, ${dollars(unalloc)} unallocated.` : '.'),
      )
      await loadData(workspaceId, period)
    } catch (e: any) {
      setError(e?.message || 'Rebuild failed.')
    } finally {
      setRebuilding(false)
    }
  }, [workspaceId, period, loadData])

  // Prefer the statement's per-team rows; fall back to aggregating raw allocations.
  const statementTeams = useMemo<StatementTeam[]>(() => {
    if (statement && Array.isArray(statement.teams) && statement.teams.length > 0) {
      return statement.teams
    }
    const byTeam = new Map<string, StatementTeam>()
    for (const a of allocations) {
      const key = a.team_id || 'unallocated'
      const cur = byTeam.get(key) || {
        team_id: key,
        team_name: a.team_name ?? null,
        allocated_cents: 0,
        wasted_cents: 0,
      }
      cur.allocated_cents = (cur.allocated_cents ?? 0) + (a.allocated_cents ?? 0)
      cur.wasted_cents = (cur.wasted_cents ?? 0) + (a.wasted_cents ?? 0)
      if (!cur.team_name && a.team_name) cur.team_name = a.team_name
      byTeam.set(key, cur)
    }
    return Array.from(byTeam.values())
  }, [statement, allocations])

  const filteredTeams = useMemo(() => {
    const q = teamFilter.trim().toLowerCase()
    let rows = statementTeams
    if (q) {
      rows = rows.filter((t) =>
        (t.team_name || t.team_id || '').toLowerCase().includes(q),
      )
    }
    return [...rows].sort((a, b) => (b.allocated_cents ?? 0) - (a.allocated_cents ?? 0))
  }, [statementTeams, teamFilter])

  const totals = useMemo(() => {
    const allocated = statementTeams.reduce((s, t) => s + (t.allocated_cents ?? 0), 0)
    const wasted = statementTeams.reduce((s, t) => s + (t.wasted_cents ?? 0), 0)
    const unallocated = statement?.unallocated_cents ?? 0
    return { allocated, wasted, unallocated, grand: allocated + unallocated }
  }, [statementTeams, statement])

  const maxAllocated = statementTeams.reduce((m, t) => Math.max(m, t.allocated_cents ?? 0), 0) || 1

  const periods = useMemo(() => {
    const set = new Set<string>([currentPeriod()])
    allocations.forEach((a) => a.period && set.add(a.period))
    if (period) set.add(period)
    return Array.from(set).sort().reverse()
  }, [allocations, period])

  if (loading) return <PageSpinner label="Loading showback..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before viewing showback."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Showback</h1>
          <p className="mt-1 text-sm text-slate-500">
            Attribute cloud spend and idle waste back to each team for a given period, with an unallocated bucket
            for spend not yet owned.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={refresh} disabled={rebuilding}>
            Refresh
          </Button>
          <Button onClick={onRebuild} disabled={rebuilding}>
            {rebuilding ? 'Rebuilding…' : 'Rebuild showback'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Allocated" value={dollars(totals.allocated)} sub={`${statementTeams.length} team${statementTeams.length === 1 ? '' : 's'}`} />
        <Stat label="Idle waste" value={dollars(totals.wasted)} tone="warning" />
        <Stat label="Unallocated" value={dollars(totals.unallocated)} tone={totals.unallocated > 0 ? 'danger' : 'success'} />
        <Stat label="Total spend" value={dollars(totals.grand)} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Statement — {statement?.period || period}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Per-team allocated spend and attributed waste.</p>
          </div>
          <input
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            placeholder="Search teams…"
            className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filteredTeams.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={statementTeams.length === 0 ? 'No allocations for this period' : 'No matching teams'}
                description={
                  statementTeams.length === 0
                    ? 'Rebuild showback to recompute team allocations from the waste ledger and cost records for this period.'
                    : 'Try a different search term.'
                }
                action={
                  statementTeams.length === 0 ? (
                    <Button onClick={onRebuild} disabled={rebuilding}>
                      {rebuilding ? 'Rebuilding…' : 'Rebuild showback'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Team</TH>
                  <TH className="w-2/5">Allocated spend</TH>
                  <TH className="text-right">Idle waste</TH>
                  <TH className="text-right">Waste %</TH>
                </TR>
              </THead>
              <TBody>
                {filteredTeams.map((t) => {
                  const allocated = t.allocated_cents ?? 0
                  const wasted = t.wasted_cents ?? 0
                  const wastePct = allocated > 0 ? (wasted / allocated) * 100 : 0
                  const isUnallocated = !t.team_id || t.team_id === 'unallocated'
                  return (
                    <TR key={t.team_id || 'unallocated'}>
                      <TD>
                        {isUnallocated ? (
                          <Badge tone="danger">Unallocated</Badge>
                        ) : (
                          <span className="font-medium text-slate-100">{t.team_name || t.team_id}</span>
                        )}
                      </TD>
                      <TD>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="tabular-nums font-medium text-slate-200">{dollars(allocated)}</span>
                          {totals.allocated > 0 && (
                            <span className="tabular-nums text-slate-500">
                              {Math.round((allocated / totals.allocated) * 100)}%
                            </span>
                          )}
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-400"
                            style={{ width: `${Math.max(2, (allocated / maxAllocated) * 100)}%` }}
                          />
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums text-emerald-300">{dollars(wasted)}</TD>
                      <TD className="text-right tabular-nums">
                        <Badge tone={wastePct >= 30 ? 'danger' : wastePct >= 15 ? 'warning' : 'default'}>
                          {wastePct.toFixed(0)}%
                        </Badge>
                      </TD>
                    </TR>
                  )
                })}
                {totals.unallocated > 0 && !filteredTeams.some((t) => !t.team_id || t.team_id === 'unallocated') && (
                  <TR>
                    <TD>
                      <Badge tone="danger">Unallocated</Badge>
                    </TD>
                    <TD>
                      <span className="tabular-nums text-slate-400">{dollars(totals.unallocated)}</span>
                    </TD>
                    <TD className="text-right text-slate-600">—</TD>
                    <TD className="text-right text-slate-600">—</TD>
                  </TR>
                )}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-slate-200">Allocation detail</h3>
          <p className="mt-0.5 text-xs text-slate-500">Raw allocation rows per team and environment for this period.</p>
        </CardHeader>
        <CardBody className="p-0">
          {allocations.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-slate-500">No allocation rows for this period.</p>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Team</TH>
                  <TH>Environment</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Allocated</TH>
                  <TH className="text-right">Waste</TH>
                </TR>
              </THead>
              <TBody>
                {[...allocations]
                  .sort((a, b) => (b.allocated_cents ?? 0) - (a.allocated_cents ?? 0))
                  .map((a) => (
                    <TR key={a.id}>
                      <TD>
                        {a.team_id ? (
                          <span className="text-slate-200">{a.team_name || a.team_id}</span>
                        ) : (
                          <span className="text-slate-600">unallocated</span>
                        )}
                      </TD>
                      <TD>
                        {a.environment_id ? (
                          <Badge tone="info">{a.environment_id}</Badge>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TD>
                      <TD>
                        <span className="text-slate-400">{a.period}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{dollars(a.allocated_cents)}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{dollars(a.wasted_cents)}</TD>
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
