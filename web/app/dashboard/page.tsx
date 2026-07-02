'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

const ACTIVE_WS_KEY = 'nbw_active_workspace'

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface Workspace {
  id: string
  name: string
  slug: string
  currency?: string
  role?: string
}

interface Overview {
  total_spend_cents: number
  nonprod_spend_cents: number
  idle_waste_cents: number
  recoverable_potential_cents: number
  environment_count?: number
  resource_count?: number
  team_count?: number
  orphan_count?: number
}

interface TrendPoint {
  period: string
  waste_cents: number
  nonprod_spend_cents: number
}

interface LeaderRow {
  environment_id: string
  name: string
  wasted_cents: number
  env_kind: string
}

function envTone(kind: string): 'warning' | 'info' | 'default' | 'success' {
  switch ((kind || '').toLowerCase()) {
    case 'dev':
      return 'info'
    case 'staging':
      return 'warning'
    case 'preview':
    case 'sandbox':
      return 'default'
    default:
      return 'success'
  }
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-slate-500">No trend data yet.</p>
  }
  const W = 720
  const H = 220
  const pad = { top: 16, right: 16, bottom: 28, left: 16 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const max = Math.max(1, ...data.map((d) => Math.max(d.waste_cents, d.nonprod_spend_cents)))
  const n = data.length
  const x = (i: number) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH

  const linePath = (key: 'waste_cents' | 'nonprod_spend_cents') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ')

  const areaPath =
    `M ${x(0)} ${y(data[0].waste_cents)} ` +
    data.map((d, i) => `L ${x(i).toFixed(1)} ${y(d.waste_cents).toFixed(1)}`).join(' ') +
    ` L ${x(n - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z`

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[480px] w-full" role="img" aria-label="Waste trend">
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={pad.left}
            x2={W - pad.right}
            y1={pad.top + innerH - g * innerH}
            y2={pad.top + innerH - g * innerH}
            stroke="#1e293b"
            strokeWidth={1}
          />
        ))}
        <path d={areaPath} fill="rgba(52,211,153,0.10)" />
        <path d={linePath('nonprod_spend_cents')} fill="none" stroke="#64748b" strokeWidth={2} strokeDasharray="4 3" />
        <path d={linePath('waste_cents')} fill="none" stroke="#34d399" strokeWidth={2.5} />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.waste_cents)} r={3} fill="#34d399" />
        ))}
        {data.map((d, i) => (
          <text
            key={`l-${i}`}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-slate-600"
            fontSize={10}
          >
            {d.period}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex items-center gap-4 px-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-emerald-400" /> Idle waste
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-600" /> Non-prod spend
        </span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [seeding, setSeeding] = useState(false)

  const loadWorkspaceData = useCallback(async (wsId: string) => {
    const [ov, tr, lb] = await Promise.all([
      api.getOverview(wsId).catch(() => null),
      api.getTrends(wsId).catch(() => []),
      api.getLeaderboard(wsId).catch(() => []),
    ])
    setOverview(ov)
    setTrends(Array.isArray(tr) ? tr : [])
    setLeaderboard(Array.isArray(lb) ? lb : [])
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const ws: Workspace[] = await api.getWorkspaces()
      setWorkspaces(ws)
      if (ws.length === 0) {
        setLoading(false)
        return
      }
      const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_WS_KEY) : null
      const active = ws.find((w) => w.id === stored)?.id ?? ws[0].id
      setWorkspaceId(active)
      if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_WS_KEY, active)
      await loadWorkspaceData(active)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [loadWorkspaceData])

  useEffect(() => {
    init()
  }, [init])

  const onSelectWorkspace = async (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_WS_KEY, id)
    setLoading(true)
    try {
      await loadWorkspaceData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const onSeed = async () => {
    setSeeding(true)
    setError('')
    try {
      const res = await api.seedSample()
      if (res?.workspace_id && typeof window !== 'undefined') {
        localStorage.setItem(ACTIVE_WS_KEY, res.workspace_id)
      }
      await init()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <PageSpinner label="Loading dashboard..." />

  // No workspaces at all → first-run seed experience
  if (workspaces.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="🔥"
          title="Welcome to NonprodBurnWarden"
          description="You don't have any workspaces yet. Seed a deterministic demo workspace with cloud accounts, resources, environments, usage, idle windows, and a waste ledger to explore the platform."
          action={
            <Button onClick={onSeed} disabled={seeding}>
              {seeding ? 'Seeding sample data...' : 'Seed sample data'}
            </Button>
          }
        />
        {error && (
          <p className="mt-4 rounded-lg border border-red-700 bg-red-900/30 p-3 text-center text-sm text-red-400">
            {error}
          </p>
        )}
      </div>
    )
  }

  const hasData = (overview?.total_spend_cents ?? 0) > 0 || leaderboard.length > 0 || trends.length > 0

  const recoverable = overview?.recoverable_potential_cents ?? 0
  const idle = overview?.idle_waste_cents ?? 0
  const total = overview?.total_spend_cents ?? 0
  const nonprod = overview?.nonprod_spend_cents ?? 0
  const maxLeader = Math.max(1, ...leaderboard.map((l) => l.wasted_cents ?? 0))

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Non-production cloud spend, idle waste, and recoverable potential.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => onSelectWorkspace(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={onSeed} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed sample data'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
      )}

      {!hasData ? (
        <EmptyState
          icon="📊"
          title="No spend data yet"
          description="This workspace has no cost or waste data. Seed sample data or import your cloud cost exports to get started."
          action={
            <Button onClick={onSeed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed sample data'}
            </Button>
          }
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total cloud spend" value={fmtMoney(total)} sub="Monthly across all accounts" />
            <Stat
              label="Non-prod spend"
              value={fmtMoney(nonprod)}
              sub={`${total ? Math.round((nonprod / total) * 100) : 0}% of total`}
            />
            <Stat label="Idle waste" value={fmtMoney(idle)} tone="danger" sub="Off-hours + business-hours idle" />
            <Stat
              label="Recoverable potential"
              value={fmtMoney(recoverable)}
              tone="warning"
              sub="With scheduling + cleanup"
            />
          </div>

          {/* Secondary counts */}
          {(overview?.environment_count != null ||
            overview?.resource_count != null ||
            overview?.team_count != null ||
            overview?.orphan_count != null) && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Environments" value={overview?.environment_count ?? 0} />
              <Stat label="Resources" value={overview?.resource_count ?? 0} />
              <Stat label="Teams" value={overview?.team_count ?? 0} />
              <Stat label="Orphan findings" value={overview?.orphan_count ?? 0} tone="warning" />
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Trend chart */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-200">Waste over time</h2>
              </CardHeader>
              <CardBody>
                <TrendChart data={trends} />
              </CardBody>
            </Card>

            {/* Leaderboard */}
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Worst offenders</h2>
                <Link href="/dashboard/environments" className="text-xs text-emerald-400 hover:text-emerald-300">
                  View all
                </Link>
              </CardHeader>
              <CardBody>
                {leaderboard.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No waste recorded.</p>
                ) : (
                  <ul className="space-y-3">
                    {leaderboard.slice(0, 8).map((row, i) => (
                      <li key={row.environment_id}>
                        <Link
                          href={`/dashboard/environments/${row.environment_id}`}
                          className="block rounded-lg p-2 transition-colors hover:bg-slate-800/50"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="w-4 shrink-0 text-xs tabular-nums text-slate-600">{i + 1}</span>
                              <span className="truncate text-sm font-medium text-slate-200">{row.name}</span>
                              <Badge tone={envTone(row.env_kind)}>{row.env_kind}</Badge>
                            </div>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-red-300">
                              {fmtMoney(row.wasted_cents)}
                            </span>
                          </div>
                          <div className="mt-1.5 ml-6 h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-red-400/70"
                              style={{ width: `${Math.round(((row.wasted_cents ?? 0) / maxLeader) * 100)}%` }}
                            />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
