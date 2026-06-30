'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Team = {
  id: string
  name: string
  monthly_spend_cents?: number | null
}

type Budget = {
  id: string
  workspace_id: string
  team_id: string
  period: string
  budget_cents: number
  actual_cents?: number | null
  projected_cents?: number | null
  over_budget?: boolean | null
  created_at?: string | null
}

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type FormState = { team_id: string; period: string; budget_dollars: string }

export default function BudgetsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [budgets, setBudgets] = useState<Budget[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [period, setPeriod] = useState(currentPeriod())

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [form, setForm] = useState<FormState>({ team_id: '', period: currentPeriod(), budget_dollars: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nbw_workspace_id') : null
    const workspaces = await api.getWorkspaces().catch(() => [])
    const list: any[] = Array.isArray(workspaces) ? workspaces : []
    if (stored && list.some((w) => w.id === stored)) return stored
    const first = list[0]?.id ?? null
    if (first && typeof window !== 'undefined') localStorage.setItem('nbw_workspace_id', first)
    return first
  }, [])

  const loadData = useCallback(async (wsId: string, periodFilter: string) => {
    const query: Record<string, string> = { workspace_id: wsId }
    if (periodFilter) query.period = periodFilter
    const [budgetsRes, teamsRes] = await Promise.all([api.getBudgets(query), api.getTeams(wsId)])
    setBudgets(Array.isArray(budgetsRes) ? budgetsRes : [])
    setTeams(Array.isArray(teamsRes) ? teamsRes : [])
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
        await loadData(wsId, period)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load budgets.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveWorkspace, loadData])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      await loadData(workspaceId, period)
    } catch (e: any) {
      setError(e?.message || 'Failed to reload budgets.')
    }
  }, [workspaceId, period, loadData])

  const onPeriodChange = useCallback(
    (next: string) => {
      setPeriod(next)
      if (workspaceId) loadData(workspaceId, next).catch((err: any) => setError(err?.message || 'Filter failed.'))
    },
    [workspaceId, loadData],
  )

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>()
    teams.forEach((t) => m.set(t.id, t.name))
    return m
  }, [teams])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm({ team_id: teams[0]?.id ?? '', period: period || currentPeriod(), budget_dollars: '' })
    setFormError(null)
    setModalOpen(true)
  }, [teams, period])

  const openEdit = useCallback((b: Budget) => {
    setEditing(b)
    setForm({
      team_id: b.team_id,
      period: b.period,
      budget_dollars: ((b.budget_cents ?? 0) / 100).toString(),
    })
    setFormError(null)
    setModalOpen(true)
  }, [])

  const onSubmit = useCallback(async () => {
    if (!workspaceId) return
    const cents = Math.round(parseFloat(form.budget_dollars) * 100)
    if (!Number.isFinite(cents) || cents < 0) {
      setFormError('Enter a valid budget amount.')
      return
    }
    if (!editing && !form.team_id) {
      setFormError('Select a team.')
      return
    }
    if (!editing && !form.period.trim()) {
      setFormError('Enter a period (YYYY-MM).')
      return
    }
    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      if (editing) {
        await api.updateBudget(editing.id, { budget_cents: cents })
        setNotice(`Updated budget for ${teamNameById.get(editing.team_id) || 'team'} (${editing.period}).`)
      } else {
        await api.setBudget({
          workspace_id: workspaceId,
          team_id: form.team_id,
          period: form.period.trim(),
          budget_cents: cents,
        })
        setNotice(`Set budget for ${teamNameById.get(form.team_id) || 'team'} (${form.period.trim()}).`)
      }
      setModalOpen(false)
      await loadData(workspaceId, period)
    } catch (e: any) {
      setFormError(e?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }, [workspaceId, form, editing, teamNameById, loadData, period])

  const onDelete = useCallback(
    async (b: Budget) => {
      if (!workspaceId) return
      const label = `${teamNameById.get(b.team_id) || 'team'} (${b.period})`
      if (typeof window !== 'undefined' && !window.confirm(`Delete budget for ${label}?`)) return
      setDeletingId(b.id)
      setError(null)
      setNotice(null)
      try {
        await api.deleteBudget(b.id)
        setNotice(`Deleted budget for ${label}.`)
        await loadData(workspaceId, period)
      } catch (e: any) {
        setError(e?.message || 'Delete failed.')
      } finally {
        setDeletingId(null)
      }
    },
    [workspaceId, teamNameById, loadData, period],
  )

  const sorted = useMemo(
    () => [...budgets].sort((a, b) => (b.budget_cents ?? 0) - (a.budget_cents ?? 0)),
    [budgets],
  )

  const totals = useMemo(() => {
    const budget = budgets.reduce((s, b) => s + (b.budget_cents ?? 0), 0)
    const actual = budgets.reduce((s, b) => s + (b.actual_cents ?? 0), 0)
    const projected = budgets.reduce((s, b) => s + (b.projected_cents ?? 0), 0)
    const over = budgets.filter((b) => b.over_budget || (b.actual_cents ?? 0) > (b.budget_cents ?? 0)).length
    return { budget, actual, projected, over }
  }, [budgets])

  const periods = useMemo(() => {
    const set = new Set<string>([currentPeriod()])
    budgets.forEach((b) => b.period && set.add(b.period))
    if (period) set.add(period)
    return Array.from(set).sort().reverse()
  }, [budgets, period])

  if (loading) return <PageSpinner label="Loading budgets..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before setting budgets."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Budgets</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Per-team monthly budgets versus actual spend, with end-of-period projections and over-budget flags.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={openCreate} disabled={teams.length === 0}>
            Set budget
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
        <Stat label="Total budget" value={dollars(totals.budget)} />
        <Stat
          label="Actual spend"
          value={dollars(totals.actual)}
          tone={totals.actual > totals.budget ? 'danger' : 'success'}
          sub={totals.budget > 0 ? `${Math.round((totals.actual / totals.budget) * 100)}% of budget` : undefined}
        />
        <Stat
          label="Projected (EOP)"
          value={dollars(totals.projected)}
          tone={totals.projected > totals.budget ? 'warning' : 'default'}
        />
        <Stat label="Over budget" value={totals.over.toLocaleString()} tone={totals.over > 0 ? 'danger' : 'success'} />
      </div>

      {teams.length === 0 && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-300">
          No teams exist yet. Create a team first to assign budgets.
        </div>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">Budgets for {period || 'all periods'}</h3>
        </CardHeader>
        <CardBody className="p-0">
          {sorted.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No budgets set"
                description="Set a per-team budget for this period to track spend against plan."
                action={
                  teams.length > 0 ? <Button onClick={openCreate}>Set budget</Button> : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Team</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="w-1/4">Utilization</TH>
                  <TH className="text-right">Projected</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sorted.map((b) => {
                  const budget = b.budget_cents ?? 0
                  const actual = b.actual_cents ?? 0
                  const projected = b.projected_cents ?? 0
                  const pct = budget > 0 ? (actual / budget) * 100 : 0
                  const over = b.over_budget ?? actual > budget
                  const projOver = projected > budget
                  return (
                    <TR key={b.id}>
                      <TD>
                        <span className="font-medium text-zinc-100">
                          {teamNameById.get(b.team_id) || b.team_id}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone="default">{b.period}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{dollars(budget)}</TD>
                      <TD className="text-right tabular-nums font-medium">
                        <span className={over ? 'text-red-300' : 'text-zinc-200'}>{dollars(actual)}</span>
                      </TD>
                      <TD>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="tabular-nums text-zinc-400">{pct.toFixed(0)}%</span>
                          {over ? (
                            <Badge tone="danger">over</Badge>
                          ) : pct >= 80 ? (
                            <Badge tone="warning">near</Badge>
                          ) : (
                            <Badge tone="success">on track</Badge>
                          )}
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className={`h-full rounded-full ${over ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-400' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                          />
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums">
                        <span className={projOver ? 'text-yellow-300' : 'text-zinc-300'}>{dollars(projected)}</span>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => openEdit(b)}>
                            Edit
                          </Button>
                          <Button variant="danger" onClick={() => onDelete(b)} disabled={deletingId === b.id}>
                            {deletingId === b.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'Edit budget' : 'Set team budget'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Set budget'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Team</span>
            <select
              value={form.team_id}
              onChange={(e) => setForm((f) => ({ ...f, team_id: e.target.value }))}
              disabled={!!editing}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none disabled:opacity-60"
            >
              <option value="">Select a team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Period</span>
            <input
              value={form.period}
              onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
              placeholder="YYYY-MM"
              disabled={!!editing}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Monthly budget (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.budget_dollars}
              onChange={(e) => setForm((f) => ({ ...f, budget_dollars: e.target.value }))}
              placeholder="5000"
              autoFocus
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
            <span className="text-xs text-zinc-600">Stored as integer cents on the backend.</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
