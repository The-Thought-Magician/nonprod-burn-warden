'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

type Window = { day: number; start: number; end: number }

type Schedule = {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  windows?: Window[] | null
  treat_holidays_off?: boolean | null
  is_preset?: boolean | null
  effective_hours_per_week?: number | null
  created_at?: string | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type PresetDef = { name: string; description: string; windows: Window[] }

function workdayWindows(start: number, end: number): Window[] {
  return [1, 2, 3, 4, 5].map((day) => ({ day, start, end }))
}

const PRESETS: PresetDef[] = [
  {
    name: 'Business hours (9–6, Mon–Fri)',
    description: 'On weekdays 09:00–18:00, off nights and weekends.',
    windows: workdayWindows(9, 18),
  },
  {
    name: 'Extended hours (7–8, Mon–Fri)',
    description: 'On weekdays 07:00–20:00, off nights and weekends.',
    windows: workdayWindows(7, 20),
  },
  {
    name: 'Weekdays only (24h)',
    description: 'On all day Mon–Fri, fully off Saturday and Sunday.',
    windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: 0, end: 24 })),
  },
  {
    name: 'Always on',
    description: 'Running 24/7 — no scheduled shutdown.',
    windows: Array.from({ length: 7 }, (_, day) => ({ day, start: 0, end: 24 })),
  },
]

function hoursForWindows(windows?: Window[] | null): number {
  if (!windows || windows.length === 0) return 0
  return windows.reduce((s, w) => s + Math.max(0, (w.end ?? 0) - (w.start ?? 0)), 0)
}

function WeekStrip({ windows }: { windows?: Window[] | null }) {
  const byDay = useMemo(() => {
    const m = new Map<number, Window[]>()
    ;(windows ?? []).forEach((w) => {
      const arr = m.get(w.day) ?? []
      arr.push(w)
      m.set(w.day, arr)
    })
    return m
  }, [windows])

  return (
    <div className="flex gap-1">
      {DAYS.map((label, day) => {
        const dayWindows = byDay.get(day) ?? []
        return (
          <div key={day} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] uppercase text-zinc-600">{label}</span>
            <div className="relative h-10 w-full overflow-hidden rounded bg-zinc-800">
              {dayWindows.map((w, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 bg-yellow-400/70"
                  style={{
                    left: `${(Math.max(0, w.start) / 24) * 100}%`,
                    width: `${(Math.max(0, Math.min(24, w.end) - Math.max(0, w.start)) / 24) * 100}%`,
                  }}
                  title={`${label} ${w.start}:00–${w.end}:00`}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function SchedulesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'preset' | 'custom'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    presetIndex: 0,
    startHour: 9,
    endHour: 18,
    treatHolidaysOff: true,
  })

  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null)
  const [deleting, setDeleting] = useState(false)

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nbw_workspace_id') : null
    const workspaces = await api.getWorkspaces().catch(() => [])
    const list: any[] = Array.isArray(workspaces) ? workspaces : []
    if (stored && list.some((w) => w.id === stored)) return stored
    const first = list[0]?.id ?? null
    if (first && typeof window !== 'undefined') localStorage.setItem('nbw_workspace_id', first)
    return first
  }, [])

  const loadSchedules = useCallback(async (wsId: string) => {
    const res = await api.getSchedules(wsId)
    setSchedules(Array.isArray(res) ? res : [])
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
        await loadSchedules(wsId)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load schedules.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [resolveWorkspace, loadSchedules])

  const openCreate = () => {
    setForm({ name: '', description: '', presetIndex: 0, startHour: 9, endHour: 18, treatHolidaysOff: true })
    setCreateOpen(true)
  }

  const buildWindows = (): Window[] => {
    if (form.presetIndex >= 0 && form.presetIndex < PRESETS.length) {
      // preset selected; use its windows unless user is on the custom option
      return PRESETS[form.presetIndex].windows
    }
    // custom: weekdays with chosen hours
    return workdayWindows(form.startHour, form.endHour)
  }

  const isCustom = form.presetIndex === PRESETS.length

  const onCreate = useCallback(async () => {
    if (!workspaceId) return
    if (!form.name.trim()) {
      setError('Schedule name is required.')
      return
    }
    if (isCustom && form.endHour <= form.startHour) {
      setError('End hour must be after start hour.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const windows = isCustom ? workdayWindows(form.startHour, form.endHour) : buildWindows()
      const body = {
        workspace_id: workspaceId,
        name: form.name.trim(),
        description: form.description.trim() || (isCustom ? '' : PRESETS[form.presetIndex].description),
        windows,
        treat_holidays_off: form.treatHolidaysOff,
        is_preset: false,
      }
      await api.createSchedule(body)
      setCreateOpen(false)
      setNotice(`Schedule "${body.name}" created.`)
      await loadSchedules(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to create schedule.')
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, form, isCustom, loadSchedules])

  const onDelete = useCallback(async () => {
    if (!deleteTarget || !workspaceId) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteSchedule(deleteTarget.id)
      setNotice(`Schedule "${deleteTarget.name}" deleted.`)
      setDeleteTarget(null)
      await loadSchedules(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to delete schedule.')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, workspaceId, loadSchedules])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return schedules.filter((s) => {
      if (filter === 'preset' && !s.is_preset) return false
      if (filter === 'custom' && s.is_preset) return false
      if (q) {
        const hay = [s.name, s.description].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [schedules, search, filter])

  const presetCount = schedules.filter((s) => s.is_preset).length
  const customCount = schedules.length - presetCount

  if (loading) return <PageSpinner label="Loading schedules..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🗓️</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before managing schedules."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Schedules</h1>
          <p className="mt-1 text-sm text-zinc-500">
            On/off windows for non-production environments. Anything outside a window is recoverable idle time.
          </p>
        </div>
        <Button onClick={openCreate}>New schedule</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Schedules" value={schedules.length} />
        <Stat label="Presets" value={presetCount} />
        <Stat label="Custom" value={customCount} tone="warning" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {(['all', 'preset', 'custom'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                filter === f ? 'bg-yellow-400/10 font-medium text-yellow-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search schedules…"
          className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<span>🗓️</span>}
          title={schedules.length === 0 ? 'No schedules yet' : 'No matching schedules'}
          description={
            schedules.length === 0
              ? 'Create a schedule from a preset or define custom weekday hours to start recovering idle spend.'
              : 'Adjust the filter or search term.'
          }
          action={
            schedules.length === 0 ? <Button onClick={openCreate}>Create your first schedule</Button> : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((s) => {
            const hrs = s.effective_hours_per_week ?? hoursForWindows(s.windows)
            const savingsPct = Math.max(0, Math.min(100, Math.round((1 - hrs / 168) * 100)))
            return (
              <Card key={s.id}>
                <CardHeader className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/schedules/${s.id}`}
                        className="truncate text-sm font-semibold text-zinc-100 hover:text-yellow-300"
                      >
                        {s.name}
                      </Link>
                      {s.is_preset ? <Badge tone="info">Preset</Badge> : <Badge>Custom</Badge>}
                    </div>
                    {s.description && <p className="mt-1 truncate text-xs text-zinc-500">{s.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link href={`/dashboard/schedules/${s.id}`}>
                      <Button variant="ghost">Edit</Button>
                    </Link>
                    {!s.is_preset && (
                      <Button variant="ghost" onClick={() => setDeleteTarget(s)} aria-label={`Delete ${s.name}`}>
                        Delete
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardBody className="flex flex-col gap-4">
                  <WeekStrip windows={s.windows} />
                  <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
                    <span>
                      <span className="font-semibold tabular-nums text-zinc-200">{hrs.toFixed(0)}</span> on-hours / week
                    </span>
                    <span>
                      <span className="font-semibold tabular-nums text-yellow-300">{savingsPct}%</span> off vs 24/7
                    </span>
                    {s.treat_holidays_off && <Badge tone="success">Holidays off</Badge>}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New schedule"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={saving}>
              {saving ? 'Creating…' : 'Create schedule'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Dev business hours"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">Template</span>
            <select
              value={form.presetIndex}
              onChange={(e) => setForm((f) => ({ ...f, presetIndex: Number(e.target.value) }))}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
            >
              {PRESETS.map((p, i) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
              <option value={PRESETS.length}>Custom weekday hours…</option>
            </select>
          </label>

          {isCustom ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-400">Start hour</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={form.startHour}
                  onChange={(e) => setForm((f) => ({ ...f, startHour: Number(e.target.value) }))}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-400">End hour</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={form.endHour}
                  onChange={(e) => setForm((f) => ({ ...f, endHour: Number(e.target.value) }))}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
                />
              </label>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">{PRESETS[form.presetIndex].description}</p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">Description (optional)</span>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What this schedule is for"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.treatHolidaysOff}
              onChange={(e) => setForm((f) => ({ ...f, treatHolidaysOff: e.target.checked }))}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-yellow-400"
            />
            Treat holidays as off-hours
          </label>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 text-xs font-medium text-zinc-500">Preview</div>
            <WeekStrip windows={isCustom ? workdayWindows(form.startHour, form.endHour) : PRESETS[form.presetIndex].windows} />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete schedule"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          Delete <span className="font-semibold text-zinc-100">{deleteTarget?.name}</span>? Any environment or resource
          assignments will be removed. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
