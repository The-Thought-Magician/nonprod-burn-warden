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

type LedgerEntry = {
  id: string
  workspace_id: string
  environment_id?: string | null
  resource_id?: string | null
  team_id?: string | null
  period?: string | null
  idle_hours?: number | null
  off_hours_idle_hours?: number | null
  hourly_rate_cents?: number | null
  wasted_cents?: number | null
  breakdown?: Record<string, unknown> | null
  created_at?: string | null
}

type Bucket = { key: string; cents: number }

type LedgerSummary = {
  monthly_cents?: number
  trailing30_cents?: number
  by_provider?: Bucket[] | Record<string, number>
  by_service?: Bucket[] | Record<string, number>
  by_region?: Bucket[] | Record<string, number>
}

type EnvWaste = {
  environment_id: string
  name?: string | null
  wasted_cents?: number | null
}

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function compactDollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  if (Math.abs(n) >= 1000) {
    return '$' + (n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'k'
  }
  return dollars(cents)
}

function normalizeBuckets(input?: Bucket[] | Record<string, number>): Bucket[] {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((b) => ({ key: b.key, cents: b.cents ?? 0 }))
      .filter((b) => b.key != null)
  }
  return Object.entries(input).map(([key, cents]) => ({ key, cents: cents ?? 0 }))
}

function BreakdownCard({ title, buckets }: { title: string; buckets: Bucket[] }) {
  const sorted = useMemo(() => [...buckets].sort((a, b) => b.cents - a.cents), [buckets])
  const max = sorted.reduce((m, b) => Math.max(m, b.cents), 0) || 1
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      </CardHeader>
      <CardBody>
        {sorted.length === 0 ? (
          <p className="text-sm text-zinc-500">No data.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((b) => (
              <div key={b.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-300">{b.key || 'unknown'}</span>
                  <span className="tabular-nums text-zinc-400">{dollars(b.cents)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-yellow-400"
                    style={{ width: `${Math.max(2, (b.cents / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export default function LedgerPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [summary, setSummary] = useState<LedgerSummary | null>(null)
  const [byEnv, setByEnv] = useState<EnvWaste[]>([])

  const [period, setPeriod] = useState('')
  const [search, setSearch] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nbw_workspace_id') : null
    const workspaces = await api.getWorkspaces().catch(() => [])
    const list: any[] = Array.isArray(workspaces) ? workspaces : []
    if (stored && list.some((w) => w.id === stored)) return stored
    const first = list[0]?.id ?? null
    if (first && typeof window !== 'undefined') localStorage.setItem('nbw_workspace_id', first)
    return first
  }, [])

  const loadData = useCallback(
    async (wsId: string, periodFilter: string) => {
      const query: Record<string, string> = { workspace_id: wsId }
      if (periodFilter) query.period = periodFilter
      const [entriesRes, summaryRes, byEnvRes] = await Promise.all([
        api.getLedger(query),
        api.getLedgerSummary(wsId),
        api.getLedgerByEnvironment(wsId),
      ])
      setEntries(Array.isArray(entriesRes) ? entriesRes : [])
      setSummary(summaryRes ?? null)
      setByEnv(Array.isArray(byEnvRes) ? byEnvRes : [])
    },
    [],
  )

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
        await loadData(wsId, '')
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load waste ledger.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [resolveWorkspace, loadData])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      await loadData(workspaceId, period)
    } catch (e: any) {
      setError(e?.message || 'Failed to reload ledger.')
    }
  }, [workspaceId, period, loadData])

  const onRebuild = useCallback(async () => {
    if (!workspaceId) return
    setRebuilding(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = { workspace_id: workspaceId }
      if (period) body.period = period
      const res: any = await api.rebuildLedger(body)
      const created = res?.entries_created ?? 0
      const total = res?.total_wasted_cents
      setNotice(
        `Rebuilt ledger — ${created} entr${created === 1 ? 'y' : 'ies'}` +
          (total != null ? `, ${dollars(total)} waste recorded.` : '.'),
      )
      await loadData(workspaceId, period)
    } catch (e: any) {
      setError(e?.message || 'Rebuild failed.')
    } finally {
      setRebuilding(false)
    }
  }, [workspaceId, period, loadData])

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = entries
    if (q) {
      rows = rows.filter((e) => {
        const hay = [e.period, e.environment_id, e.team_id, e.resource_id, JSON.stringify(e.breakdown ?? {})]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    return [...rows].sort((a, b) => (b.wasted_cents ?? 0) - (a.wasted_cents ?? 0))
  }, [entries, search])

  const envNameById = useMemo(() => {
    const m = new Map<string, string>()
    byEnv.forEach((e) => m.set(e.environment_id, e.name || e.environment_id))
    return m
  }, [byEnv])

  const totalWasted = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.wasted_cents ?? 0), 0),
    [filteredEntries],
  )

  const periods = useMemo(() => {
    const set = new Set<string>()
    entries.forEach((e) => e.period && set.add(e.period))
    return Array.from(set).sort().reverse()
  }, [entries])

  const byProvider = normalizeBuckets(summary?.by_provider)
  const byService = normalizeBuckets(summary?.by_service)
  const byRegion = normalizeBuckets(summary?.by_region)

  if (loading) return <PageSpinner label="Loading waste ledger..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before viewing the waste ledger."
        />
      </div>
    )
  }

  const maxEnvWaste = byEnv.reduce((m, e) => Math.max(m, e.wasted_cents ?? 0), 0) || 1

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Waste Ledger</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Attributed idle waste by period, environment, provider, service and region.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={refresh} disabled={rebuilding}>
            Refresh
          </Button>
          <Button onClick={onRebuild} disabled={rebuilding}>
            {rebuilding ? 'Rebuilding…' : 'Rebuild ledger'}
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
        <Stat label="Monthly waste" value={dollars(summary?.monthly_cents)} tone="warning" />
        <Stat label="Trailing 30 days" value={dollars(summary?.trailing30_cents)} tone="danger" />
        <Stat label="Ledger entries" value={entries.length.toLocaleString()} />
        <Stat
          label={search || period ? 'Filtered waste' : 'Total recorded'}
          value={dollars(totalWasted)}
          sub={filteredEntries.length !== entries.length ? `${filteredEntries.length} of ${entries.length} entries` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BreakdownCard title="By provider" buckets={byProvider} />
        <BreakdownCard title="By service" buckets={byService} />
        <BreakdownCard title="By region" buckets={byRegion} />
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">Waste by environment</h3>
        </CardHeader>
        <CardBody>
          {byEnv.length === 0 ? (
            <p className="text-sm text-zinc-500">No environment-level waste recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {[...byEnv]
                .sort((a, b) => (b.wasted_cents ?? 0) - (a.wasted_cents ?? 0))
                .map((e) => (
                  <div key={e.environment_id}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-300">{e.name || e.environment_id}</span>
                      <span className="tabular-nums text-zinc-400">{dollars(e.wasted_cents)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-yellow-400"
                        style={{ width: `${Math.max(2, ((e.wasted_cents ?? 0) / maxEnvWaste) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">Ledger entries</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value)
                if (workspaceId) loadData(workspaceId, e.target.value).catch((err: any) => setError(err?.message || 'Filter failed.'))
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
            >
              <option value="">All periods</option>
              {periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entries…"
              className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredEntries.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={entries.length === 0 ? 'No ledger entries' : 'No matching entries'}
                description={
                  entries.length === 0
                    ? 'Rebuild the ledger to compute attributed idle waste from detected idle windows and rates.'
                    : 'Try a different search term or period.'
                }
                action={
                  entries.length === 0 ? (
                    <Button onClick={onRebuild} disabled={rebuilding}>
                      {rebuilding ? 'Rebuilding…' : 'Rebuild ledger'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Environment</TH>
                  <TH className="text-right">Idle hrs</TH>
                  <TH className="text-right">Off-hours idle</TH>
                  <TH className="text-right">Rate / hr</TH>
                  <TH className="text-right">Wasted</TH>
                </TR>
              </THead>
              <TBody>
                {filteredEntries.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <span className="font-medium text-zinc-200">{e.period || '—'}</span>
                    </TD>
                    <TD>
                      {e.environment_id ? (
                        <Badge tone="info">{envNameById.get(e.environment_id) || e.environment_id}</Badge>
                      ) : (
                        <span className="text-zinc-600">unassigned</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{(e.idle_hours ?? 0).toFixed(1)}</TD>
                    <TD className="text-right tabular-nums">{(e.off_hours_idle_hours ?? 0).toFixed(1)}</TD>
                    <TD className="text-right tabular-nums text-zinc-400">{dollars(e.hourly_rate_cents)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-yellow-300">{compactDollars(e.wasted_cents)}</TD>
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
