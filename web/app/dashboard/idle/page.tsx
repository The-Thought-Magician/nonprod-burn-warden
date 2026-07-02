'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'nbw.workspace_id'

type Workspace = { id: string; name: string }
type Environment = { id: string; name: string; env_kind?: string | null }

type IdleSummaryRow = {
  environment_id: string
  idle_hours_per_week: number
  off_hours_pct: number
  name?: string
}

type IdleWindow = {
  id: string
  resource_id: string
  environment_id: string | null
  start_at: string
  end_at: string
  duration_hours: number
  is_off_hours: boolean
  wasted_cents: number
}

type Heatmap = { grid: number[][] }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function money(cents?: number) {
  if (cents == null) return '-'
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtDate(s: string) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function heatColor(v: number, max: number) {
  if (max <= 0 || v <= 0) return 'bg-slate-800/60'
  const t = v / max
  if (t > 0.8) return 'bg-emerald-300'
  if (t > 0.6) return 'bg-emerald-400/80'
  if (t > 0.4) return 'bg-emerald-500/60'
  if (t > 0.2) return 'bg-emerald-600/45'
  return 'bg-emerald-700/30'
}

export default function IdlePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [summary, setSummary] = useState<IdleSummaryRow[]>([])
  const [windows, setWindows] = useState<IdleWindow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedEnv, setSelectedEnv] = useState<string>('all')
  const [offHoursOnly, setOffHoursOnly] = useState(false)

  // heatmap
  const [heatmapEnv, setHeatmapEnv] = useState('')
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null)
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  const [heatmapError, setHeatmapError] = useState<string | null>(null)

  // detection
  const [threshold, setThreshold] = useState(5)
  const [detecting, setDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<{
    windows_created: number
    off_hours_hours: number
    business_hours_hours: number
  } | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)

  const envName = useCallback(
    (id: string | null) => environments.find((e) => e.id === id)?.name || (id ? id.slice(0, 8) : 'unassigned'),
    [environments],
  )

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const ws: Workspace[] = await api.getWorkspaces()
        if (cancelled) return
        setWorkspaces(ws || [])
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const pick = (ws || []).find((w) => w.id === stored)?.id || ws?.[0]?.id || ''
        setWorkspaceId(pick)
        if (!pick) setLoading(false)
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load workspaces')
          setLoading(false)
        }
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  const loadAll = useCallback(async (wsId: string) => {
    if (!wsId) return
    setLoading(true)
    setError(null)
    try {
      const [envs, sum, win] = await Promise.all([
        api.getEnvironments(wsId),
        api.getIdleSummary(wsId),
        api.getIdleWindows({ workspace_id: wsId }),
      ])
      const envList: Environment[] = Array.isArray(envs) ? envs : []
      setEnvironments(envList)
      setSummary(Array.isArray(sum) ? sum : [])
      setWindows(Array.isArray(win) ? win : [])
      setHeatmapEnv((prev) => prev || envList[0]?.id || '')
    } catch (e: any) {
      setError(e?.message || 'Failed to load idle data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) {
      if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, workspaceId)
      loadAll(workspaceId)
    }
  }, [workspaceId, loadAll])

  const loadHeatmap = useCallback(async (envId: string) => {
    if (!envId) {
      setHeatmap(null)
      return
    }
    setHeatmapLoading(true)
    setHeatmapError(null)
    try {
      const res: Heatmap = await api.getIdleHeatmap(envId)
      setHeatmap(res && Array.isArray(res.grid) ? res : { grid: [] })
    } catch (e: any) {
      setHeatmapError(e?.message || 'Failed to load heatmap')
      setHeatmap(null)
    } finally {
      setHeatmapLoading(false)
    }
  }, [])

  useEffect(() => {
    if (heatmapEnv) loadHeatmap(heatmapEnv)
  }, [heatmapEnv, loadHeatmap])

  const filteredWindows = useMemo(() => {
    return windows
      .filter((w) => (selectedEnv === 'all' ? true : w.environment_id === selectedEnv))
      .filter((w) => (offHoursOnly ? w.is_off_hours : true))
      .sort((a, b) => (b.wasted_cents || 0) - (a.wasted_cents || 0))
  }, [windows, selectedEnv, offHoursOnly])

  const stats = useMemo(() => {
    const totalWasted = windows.reduce((s, w) => s + (w.wasted_cents || 0), 0)
    const totalHours = windows.reduce((s, w) => s + (w.duration_hours || 0), 0)
    const offHours = windows.filter((w) => w.is_off_hours).reduce((s, w) => s + (w.duration_hours || 0), 0)
    return {
      windows: windows.length,
      totalWasted,
      totalHours,
      offPct: totalHours > 0 ? Math.round((offHours / totalHours) * 100) : 0,
    }
  }, [windows])

  const summaryRows = useMemo(
    () =>
      [...summary]
        .map((r) => ({ ...r, name: r.name || envName(r.environment_id) }))
        .sort((a, b) => (b.idle_hours_per_week || 0) - (a.idle_hours_per_week || 0)),
    [summary, envName],
  )
  const maxIdle = useMemo(() => Math.max(1, ...summaryRows.map((r) => r.idle_hours_per_week || 0)), [summaryRows])

  const heatMax = useMemo(() => {
    if (!heatmap?.grid?.length) return 0
    let m = 0
    for (const row of heatmap.grid) for (const v of row) if (v > m) m = v
    return m
  }, [heatmap])

  async function runDetect() {
    setDetecting(true)
    setDetectError(null)
    setDetectResult(null)
    try {
      const body: any = { workspace_id: workspaceId, threshold: Number(threshold) }
      if (selectedEnv !== 'all') body.environment_id = selectedEnv
      const res = await api.detectIdle(body)
      setDetectResult({
        windows_created: res?.windows_created ?? 0,
        off_hours_hours: res?.off_hours_hours ?? 0,
        business_hours_hours: res?.business_hours_hours ?? 0,
      })
      await loadAll(workspaceId)
      if (heatmapEnv) await loadHeatmap(heatmapEnv)
    } catch (e: any) {
      setDetectError(e?.message || 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  if (loading && !windows.length && !summary.length && !error) return <PageSpinner label="Loading idle analysis..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Idle Analysis</h1>
          <p className="mt-1 text-sm text-slate-500">
            Detect idle compute from usage samples, see idle-hours per environment, and visualize when the burn happens.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {!workspaceId && !loading ? (
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard first, then return to analyze idle waste."
        />
      ) : (
        <>
          {/* stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Idle windows" value={stats.windows} />
            <Stat label="Wasted (detected)" value={money(stats.totalWasted)} tone="danger" />
            <Stat label="Idle hours" value={Math.round(stats.totalHours).toLocaleString()} tone="warning" />
            <Stat label="Off-hours share" value={`${stats.offPct}%`} tone="warning" />
          </div>

          {/* detection */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-100">Run idle detection</h2>
              <p className="text-xs text-slate-500">
                Scans usage samples and records idle windows where utilization stays below the threshold.
              </p>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap items-end gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Utilization threshold (%)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Scope</span>
                  <select
                    value={selectedEnv}
                    onChange={(e) => setSelectedEnv(e.target.value)}
                    className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="all">All environments</option>
                    {environments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="primary" onClick={runDetect} disabled={detecting}>
                  {detecting ? <Spinner /> : 'Run detection'}
                </Button>
              </div>
              {detectError && <div className="mt-4 text-sm text-red-300">{detectError}</div>}
              {detectResult && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <Stat label="Windows created" value={detectResult.windows_created} tone="success" />
                  <Stat label="Off-hours idle (h)" value={Math.round(detectResult.off_hours_hours)} tone="warning" />
                  <Stat
                    label="Business-hours idle (h)"
                    value={Math.round(detectResult.business_hours_hours)}
                    tone="danger"
                  />
                </div>
              )}
            </CardBody>
          </Card>

          {/* per-env idle hours */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-100">Idle hours per week, by environment</h2>
            </CardHeader>
            <CardBody>
              {summaryRows.length === 0 ? (
                <EmptyState
                  title="No idle summary yet"
                  description="Run detection above to populate per-environment idle hours."
                />
              ) : (
                <div className="space-y-3">
                  {summaryRows.map((r) => (
                    <div key={r.environment_id} className="flex items-center gap-3">
                      <div className="w-44 truncate text-sm text-slate-300" title={r.name}>
                        {r.name}
                      </div>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${((r.idle_hours_per_week || 0) / maxIdle) * 100}%` }}
                        />
                      </div>
                      <div className="w-20 text-right text-sm tabular-nums text-slate-300">
                        {(r.idle_hours_per_week || 0).toFixed(1)}h
                      </div>
                      <div className="w-24 text-right">
                        <Badge tone="warning">{Math.round((r.off_hours_pct || 0) * (r.off_hours_pct <= 1 ? 100 : 1))}% off-hrs</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* heatmap */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Idle heatmap (hour of week)</h2>
                <p className="text-xs text-slate-500">Darker cells = more idle. Rows are days, columns are hours.</p>
              </div>
              <select
                value={heatmapEnv}
                onChange={(e) => setHeatmapEnv(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                <option value="">Select environment</option>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardBody>
              {!heatmapEnv ? (
                <EmptyState title="Select an environment" description="Choose an environment to view its idle heatmap." />
              ) : heatmapLoading ? (
                <div className="py-8">
                  <Spinner label="Building heatmap..." />
                </div>
              ) : heatmapError ? (
                <div className="text-sm text-red-300">{heatmapError}</div>
              ) : !heatmap?.grid?.length || heatMax === 0 ? (
                <EmptyState
                  title="No heatmap data"
                  description="No idle activity recorded for this environment. Run detection first."
                />
              ) : (
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full">
                    <div className="mb-1 flex gap-[3px] pl-10">
                      {Array.from({ length: 24 }).map((_, h) => (
                        <div key={h} className="w-[14px] text-center text-[9px] text-slate-600">
                          {h % 3 === 0 ? h : ''}
                        </div>
                      ))}
                    </div>
                    {heatmap.grid.map((row, d) => (
                      <div key={d} className="mb-[3px] flex items-center gap-[3px]">
                        <div className="w-10 text-right text-[10px] text-slate-500">{DAYS[d] || `D${d}`}</div>
                        {Array.from({ length: 24 }).map((_, h) => {
                          const v = row?.[h] ?? 0
                          return (
                            <div
                              key={h}
                              className={`h-[14px] w-[14px] rounded-sm ${heatColor(v, heatMax)}`}
                              title={`${DAYS[d] || `D${d}`} ${h}:00 — ${v.toFixed(1)} idle`}
                            />
                          )
                        })}
                      </div>
                    ))}
                    <div className="mt-3 flex items-center gap-2 pl-10 text-[10px] text-slate-500">
                      <span>less</span>
                      <div className="h-[12px] w-[12px] rounded-sm bg-emerald-700/30" />
                      <div className="h-[12px] w-[12px] rounded-sm bg-emerald-500/60" />
                      <div className="h-[12px] w-[12px] rounded-sm bg-emerald-300" />
                      <span>more idle</span>
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* idle windows table */}
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-100">Idle windows</h2>
              <select
                value={selectedEnv}
                onChange={(e) => setSelectedEnv(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                <option value="all">All environments</option>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={offHoursOnly}
                  onChange={(e) => setOffHoursOnly(e.target.checked)}
                  className="h-4 w-4 accent-emerald-400"
                />
                Off-hours only
              </label>
              <span className="text-xs text-slate-500">{filteredWindows.length} windows</span>
            </div>

            {windows.length === 0 ? (
              <EmptyState
                title="No idle windows"
                description="Run detection to identify periods where resources sat idle."
              />
            ) : filteredWindows.length === 0 ? (
              <EmptyState title="No windows match your filters" description="Adjust the environment or off-hours filter." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Environment</TH>
                    <TH>Start</TH>
                    <TH>End</TH>
                    <TH className="text-right">Duration</TH>
                    <TH>Period</TH>
                    <TH className="text-right">Wasted</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredWindows.slice(0, 200).map((w) => (
                    <TR key={w.id}>
                      <TD className="text-slate-200">{envName(w.environment_id)}</TD>
                      <TD className="text-slate-400">{fmtDate(w.start_at)}</TD>
                      <TD className="text-slate-400">{fmtDate(w.end_at)}</TD>
                      <TD className="text-right tabular-nums text-slate-300">{(w.duration_hours || 0).toFixed(1)}h</TD>
                      <TD>
                        <Badge tone={w.is_off_hours ? 'warning' : 'danger'}>
                          {w.is_off_hours ? 'off-hours' : 'business hours'}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums text-red-300">{money(w.wasted_cents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {filteredWindows.length > 200 && (
              <p className="mt-2 text-xs text-slate-500">Showing top 200 of {filteredWindows.length} windows by waste.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
