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
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const ENV_KINDS = ['dev', 'staging', 'qa', 'sandbox', 'preview', 'prod']

function dollars(cents?: number | null, frac = 2): string {
  const c = typeof cents === 'number' ? cents : 0
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: frac, maximumFractionDigits: frac })}`
}

function envTone(kind?: string): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  if (kind === 'prod') return 'danger'
  if (kind === 'staging' || kind === 'qa') return 'warning'
  if (kind === 'preview' || kind === 'sandbox') return 'info'
  if (kind === 'dev') return 'success'
  return 'default'
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDay(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ResourceDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resource, setResource] = useState<any>(null)
  const [usage, setUsage] = useState<any[]>([])
  const [idleWindows, setIdleWindows] = useState<any[]>([])
  const [metrics, setMetrics] = useState<string[]>([])
  const [activeMetric, setActiveMetric] = useState('')

  // edit form
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', env_kind: '', region: '', service: '', monthly_cost_cents: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.getResource(id)
      setResource(r)
      setForm({
        name: r.name ?? '',
        env_kind: r.env_kind ?? '',
        region: r.region ?? '',
        service: r.service ?? '',
        monthly_cost_cents: r.monthly_cost_cents != null ? String(r.monthly_cost_cents / 100) : '',
      })

      const [usageRes, idleRes] = await Promise.allSettled([
        api.getUsage({ resource_id: id }),
        api.getIdleWindows({ resource_id: id }),
      ])

      const u = usageRes.status === 'fulfilled' && Array.isArray(usageRes.value) ? usageRes.value : []
      setUsage(u)
      const ms = Array.from(new Set(u.map((s: any) => s.metric).filter(Boolean)))
      setMetrics(ms)
      setActiveMetric((prev) => (prev && ms.includes(prev) ? prev : ms[0] ?? ''))

      // resource detail may already embed idle_windows; prefer the dedicated call, fall back to embed
      const idleFromCall =
        idleRes.status === 'fulfilled' && Array.isArray(idleRes.value) ? idleRes.value : null
      setIdleWindows(idleFromCall ?? (Array.isArray(r.idle_windows) ? r.idle_windows : []))
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load resource')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  const chartPoints = useMemo(() => {
    const series = usage
      .filter((s) => !activeMetric || s.metric === activeMetric)
      .map((s) => ({ t: new Date(s.sampled_at).getTime(), v: Number(s.value) }))
      .filter((p) => !isNaN(p.t) && !isNaN(p.v))
      .sort((a, b) => a.t - b.t)
    return series
  }, [usage, activeMetric])

  const chartMax = useMemo(() => chartPoints.reduce((m, p) => Math.max(m, p.v), 0), [chartPoints])

  const totalIdleHours = useMemo(
    () => idleWindows.reduce((s, w) => s + (Number(w.duration_hours) || 0), 0),
    [idleWindows],
  )
  const totalWasted = useMemo(
    () => idleWindows.reduce((s, w) => s + (Number(w.wasted_cents) || 0), 0),
    [idleWindows],
  )

  // cost history from embedded cost_records on detail
  const costRecords: any[] = useMemo(
    () => (Array.isArray(resource?.cost_records) ? resource.cost_records : []),
    [resource],
  )

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body: any = {
        name: form.name,
        env_kind: form.env_kind || null,
        region: form.region || null,
        service: form.service || null,
      }
      const cost = form.monthly_cost_cents.trim()
      if (cost !== '') body.monthly_cost_cents = Math.round(parseFloat(cost) * 100)
      const updated = await api.updateResource(id, body)
      setResource((prev: any) => ({ ...prev, ...updated }))
      setEditing(false)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update resource')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading resource..." />

  if (error && !resource) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Could not load resource"
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

  const r = resource

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/resources" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Resources
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">{r?.name ?? r?.external_id}</h1>
            {r?.env_kind && <Badge tone={envTone(r.env_kind)}>{r.env_kind}</Badge>}
            {r?.is_active === false && <Badge tone="default">inactive</Badge>}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {[r?.provider?.toUpperCase(), r?.service, r?.resource_type, r?.region].filter(Boolean).join(' · ')}
          </p>
          <p className="text-xs text-zinc-600">{r?.external_id}</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close editor' : 'Edit resource'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Monthly Cost" value={dollars(r?.monthly_cost_cents, 0)} />
        <Stat
          label="Hourly Rate"
          value={r?.hourly_rate_cents != null ? dollars(Number(r.hourly_rate_cents), 4) : '—'}
        />
        <Stat label="Idle Hours" tone="warning" value={totalIdleHours.toFixed(1)} />
        <Stat label="Idle Waste" tone="warning" value={dollars(totalWasted, 0)} />
      </div>

      {editing && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-zinc-100">Edit resource</h2>
          </CardHeader>
          <CardBody>
            <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Env kind</label>
                <select
                  value={form.env_kind}
                  onChange={(e) => setForm({ ...form, env_kind: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                >
                  <option value="">Unclassified</option>
                  {ENV_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Service</label>
                <input
                  value={form.service}
                  onChange={(e) => setForm({ ...form, service: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Region</label>
                <input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Monthly cost ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthly_cost_cents}
                  onChange={(e) => setForm({ ...form, monthly_cost_cents: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Resource facts + env link */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="text-base font-semibold text-zinc-100">Details</h2>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2 text-sm">
              <Row label="Environment">
                {r?.environment_id ? (
                  <Link
                    href={`/dashboard/environments/${r.environment_id}`}
                    className="text-yellow-400 hover:text-yellow-300"
                  >
                    View environment →
                  </Link>
                ) : (
                  <span className="text-zinc-500">Unassigned</span>
                )}
              </Row>
              <Row label="Classification">
                {r?.classification_source ?? '—'}
                {r?.classification_confidence != null && r?.classification_source !== 'manual'
                  ? ` (${Math.round(Number(r.classification_confidence) * 100)}%)`
                  : ''}
              </Row>
              <Row label="First seen">{fmtDate(r?.first_seen_at)}</Row>
              <Row label="Last active">{fmtDate(r?.last_active_at)}</Row>
              <Row label="Active">{r?.is_active === false ? 'No' : 'Yes'}</Row>
              {r?.tags && Object.keys(r.tags).length > 0 && (
                <div className="pt-2">
                  <dt className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {Object.entries(r.tags).map(([k, v]) => (
                      <Badge key={k}>
                        {k}={String(v)}
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Usage chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-100">Usage</h2>
              {metrics.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {metrics.map((m) => (
                    <button
                      key={m}
                      onClick={() => setActiveMetric(m)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeMetric === m
                          ? 'bg-yellow-400/15 text-yellow-300'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {chartPoints.length === 0 ? (
              <EmptyState
                title="No usage samples"
                description="No metric samples recorded for this resource yet."
              />
            ) : (
              <UsageChart points={chartPoints} max={chartMax} metric={activeMetric} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Cost history */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-zinc-100">Cost History</h2>
        </CardHeader>
        <CardBody className="p-0">
          {costRecords.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">No cost records.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Run hours</TH>
                  <TH>Currency</TH>
                </TR>
              </THead>
              <TBody>
                {[...costRecords]
                  .sort((a, b) => String(b.period).localeCompare(String(a.period)))
                  .map((c) => (
                    <TR key={c.id ?? c.period}>
                      <TD>{c.period}</TD>
                      <TD className="text-right tabular-nums">{dollars(c.amount_cents, 2)}</TD>
                      <TD className="text-right tabular-nums">
                        {c.run_hours != null ? Number(c.run_hours).toFixed(1) : '—'}
                      </TD>
                      <TD>{c.currency ?? '—'}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Idle history */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-100">Idle History</h2>
            <Badge tone="warning">{idleWindows.length} windows</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {idleWindows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">
              No idle windows detected for this resource.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Start</TH>
                  <TH>End</TH>
                  <TH className="text-right">Duration (h)</TH>
                  <TH>Off-hours</TH>
                  <TH className="text-right">Wasted</TH>
                </TR>
              </THead>
              <TBody>
                {[...idleWindows]
                  .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
                  .map((w) => (
                    <TR key={w.id ?? `${w.start_at}-${w.end_at}`}>
                      <TD>{fmtDate(w.start_at)}</TD>
                      <TD>{fmtDate(w.end_at)}</TD>
                      <TD className="text-right tabular-nums">
                        {w.duration_hours != null ? Number(w.duration_hours).toFixed(1) : '—'}
                      </TD>
                      <TD>
                        {w.is_off_hours ? (
                          <Badge tone="warning">off-hours</Badge>
                        ) : (
                          <Badge tone="danger">business hrs</Badge>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{dollars(w.wasted_cents, 2)}</TD>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-300">{children}</dd>
    </div>
  )
}

function UsageChart({
  points,
  max,
  metric,
}: {
  points: { t: number; v: number }[]
  max: number
  metric: string
}) {
  const W = 720
  const H = 200
  const pad = 24
  const n = points.length
  const minT = points[0].t
  const maxT = points[n - 1].t
  const spanT = maxT - minT || 1
  const yMax = max > 0 ? max : 1

  const x = (t: number) => pad + ((t - minT) / spanT) * (W - pad * 2)
  const y = (v: number) => H - pad - (v / yMax) * (H - pad * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area =
    `M ${x(points[0].t).toFixed(1)} ${(H - pad).toFixed(1)} ` +
    points.map((p) => `L ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ') +
    ` L ${x(points[n - 1].t).toFixed(1)} ${(H - pad).toFixed(1)} Z`

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full min-w-[480px]" preserveAspectRatio="none">
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={pad}
            x2={W - pad}
            y1={y(yMax * g)}
            y2={y(yMax * g)}
            stroke="rgba(63,63,70,0.5)"
            strokeWidth={1}
          />
        ))}
        <path d={area} fill="rgba(250,204,21,0.12)" />
        <path d={line} fill="none" stroke="rgb(250,204,21)" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={1.6} fill="rgb(250,204,21)" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>{fmtDay(new Date(minT).toISOString())}</span>
        <span className="text-zinc-400">
          {metric} · peak {max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
        <span>{fmtDay(new Date(maxT).toISOString())}</span>
      </div>
    </div>
  )
}
