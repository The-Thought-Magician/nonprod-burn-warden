'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
]

const ENV_KINDS = ['dev', 'staging', 'qa', 'sandbox', 'preview', 'prod']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dollars(cents?: number | null): string {
  const c = typeof cents === 'number' ? cents : 0
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function envTone(kind?: string): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  if (kind === 'prod') return 'danger'
  if (kind === 'staging' || kind === 'qa') return 'warning'
  if (kind === 'preview' || kind === 'sandbox') return 'info'
  return 'success'
}

// Map a 0..1 (or arbitrary positive) idle intensity to a yellow heat color.
function heatColor(value: number, max: number): string {
  if (!max || value <= 0) return 'rgba(63,63,70,0.35)' // zinc-700 faint
  const t = Math.min(1, value / max)
  // interpolate zinc -> yellow
  const alpha = 0.12 + t * 0.78
  return `rgba(250, 204, 21, ${alpha.toFixed(3)})`
}

export default function EnvironmentDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [env, setEnv] = useState<any>(null)
  const [idleSummary, setIdleSummary] = useState<any[]>([])
  const [heatmap, setHeatmap] = useState<number[][] | null>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [calendars, setCalendars] = useState<any[]>([])

  // editor state
  const [form, setForm] = useState({
    name: '',
    env_kind: 'dev',
    timezone: 'UTC',
    schedule_id: '',
    holiday_calendar_id: '',
    is_production: false,
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const e = await api.getEnvironment(id)
      setEnv(e)
      setForm({
        name: e.name ?? '',
        env_kind: e.env_kind ?? 'dev',
        timezone: e.timezone ?? 'UTC',
        schedule_id: e.schedule_id ?? '',
        holiday_calendar_id: e.holiday_calendar_id ?? '',
        is_production: !!e.is_production,
        description: e.description ?? '',
      })

      const wsId = e.workspace_id
      const [summaryRes, heatRes, schedRes, calRes] = await Promise.allSettled([
        wsId ? api.getIdleSummary(wsId) : Promise.resolve([]),
        api.getIdleHeatmap(id),
        wsId ? api.getSchedules(wsId) : Promise.resolve([]),
        wsId ? api.getHolidayCalendars(wsId) : Promise.resolve([]),
      ])

      setIdleSummary(summaryRes.status === 'fulfilled' && Array.isArray(summaryRes.value) ? summaryRes.value : [])
      setHeatmap(
        heatRes.status === 'fulfilled' && heatRes.value && Array.isArray(heatRes.value.grid)
          ? heatRes.value.grid
          : null,
      )
      setSchedules(schedRes.status === 'fulfilled' && Array.isArray(schedRes.value) ? schedRes.value : [])
      setCalendars(calRes.status === 'fulfilled' && Array.isArray(calRes.value) ? calRes.value : [])
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load environment')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  const summaryForEnv = useMemo(
    () => idleSummary.find((s) => s.environment_id === id),
    [idleSummary, id],
  )

  const heatMax = useMemo(() => {
    if (!heatmap) return 0
    let m = 0
    for (const row of heatmap) for (const v of row) if (v > m) m = v
    return m
  }, [heatmap])

  const totalIdle = useMemo(() => {
    if (!heatmap) return 0
    let t = 0
    for (const row of heatmap) for (const v of row) t += v
    return t
  }, [heatmap])

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg('')
    setError('')
    try {
      const body: any = {
        name: form.name,
        env_kind: form.env_kind,
        timezone: form.timezone,
        schedule_id: form.schedule_id || null,
        holiday_calendar_id: form.holiday_calendar_id || null,
        is_production: form.is_production,
        description: form.description || null,
      }
      const updated = await api.updateEnvironment(id, body)
      setEnv((prev: any) => ({ ...prev, ...updated }))
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2500)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save environment')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading environment..." />

  if (error && !env) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Could not load environment"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const stats = env?.stats ?? {}

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/environments" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Environments
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">{env?.name}</h1>
            <Badge tone={envTone(env?.env_kind)}>{env?.env_kind ?? 'unclassified'}</Badge>
            {env?.is_production && <Badge tone="danger">production</Badge>}
          </div>
          {env?.description && <p className="mt-1 text-sm text-zinc-500">{env.description}</p>}
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>Timezone: <span className="text-zinc-300">{env?.timezone ?? 'UTC'}</span></div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
      )}

      {/* Rollups */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Resources" value={stats.resource_count ?? env?.resource_count ?? 0} />
        <Stat label="Monthly Cost" value={dollars(stats.monthly_cost_cents ?? env?.monthly_cost_cents)} />
        <Stat
          label="Idle Waste"
          tone="warning"
          value={dollars(stats.idle_waste_cents ?? env?.idle_waste_cents)}
        />
        <Stat
          label="Idle Hrs / Week"
          tone="warning"
          value={
            summaryForEnv?.idle_hours_per_week != null
              ? Number(summaryForEnv.idle_hours_per_week).toFixed(1)
              : '0.0'
          }
          sub={
            summaryForEnv?.off_hours_pct != null
              ? `${Number(summaryForEnv.off_hours_pct).toFixed(0)}% off-hours`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Settings editor */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-zinc-100">Timezone, Schedule & Calendar</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Drive idle detection and savings math from the right working hours.
            </p>
          </CardHeader>
          <CardBody>
            <form onSubmit={saveSettings} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Env Kind
                  </label>
                  <select
                    value={form.env_kind}
                    onChange={(e) => setForm({ ...form, env_kind: e.target.value })}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                  >
                    {ENV_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Timezone
                  </label>
                  <select
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                  >
                    {TIMEZONES.includes(form.timezone) ? null : (
                      <option value={form.timezone}>{form.timezone}</option>
                    )}
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Schedule
                </label>
                <select
                  value={form.schedule_id}
                  onChange={(e) => setForm({ ...form, schedule_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                >
                  <option value="">No schedule (always-on)</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.effective_hours_per_week != null
                        ? ` (${Number(s.effective_hours_per_week).toFixed(0)} hrs/wk)`
                        : ''}
                      {s.is_preset ? ' · preset' : ''}
                    </option>
                  ))}
                </select>
                {form.schedule_id && (
                  <Link
                    href={`/dashboard/schedules/${form.schedule_id}`}
                    className="mt-1 inline-block text-xs text-yellow-400 hover:text-yellow-300"
                  >
                    Edit this schedule →
                  </Link>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Holiday Calendar
                </label>
                <select
                  value={form.holiday_calendar_id}
                  onChange={(e) => setForm({ ...form, holiday_calendar_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                >
                  <option value="">No calendar</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.region ? ` · ${c.region}` : ''}
                      {c.holiday_count != null ? ` (${c.holiday_count})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.is_production}
                  onChange={(e) => setForm({ ...form, is_production: e.target.checked })}
                  className="h-4 w-4 accent-yellow-400"
                />
                Mark as production (excluded from off-hours scheduling)
              </label>

              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save settings'}
                </Button>
                {saveMsg && <span className="text-sm text-emerald-400">{saveMsg}</span>}
              </div>
            </form>
          </CardBody>
        </Card>

        {/* Idle heatmap */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Idle Heatmap</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Hour-of-week idle intensity</p>
              </div>
              <Badge tone="warning">{totalIdle.toFixed(0)} idle units</Badge>
            </div>
          </CardHeader>
          <CardBody>
            {!heatmap || heatMax === 0 ? (
              <EmptyState
                title="No idle data yet"
                description="Run idle detection on the Idle Analysis page to populate the heatmap."
                action={
                  <Link href="/dashboard/idle">
                    <Button variant="secondary">Go to Idle Analysis</Button>
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  {/* hour header */}
                  <div className="flex">
                    <div className="w-10 shrink-0" />
                    {Array.from({ length: 24 }).map((_, h) => (
                      <div
                        key={h}
                        className="flex-1 pb-1 text-center text-[9px] tabular-nums text-zinc-600"
                      >
                        {h % 3 === 0 ? h : ''}
                      </div>
                    ))}
                  </div>
                  {heatmap.map((row, d) => (
                    <div key={d} className="flex items-center">
                      <div className="w-10 shrink-0 pr-1 text-right text-[10px] text-zinc-500">
                        {DAYS[d] ?? `D${d}`}
                      </div>
                      {row.map((v, h) => (
                        <div
                          key={h}
                          title={`${DAYS[d] ?? d} ${h}:00 — idle ${v}`}
                          className="m-[1px] h-4 flex-1 rounded-[2px]"
                          style={{ backgroundColor: heatColor(v, heatMax) }}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-zinc-500">
                    <span>Less</span>
                    {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                      <span
                        key={t}
                        className="h-3 w-5 rounded-[2px]"
                        style={{ backgroundColor: heatColor(t * heatMax, heatMax) }}
                      />
                    ))}
                    <span>More</span>
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
