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

type Environment = { id: string; name: string; env_kind?: string; is_production?: boolean }
type Schedule = { id: string; name: string; is_preset?: boolean; effective_hours_per_week?: number }
type Estimate = {
  id: string
  environment_id: string
  schedule_id: string
  hours_saved_per_week?: number
  monthly_savings_cents?: number
  savings_pct?: number
  current_monthly_cents?: number
  created_at?: string
}
type CompareOption = { schedule_id: string; monthly_savings_cents?: number; savings_pct?: number }
type CompareResult = { environment_id: string; options: CompareOption[] }
type Potential = {
  total_recoverable_cents?: number
  by_environment?: { environment_id: string; name?: string; recoverable_cents?: number }[]
}

function money(cents?: number | null): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function pct(v?: number | null): string {
  if (v == null) return '0%'
  return `${Math.round(v)}%`
}

export default function SavingsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [environments, setEnvironments] = useState<Environment[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [potential, setPotential] = useState<Potential | null>(null)

  // what-if calculator state
  const [calcEnv, setCalcEnv] = useState('')
  const [calcSchedule, setCalcSchedule] = useState('')
  const [calcRunning, setCalcRunning] = useState(false)
  const [calcResult, setCalcResult] = useState<Estimate | null>(null)
  const [calcError, setCalcError] = useState<string | null>(null)

  // comparison state
  const [cmpEnv, setCmpEnv] = useState('')
  const [cmpScheduleIds, setCmpScheduleIds] = useState<string[]>([])
  const [cmpRunning, setCmpRunning] = useState(false)
  const [cmpResult, setCmpResult] = useState<CompareResult | null>(null)
  const [cmpError, setCmpError] = useState<string | null>(null)

  const scheduleName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of schedules) m.set(s.id, s.name)
    return (id: string) => m.get(id) ?? id.slice(0, 8)
  }, [schedules])
  const envName = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of environments) m.set(e.id, e.name)
    return (id: string) => m.get(id) ?? id.slice(0, 8)
  }, [environments])

  async function loadAll(wsId: string) {
    const [envs, scheds, est, pot] = await Promise.all([
      api.getEnvironments(wsId),
      api.getSchedules(wsId),
      api.getSavings({ workspace_id: wsId }),
      api.getSavingsPotential(wsId),
    ])
    setEnvironments(Array.isArray(envs) ? envs : [])
    setSchedules(Array.isArray(scheds) ? scheds : [])
    setEstimates(Array.isArray(est) ? est : [])
    setPotential(pot ?? null)
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
        await loadAll(wsId)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load savings data')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function refresh() {
    if (!workspaceId) return
    const [est, pot] = await Promise.all([
      api.getSavings({ workspace_id: workspaceId }),
      api.getSavingsPotential(workspaceId),
    ])
    setEstimates(Array.isArray(est) ? est : [])
    setPotential(pot ?? null)
  }

  async function runCalculate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !calcEnv || !calcSchedule) return
    setCalcRunning(true)
    setCalcError(null)
    setCalcResult(null)
    try {
      const res = await api.calculateSavings({
        workspace_id: workspaceId,
        environment_id: calcEnv,
        schedule_id: calcSchedule,
      })
      setCalcResult(res)
      await refresh()
    } catch (err: any) {
      setCalcError(err?.message || 'Failed to calculate savings')
    } finally {
      setCalcRunning(false)
    }
  }

  function toggleCmpSchedule(id: string) {
    setCmpScheduleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function runCompare(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !cmpEnv || cmpScheduleIds.length < 1) return
    setCmpRunning(true)
    setCmpError(null)
    setCmpResult(null)
    try {
      const res = await api.compareSavings({
        workspace_id: workspaceId,
        environment_id: cmpEnv,
        schedule_ids: cmpScheduleIds,
      })
      setCmpResult(res)
    } catch (err: any) {
      setCmpError(err?.message || 'Failed to compare schedules')
    } finally {
      setCmpRunning(false)
    }
  }

  if (loading) return <PageSpinner label="Loading savings calculator..." />

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard to start modeling savings."
        />
      </div>
    )
  }

  const bestCmp =
    cmpResult?.options?.length
      ? [...cmpResult.options].sort(
          (a, b) => (b.monthly_savings_cents ?? 0) - (a.monthly_savings_cents ?? 0),
        )[0]
      : null
  const maxCmp = Math.max(1, ...(cmpResult?.options?.map((o) => o.monthly_savings_cents ?? 0) ?? [1]))
  const byEnv = potential?.by_environment ?? []
  const maxPotential = Math.max(1, ...byEnv.map((b) => b.recoverable_cents ?? 0))

  return (
    <div className="space-y-8">
      <Header />

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Org potential */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Org Recoverable / mo"
            value={money(potential?.total_recoverable_cents)}
            tone="success"
            sub="If recommended schedules applied"
          />
          <Stat label="Environments Modeled" value={byEnv.length} sub="With recoverable spend" />
          <Stat label="Saved Estimates" value={estimates.length} sub="Persisted what-if runs" />
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Recoverable Potential by Environment</h2>
          </CardHeader>
          <CardBody>
            {byEnv.length === 0 ? (
              <p className="text-sm text-zinc-500">No recoverable potential computed yet. Run the calculator below.</p>
            ) : (
              <div className="space-y-3">
                {[...byEnv]
                  .sort((a, b) => (b.recoverable_cents ?? 0) - (a.recoverable_cents ?? 0))
                  .map((b) => (
                    <div key={b.environment_id} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 truncate text-sm text-zinc-300">
                        {b.name || envName(b.environment_id)}
                      </div>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-yellow-400"
                          style={{ width: `${((b.recoverable_cents ?? 0) / maxPotential) * 100}%` }}
                        />
                      </div>
                      <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-emerald-300">
                        {money(b.recoverable_cents)}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* Calculator + comparison */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* What-if calculator */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">What-If Savings Calculator</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Apply a schedule to an environment and persist the estimate.
            </p>
          </CardHeader>
          <CardBody>
            <form onSubmit={runCalculate} className="space-y-4">
              <Field label="Environment">
                <Select value={calcEnv} onChange={setCalcEnv}>
                  <option value="">Select environment…</option>
                  {environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.is_production ? ' (prod)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Candidate Schedule">
                <Select value={calcSchedule} onChange={setCalcSchedule}>
                  <option value="">Select schedule…</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.effective_hours_per_week != null
                        ? ` — ${Math.round(s.effective_hours_per_week)}h/wk`
                        : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" disabled={calcRunning || !calcEnv || !calcSchedule}>
                {calcRunning ? 'Calculating…' : 'Calculate Savings'}
              </Button>
              {calcError && <p className="text-sm text-red-300">{calcError}</p>}
            </form>

            {calcResult && (
              <div className="mt-5 rounded-lg border border-yellow-500/30 bg-yellow-400/5 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {envName(calcResult.environment_id)} · {scheduleName(calcResult.schedule_id)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-lg font-bold tabular-nums text-emerald-300">
                      {money(calcResult.monthly_savings_cents)}
                    </div>
                    <div className="text-xs text-zinc-500">Monthly savings</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums text-yellow-300">
                      {pct(calcResult.savings_pct)}
                    </div>
                    <div className="text-xs text-zinc-500">of current spend</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums text-zinc-100">
                      {Math.round(calcResult.hours_saved_per_week ?? 0)}h
                    </div>
                    <div className="text-xs text-zinc-500">saved / week</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-zinc-500">
                  Current spend: {money(calcResult.current_monthly_cents)} / mo
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Comparison */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Compare Schedules</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Pick an environment and 2+ schedules to compare.</p>
          </CardHeader>
          <CardBody>
            <form onSubmit={runCompare} className="space-y-4">
              <Field label="Environment">
                <Select value={cmpEnv} onChange={setCmpEnv}>
                  <option value="">Select environment…</option>
                  {environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Schedules to compare">
                <div className="flex flex-wrap gap-2">
                  {schedules.length === 0 && (
                    <span className="text-sm text-zinc-500">No schedules available.</span>
                  )}
                  {schedules.map((s) => {
                    const on = cmpScheduleIds.includes(s.id)
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => toggleCmpSchedule(s.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          on
                            ? 'border-yellow-500/50 bg-yellow-400/10 text-yellow-300'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {s.name}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Button type="submit" disabled={cmpRunning || !cmpEnv || cmpScheduleIds.length < 1}>
                {cmpRunning ? 'Comparing…' : 'Compare'}
              </Button>
              {cmpError && <p className="text-sm text-red-300">{cmpError}</p>}
            </form>

            {cmpResult && cmpResult.options?.length > 0 && (
              <div className="mt-5 space-y-3">
                {[...cmpResult.options]
                  .sort((a, b) => (b.monthly_savings_cents ?? 0) - (a.monthly_savings_cents ?? 0))
                  .map((o) => (
                    <div key={o.schedule_id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-zinc-300">
                          {scheduleName(o.schedule_id)}
                          {bestCmp && o.schedule_id === bestCmp.schedule_id && (
                            <Badge tone="success">Best</Badge>
                          )}
                        </span>
                        <span className="font-medium tabular-nums text-emerald-300">
                          {money(o.monthly_savings_cents)} · {pct(o.savings_pct)}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-yellow-400"
                          style={{ width: `${((o.monthly_savings_cents ?? 0) / maxCmp) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* Saved estimates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-100">Saved Savings Estimates</h2>
        {estimates.length === 0 ? (
          <EmptyState
            title="No estimates yet"
            description="Run the what-if calculator to persist your first savings estimate."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Environment</TH>
                <TH>Schedule</TH>
                <TH className="text-right">Current / mo</TH>
                <TH className="text-right">Savings / mo</TH>
                <TH className="text-right">Savings %</TH>
                <TH className="text-right">Hrs saved / wk</TH>
              </TR>
            </THead>
            <TBody>
              {estimates.map((est) => (
                <TR key={est.id}>
                  <TD className="text-zinc-100">{envName(est.environment_id)}</TD>
                  <TD>{scheduleName(est.schedule_id)}</TD>
                  <TD className="text-right tabular-nums">{money(est.current_monthly_cents)}</TD>
                  <TD className="text-right tabular-nums text-emerald-300">
                    {money(est.monthly_savings_cents)}
                  </TD>
                  <TD className="text-right tabular-nums text-yellow-300">{pct(est.savings_pct)}</TD>
                  <TD className="text-right tabular-nums">
                    {Math.round(est.hours_saved_per_week ?? 0)}h
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100">Savings Calculator</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Model what-if schedules, compare options, and see org-wide recoverable potential.
      </p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500/60 focus:outline-none"
    >
      {children}
    </select>
  )
}
