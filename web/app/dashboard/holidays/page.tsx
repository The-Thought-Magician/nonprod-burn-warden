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
import { Modal } from '@/components/ui/Modal'

type Calendar = {
  id: string
  workspace_id?: string
  name?: string
  region?: string
  holiday_count?: number
  created_at?: string
}

type Holiday = {
  id: string
  holiday_calendar_id?: string
  name?: string
  date?: string
  is_full_day?: boolean
  created_at?: string
}

const REGIONS = ['US', 'UK', 'EU', 'CA', 'AU', 'IN', 'Global'] as const

function fmtDate(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function weekday(d?: string): string {
  if (!d) return ''
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { weekday: 'short' })
}

export default function HolidaysPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [holidaysLoading, setHolidaysLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState<'all' | string>('all')

  // calendar create modal
  const [calModalOpen, setCalModalOpen] = useState(false)
  const [calName, setCalName] = useState('')
  const [calRegion, setCalRegion] = useState<string>('US')
  const [savingCal, setSavingCal] = useState(false)

  // holiday create modal
  const [holModalOpen, setHolModalOpen] = useState(false)
  const [holName, setHolName] = useState('')
  const [holDate, setHolDate] = useState('')
  const [holFullDay, setHolFullDay] = useState(true)
  const [savingHol, setSavingHol] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const selectedCalendar = useMemo(
    () => calendars.find((c) => c.id === selectedId) || null,
    [calendars, selectedId],
  )

  async function loadCalendars(wsId: string): Promise<Calendar[]> {
    const res = await api.getHolidayCalendars(wsId)
    const list = Array.isArray(res) ? res : []
    setCalendars(list)
    return list
  }

  async function loadHolidays(calId: string) {
    setHolidaysLoading(true)
    try {
      const res = await api.getHolidays(calId)
      setHolidays(Array.isArray(res) ? res : [])
    } finally {
      setHolidaysLoading(false)
    }
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
        const cals = await loadCalendars(wsId)
        if (!active) return
        if (cals.length) {
          setSelectedId(cals[0].id)
          await loadHolidays(cals[0].id)
        }
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load holiday calendars')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function selectCalendar(id: string) {
    setSelectedId(id)
    setSearch('')
    setYearFilter('all')
    setError(null)
    try {
      await loadHolidays(id)
    } catch (e: any) {
      setError(e?.message || 'Failed to load holidays')
    }
  }

  async function createCalendar() {
    if (!workspaceId || !calName.trim()) return
    setSavingCal(true)
    setError(null)
    try {
      const created = await api.createHolidayCalendar({
        workspace_id: workspaceId,
        name: calName.trim(),
        region: calRegion,
      })
      setCalModalOpen(false)
      setCalName('')
      setCalRegion('US')
      const cals = await loadCalendars(workspaceId)
      const newId = created?.id || cals[cals.length - 1]?.id
      if (newId) {
        setSelectedId(newId)
        setHolidays([])
      }
      setNotice('Calendar created.')
    } catch (e: any) {
      setError(e?.message || 'Failed to create calendar')
    } finally {
      setSavingCal(false)
    }
  }

  async function deleteCalendar(cal: Calendar) {
    if (!workspaceId) return
    if (!confirm(`Delete calendar "${cal.name}" and all its holidays?`)) return
    setBusyId(cal.id)
    setError(null)
    try {
      await api.deleteHolidayCalendar(cal.id)
      const cals = await loadCalendars(workspaceId)
      if (selectedId === cal.id) {
        if (cals.length) {
          setSelectedId(cals[0].id)
          await loadHolidays(cals[0].id)
        } else {
          setSelectedId(null)
          setHolidays([])
        }
      }
      setNotice('Calendar deleted.')
    } catch (e: any) {
      setError(e?.message || 'Failed to delete calendar')
    } finally {
      setBusyId(null)
    }
  }

  async function createHoliday() {
    if (!workspaceId || !selectedId || !holName.trim() || !holDate) return
    setSavingHol(true)
    setError(null)
    try {
      await api.createHoliday({
        workspace_id: workspaceId,
        holiday_calendar_id: selectedId,
        name: holName.trim(),
        date: holDate,
        is_full_day: holFullDay,
      })
      setHolModalOpen(false)
      setHolName('')
      setHolDate('')
      setHolFullDay(true)
      await loadHolidays(selectedId)
      await loadCalendars(workspaceId)
      setNotice('Holiday added.')
    } catch (e: any) {
      setError(e?.message || 'Failed to add holiday')
    } finally {
      setSavingHol(false)
    }
  }

  async function deleteHoliday(h: Holiday) {
    if (!workspaceId || !selectedId) return
    setBusyId(h.id)
    setError(null)
    try {
      await api.deleteHoliday(h.id)
      setHolidays((prev) => prev.filter((x) => x.id !== h.id))
      await loadCalendars(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to delete holiday')
    } finally {
      setBusyId(null)
    }
  }

  async function seedStandard() {
    if (!workspaceId || !selectedId) return
    setSeeding(true)
    setError(null)
    setNotice(null)
    try {
      const region = selectedCalendar?.region || 'US'
      const res = await api.seedStandardHolidays({
        workspace_id: workspaceId,
        holiday_calendar_id: selectedId,
        region,
      })
      const created = res?.created ?? 0
      await loadHolidays(selectedId)
      await loadCalendars(workspaceId)
      setNotice(`Seeded ${created} standard ${region} holiday(s).`)
    } catch (e: any) {
      setError(e?.message || 'Failed to seed standard holidays')
    } finally {
      setSeeding(false)
    }
  }

  const years = useMemo(() => {
    const set = new Set<string>()
    for (const h of holidays) {
      if (h.date) set.add(String(new Date(h.date.length <= 10 ? `${h.date}T00:00:00` : h.date).getFullYear()))
    }
    return Array.from(set)
      .filter((y) => y !== 'NaN')
      .sort()
  }, [holidays])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return holidays
      .filter((h) => {
        if (yearFilter !== 'all') {
          const y = h.date ? String(new Date(h.date.length <= 10 ? `${h.date}T00:00:00` : h.date).getFullYear()) : ''
          if (y !== yearFilter) return false
        }
        if (q && !(h.name || '').toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [holidays, search, yearFilter])

  const totalHolidays = useMemo(
    () => calendars.reduce((sum, c) => sum + (c.holiday_count ?? 0), 0),
    [calendars],
  )
  const fullDayCount = useMemo(() => holidays.filter((h) => h.is_full_day !== false).length, [holidays])

  if (loading) return <PageSpinner label="Loading holiday calendars..." />

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        <Header onNew={() => {}} disabled />
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before managing holiday calendars."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onNew={() => setCalModalOpen(true)} />

      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Calendars" value={calendars.length} sub="Holiday calendars in workspace" />
        <Stat label="Total Holidays" value={totalHolidays} tone="warning" sub="Across all calendars" />
        <Stat
          label="Selected Calendar"
          value={selectedCalendar ? holidays.length : '—'}
          sub={selectedCalendar ? `${selectedCalendar.name} · ${fullDayCount} full-day` : 'No calendar selected'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Calendars list */}
        <Card className="h-fit">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Calendars</h2>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setCalModalOpen(true)}>
              + New
            </Button>
          </CardHeader>
          <CardBody className="p-0">
            {calendars.length === 0 ? (
              <div className="px-5 py-8">
                <EmptyState
                  title="No calendars"
                  description="Create a calendar, then add holidays or seed a standard set."
                  action={<Button onClick={() => setCalModalOpen(true)}>Create Calendar</Button>}
                />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {calendars.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => selectCalendar(c.id)}
                      className={`flex w-full items-center justify-between gap-2 px-5 py-3 text-left transition-colors ${
                        selectedId === c.id ? 'bg-yellow-400/5' : 'hover:bg-zinc-900/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div
                          className={`truncate text-sm font-medium ${
                            selectedId === c.id ? 'text-yellow-300' : 'text-zinc-100'
                          }`}
                        >
                          {c.name || 'Untitled'}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                          {c.region && <Badge tone="info">{c.region}</Badge>}
                          <span>{c.holiday_count ?? 0} holiday(s)</span>
                        </div>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteCalendar(c)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            deleteCalendar(c)
                          }
                        }}
                        className={`shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300 ${
                          busyId === c.id ? 'opacity-50' : ''
                        }`}
                      >
                        Delete
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Holidays for selected calendar */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-zinc-200">
                {selectedCalendar ? `${selectedCalendar.name} — Holidays` : 'Holidays'}
              </h2>
              {selectedCalendar?.region && (
                <p className="mt-0.5 text-xs text-zinc-500">Region: {selectedCalendar.region}</p>
              )}
            </div>
            {selectedCalendar && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value as 'all' | string)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:border-yellow-500/60 focus:outline-none"
                >
                  <option value="all">All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search holidays…"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-yellow-500/60 focus:outline-none"
                />
                <Button variant="secondary" disabled={seeding} onClick={seedStandard}>
                  {seeding ? 'Seeding…' : 'Seed Standard'}
                </Button>
                <Button onClick={() => setHolModalOpen(true)}>+ Add Holiday</Button>
              </div>
            )}
          </CardHeader>
          <CardBody className="p-0">
            {!selectedCalendar ? (
              <div className="px-5 py-12">
                <EmptyState title="Select a calendar" description="Choose a calendar from the left to view holidays." />
              </div>
            ) : holidaysLoading ? (
              <div className="py-12">
                <PageSpinner label="Loading holidays..." />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  title={holidays.length === 0 ? 'No holidays yet' : 'No holidays match your filters'}
                  description={
                    holidays.length === 0
                      ? 'Add holidays manually or seed a standard regional set so off-hours waste excludes these days.'
                      : 'Try clearing the search or year filter.'
                  }
                  action={
                    holidays.length === 0 ? (
                      <div className="flex gap-2">
                        <Button variant="secondary" disabled={seeding} onClick={seedStandard}>
                          {seeding ? 'Seeding…' : 'Seed Standard Set'}
                        </Button>
                        <Button onClick={() => setHolModalOpen(true)}>Add Holiday</Button>
                      </div>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Holiday</TH>
                    <TH>Date</TH>
                    <TH>Day</TH>
                    <TH>Coverage</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((h) => (
                    <TR key={h.id}>
                      <TD className="font-medium text-zinc-100">{h.name || '—'}</TD>
                      <TD className="tabular-nums">{fmtDate(h.date)}</TD>
                      <TD className="text-zinc-400">{weekday(h.date)}</TD>
                      <TD>
                        {h.is_full_day === false ? (
                          <Badge tone="default">Partial</Badge>
                        ) : (
                          <Badge tone="success">Full day</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          disabled={busyId === h.id}
                          onClick={() => deleteHoliday(h)}
                        >
                          {busyId === h.id ? 'Removing…' : 'Delete'}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Create calendar modal */}
      <Modal
        open={calModalOpen}
        onClose={() => setCalModalOpen(false)}
        title="New Holiday Calendar"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCalModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createCalendar} disabled={savingCal || !calName.trim()}>
              {savingCal ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={calName}
              onChange={(e) => setCalName(e.target.value)}
              placeholder="e.g. US Federal Holidays"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-yellow-500/60 focus:outline-none"
            />
          </Field>
          <Field label="Region">
            <select
              value={calRegion}
              onChange={(e) => setCalRegion(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500/60 focus:outline-none"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              Determines the standard holiday set available via Seed Standard.
            </p>
          </Field>
        </div>
      </Modal>

      {/* Add holiday modal */}
      <Modal
        open={holModalOpen}
        onClose={() => setHolModalOpen(false)}
        title="Add Holiday"
        footer={
          <>
            <Button variant="ghost" onClick={() => setHolModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createHoliday} disabled={savingHol || !holName.trim() || !holDate}>
              {savingHol ? 'Adding…' : 'Add Holiday'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={holName}
              onChange={(e) => setHolName(e.target.value)}
              placeholder="e.g. New Year's Day"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-yellow-500/60 focus:outline-none"
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={holDate}
              onChange={(e) => setHolDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500/60 focus:outline-none"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={holFullDay}
              onChange={(e) => setHolFullDay(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-yellow-400"
            />
            Full-day holiday (treated as off-hours all day)
          </label>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</label>
      {children}
    </div>
  )
}

function Header({ onNew, disabled }: { onNew: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Holiday Calendars</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Calendars feed off-hours waste detection, so idle resources on public holidays count against recoverable
          spend.
        </p>
      </div>
      <Button onClick={onNew} disabled={disabled}>
        + New Calendar
      </Button>
    </div>
  )
}
