'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface Overview {
  idle_waste_cents?: number
  recoverable_potential_cents?: number
}

interface LeaderRow {
  environment_id: string
  name: string
  wasted_cents: number
  env_kind: string
}

interface Alert {
  id: string
  environment_id?: string | null
  severity?: string | null
  message?: string | null
  status?: string | null
  created_at?: string | null
}

function severityTone(sev?: string | null): 'danger' | 'warning' | 'info' | 'default' {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'danger'
    case 'warning':
    case 'medium':
      return 'warning'
    default:
      return 'info'
  }
}

/**
 * Right rail: real numbers pulled from endpoints already used elsewhere
 * (stats/overview, stats/leaderboard, alerts) — no new backend routes.
 */
export function RightRail({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [leaders, setLeaders] = useState<LeaderRow[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    if (!workspaceId) return
    let active = true
    setLoading(true)
    Promise.all([
      api.getOverview(workspaceId).catch(() => null),
      api.getLeaderboard(workspaceId).catch(() => []),
      api.getAlerts({ workspace_id: workspaceId, status: 'open' }).catch(() => []),
    ]).then(([ov, lb, al]) => {
      if (!active) return
      setOverview(ov)
      setLeaders(Array.isArray(lb) ? lb.slice(0, 5) : [])
      setAlerts(Array.isArray(al) ? al.slice(0, 5) : [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [workspaceId])

  if (!workspaceId) return null

  return (
    <aside className="w-full shrink-0 space-y-4 lg:w-72">
      <Card>
        <CardHeader>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">This month</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <div>
            <div className="text-xs text-slate-500">Idle waste</div>
            <div className="text-lg font-bold tabular-nums text-red-300">
              {loading ? '—' : fmtMoney(overview?.idle_waste_cents)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Recoverable potential</div>
            <div className="text-lg font-bold tabular-nums text-emerald-300">
              {loading ? '—' : fmtMoney(overview?.recoverable_potential_cents)}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top burn offenders</h2>
          <Link href="/dashboard/environments" className="text-xs text-emerald-400 hover:text-emerald-300">
            All
          </Link>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="py-4 text-center text-xs text-slate-500">Loading...</p>
          ) : leaders.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">No waste recorded.</p>
          ) : (
            <ul className="space-y-2">
              {leaders.map((l) => (
                <li key={l.environment_id}>
                  <Link
                    href={`/dashboard/environments/${l.environment_id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-800/50"
                  >
                    <span className="truncate text-slate-300">{l.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-red-300">
                      {fmtMoney(l.wasted_cents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent alerts</h2>
          <Link href="/dashboard/alerts" className="text-xs text-emerald-400 hover:text-emerald-300">
            All
          </Link>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="py-4 text-center text-xs text-slate-500">Loading...</p>
          ) : alerts.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">No open alerts.</p>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={severityTone(a.severity)}>{a.severity || 'info'}</Badge>
                  </div>
                  <p className="mt-1 text-slate-400">{a.message || 'Alert triggered'}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </aside>
  )
}

export default RightRail
