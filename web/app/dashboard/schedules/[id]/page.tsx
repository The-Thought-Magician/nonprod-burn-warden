'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Window = { day: number; start: number; end: number }

type Assignment = {
  id: string
  workspace_id?: string
  schedule_id?: string
  environment_id?: string | null
  resource_id?: string | null
  created_at?: string | null
}

type Schedule = {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  windows?: Window[] | null
  treat_holidays_off?: boolean | null
  is_preset?: boolean | null
  effective_hours_per_week?: number | null
  assignments?: Assignment[] | null
}

type Environment = {
  id: string
  name: string
  env_kind?: string | null
  is_production?: boolean | null
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function hoursForWindows(windows: Window[]): number {
  return windows.reduce((s, w) => s + Math.max(0, (w.end ?? 0) - (w.start ?? 0)), 0)
}

// Convert windows -> per-day boolean grid of 24 hours
function windowsToGrid(windows: Window[]): boolean[][] {
  const grid: boolean[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => false))
  windows.forEach((w) => {
    const day = w.day
    if (day < 0 || day > 6) return
    for (let h = Math.max(0, w.start); h < Math.min(24, w.end); h++) {
      grid[day][h] = true
    }
  })
  return grid
}

// Convert a grid back into contiguous windows
function gridToWindows(grid: boolean[][]): Window[] {
  const windows: Window[] = []
  grid.forEach((hours, day) => {
    let start: number | null = null
    for (let h = 0; h <= 24; h++) {
      const on = h < 24 ? hours[h] : false
      if (on && start === null) start = h
      if (!on && start !== null) {
        windows.push({ day, start, end: h })
        start = null
      }
    }
  })
  return windows
}

export default function ScheduleDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const scheduleId = params?.id

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [treatHolidaysOff, setTreatHolidaysOff] = useState(true)
  const [grid, setGrid] = useState<boolean[][]>(() => windowsToGrid([]))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [assignEnvId, setAssignEnvId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [unassigningId, setUnassigningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!scheduleId) return
    const sched: Schedule = await api.getSchedule(scheduleId)
    setSchedule(sched)
    setName(sched.name ?? '')
    setDescription(sched.description ?? '')
    setTreatHolidaysOff(!!sched.treat_holidays_off)
    setGrid(windowsToGrid(sched.windows ?? []))
    setDirty(false)
    if (sched.workspace_id) {
      const envs = await api.getEnvironments(sched.workspace_id).catch(() => [])
      setEnvironments(Array.isArray(envs) ? envs : [])
    }
  }, [scheduleId])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        await load()
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load schedule.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [load])

  const toggleCell = (day: number, hour: number) => {
    setGrid((g) => {
      const next = g.map((row) => row.slice())
      next[day][hour] = !next[day][hour]
      return next
    })
    setDirty(true)
  }

  const setDay = (day: number, on: boolean) => {
    setGrid((g) => {
      const next = g.map((row) => row.slice())
      next[day] = Array.from({ length: 24 }, () => on)
      return next
    })
    setDirty(true)
  }

  const applyRange = (days: number[], start: number, end: number) => {
    setGrid((g) => {
      const next = g.map((row) => Array.from({ length: 24 }, () => false))
      days.forEach((day) => {
        for (let h = start; h < end; h++) next[day][h] = true
      })
      return next
    })
    setDirty(true)
  }

  const windows = useMemo(() => gridToWindows(grid), [grid])
  const effectiveHours = useMemo(() => hoursForWindows(windows), [windows])
  const offPct = Math.max(0, Math.min(100, Math.round((1 - effectiveHours / 168) * 100)))

  const onSave = useCallback(async () => {
    if (!schedule) return
    if (!name.trim()) {
      setError('Schedule name is required.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        windows: gridToWindows(grid),
        treat_holidays_off: treatHolidaysOff,
      }
      await api.updateSchedule(schedule.id, body)
      setNotice('Schedule saved.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to save schedule.')
    } finally {
      setSaving(false)
    }
  }, [schedule, name, description, grid, treatHolidaysOff, load])

  const onAssign = useCallback(async () => {
    if (!schedule || !assignEnvId) return
    setAssigning(true)
    setError(null)
    setNotice(null)
    try {
      await api.assignSchedule(schedule.id, { environment_id: assignEnvId })
      setAssignEnvId('')
      setNotice('Environment assigned to schedule.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to assign environment.')
    } finally {
      setAssigning(false)
    }
  }, [schedule, assignEnvId, load])

  const onUnassign = useCallback(
    async (assignmentId: string) => {
      setUnassigningId(assignmentId)
      setError(null)
      try {
        await api.unassignSchedule(assignmentId)
        setNotice('Assignment removed.')
        await load()
      } catch (e: any) {
        setError(e?.message || 'Failed to remove assignment.')
      } finally {
        setUnassigningId(null)
      }
    },
    [load],
  )

  const envNameById = useMemo(() => {
    const m = new Map<string, string>()
    environments.forEach((e) => m.set(e.id, e.name))
    return m
  }, [environments])

  const assignments = schedule?.assignments ?? []
  const assignedEnvIds = useMemo(
    () => new Set(assignments.map((a) => a.environment_id).filter(Boolean) as string[]),
    [assignments],
  )
  const availableEnvs = useMemo(
    () => environments.filter((e) => !assignedEnvIds.has(e.id)),
    [environments, assignedEnvIds],
  )

  if (loading) return <PageSpinner label="Loading schedule..." />

  if (!schedule) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🗓️</span>}
          title="Schedule not found"
          description={error || 'This schedule may have been deleted.'}
          action={
            <Link href="/dashboard/schedules">
              <Button variant="secondary">Back to schedules</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const isPreset = !!schedule.is_preset

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/schedules" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Schedules
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
              {schedule.name}
              {isPreset ? <Badge tone="info">Preset</Badge> : <Badge>Custom</Badge>}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">Edit on/off windows and assign environments.</p>
          </div>
          <Button onClick={onSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
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
        <Stat label="On-hours / week" value={`${effectiveHours.toFixed(0)}h`} />
        <Stat label="Off vs 24/7" value={`${offPct}%`} tone="warning" />
        <Stat label="Assignments" value={assignments.length} />
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">Details</h3>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">Name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">Description</span>
              <input
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setDirty(true)
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={treatHolidaysOff}
              onChange={(e) => {
                setTreatHolidaysOff(e.target.checked)
                setDirty(true)
              }}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-yellow-400"
            />
            Treat holidays as off-hours
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">On/off window editor</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => applyRange([1, 2, 3, 4, 5], 9, 18)}>
              9–6 weekdays
            </Button>
            <Button variant="ghost" onClick={() => applyRange([1, 2, 3, 4, 5], 0, 24)}>
              24h weekdays
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setGrid(windowsToGrid([]))
                setDirty(true)
              }}
            >
              Clear all
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-xs text-zinc-500">
            Click cells to toggle an hour on (yellow = running). Use the row label to toggle a whole day. Hours run
            00:00 → 23:00.
          </p>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="mb-1 flex">
                <div className="w-16 shrink-0" />
                <div className="flex flex-1">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-zinc-600">
                      {h % 3 === 0 ? h : ''}
                    </div>
                  ))}
                </div>
              </div>
              {grid.map((hours, day) => {
                const allOn = hours.every(Boolean)
                return (
                  <div key={day} className="mb-0.5 flex items-center">
                    <button
                      onClick={() => setDay(day, !allOn)}
                      className="w-16 shrink-0 text-left text-xs font-medium text-zinc-400 hover:text-yellow-300"
                      title={`Toggle all of ${DAYS[day]}`}
                    >
                      {DAY_SHORT[day]}
                    </button>
                    <div className="flex flex-1 gap-px">
                      {hours.map((on, h) => (
                        <button
                          key={h}
                          onClick={() => toggleCell(day, h)}
                          title={`${DAYS[day]} ${h}:00`}
                          className={`h-6 flex-1 rounded-sm transition-colors ${
                            on ? 'bg-yellow-400 hover:bg-yellow-300' : 'bg-zinc-800 hover:bg-zinc-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-yellow-400" /> Running
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-zinc-800" /> Off (recoverable)
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">Assignments</h3>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 sm:max-w-xs">
              <span className="text-xs font-medium text-zinc-400">Assign an environment</span>
              <select
                value={assignEnvId}
                onChange={(e) => setAssignEnvId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">Select environment…</option>
                {availableEnvs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.env_kind ? ` (${e.env_kind})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={onAssign} disabled={!assignEnvId || assigning}>
              {assigning ? 'Assigning…' : 'Assign'}
            </Button>
          </div>

          {availableEnvs.length === 0 && environments.length > 0 && (
            <p className="text-xs text-zinc-600">All environments are already assigned to this schedule.</p>
          )}
          {environments.length === 0 && (
            <p className="text-xs text-zinc-600">
              No environments yet.{' '}
              <Link href="/dashboard/environments" className="text-yellow-300 hover:underline">
                Create one
              </Link>{' '}
              to assign a schedule.
            </p>
          )}

          {assignments.length === 0 ? (
            <EmptyState
              title="No assignments"
              description="Assign environments so their idle time is measured against this schedule."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Target</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {assignments.map((a) => {
                  const label = a.environment_id
                    ? envNameById.get(a.environment_id) || a.environment_id
                    : a.resource_id || '—'
                  return (
                    <TR key={a.id}>
                      <TD>
                        {a.environment_id ? (
                          <Link
                            href={`/dashboard/environments/${a.environment_id}`}
                            className="font-medium text-zinc-200 hover:text-yellow-300"
                          >
                            {label}
                          </Link>
                        ) : (
                          <span className="font-medium text-zinc-200">{label}</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={a.environment_id ? 'info' : 'default'}>
                          {a.environment_id ? 'Environment' : 'Resource'}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => onUnassign(a.id)}
                          disabled={unassigningId === a.id}
                        >
                          {unassigningId === a.id ? 'Removing…' : 'Unassign'}
                        </Button>
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
