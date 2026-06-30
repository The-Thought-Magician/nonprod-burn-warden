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
  workspace_id: string
  name: string
  lead_email?: string | null
  created_by?: string | null
  created_at?: string | null
  monthly_spend_cents?: number | null
}

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

type FormState = { name: string; lead_email: string }

const emptyForm: FormState = { name: '', lead_email: '' }

export default function TeamsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Team | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
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

  const loadData = useCallback(async (wsId: string) => {
    const res = await api.getTeams(wsId)
    setTeams(Array.isArray(res) ? res : [])
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
        await loadData(wsId)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load teams.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [resolveWorkspace, loadData])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      await loadData(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to reload teams.')
    }
  }, [workspaceId, loadData])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((team: Team) => {
    setEditing(team)
    setForm({ name: team.name ?? '', lead_email: team.lead_email ?? '' })
    setFormError(null)
    setModalOpen(true)
  }, [])

  const onSubmit = useCallback(async () => {
    if (!workspaceId) return
    const name = form.name.trim()
    if (!name) {
      setFormError('Team name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      const payload: Record<string, unknown> = {
        name,
        lead_email: form.lead_email.trim() || null,
      }
      if (editing) {
        await api.updateTeam(editing.id, payload)
        setNotice(`Updated team "${name}".`)
      } else {
        await api.createTeam({ workspace_id: workspaceId, ...payload })
        setNotice(`Created team "${name}".`)
      }
      setModalOpen(false)
      await loadData(workspaceId)
    } catch (e: any) {
      setFormError(e?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }, [workspaceId, form, editing, loadData])

  const onDelete = useCallback(
    async (team: Team) => {
      if (!workspaceId) return
      if (typeof window !== 'undefined' && !window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) {
        return
      }
      setDeletingId(team.id)
      setError(null)
      setNotice(null)
      try {
        await api.deleteTeam(team.id)
        setNotice(`Deleted team "${team.name}".`)
        await loadData(workspaceId)
      } catch (e: any) {
        setError(e?.message || 'Delete failed.')
      } finally {
        setDeletingId(null)
      }
    },
    [workspaceId, loadData],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = teams
    if (q) {
      rows = rows.filter((t) =>
        [t.name, t.lead_email].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    }
    return [...rows].sort((a, b) => (b.monthly_spend_cents ?? 0) - (a.monthly_spend_cents ?? 0))
  }, [teams, search])

  const totalSpend = useMemo(
    () => teams.reduce((s, t) => s + (t.monthly_spend_cents ?? 0), 0),
    [teams],
  )
  const topTeam = useMemo(
    () =>
      [...teams].sort((a, b) => (b.monthly_spend_cents ?? 0) - (a.monthly_spend_cents ?? 0))[0] ?? null,
    [teams],
  )
  const maxSpend = teams.reduce((m, t) => Math.max(m, t.monthly_spend_cents ?? 0), 0) || 1

  if (loading) return <PageSpinner label="Loading teams..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before managing teams."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Teams</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Organize ownership of cloud spend. Each team rolls up the monthly cost of its assigned resources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={openCreate}>New team</Button>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Teams" value={teams.length.toLocaleString()} />
        <Stat label="Total monthly spend" value={dollars(totalSpend)} tone="warning" />
        <Stat
          label="Top spender"
          value={topTeam ? topTeam.name : '—'}
          sub={topTeam ? dollars(topTeam.monthly_spend_cents) + ' / mo' : undefined}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">All teams</h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teams…"
            className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={teams.length === 0 ? 'No teams yet' : 'No matching teams'}
                description={
                  teams.length === 0
                    ? 'Create a team to attribute cloud spend, set budgets and produce showback statements.'
                    : 'Try a different search term.'
                }
                action={
                  teams.length === 0 ? <Button onClick={openCreate}>New team</Button> : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Team</TH>
                  <TH>Lead</TH>
                  <TH className="w-1/3">Monthly spend</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <div className="font-medium text-zinc-100">{t.name}</div>
                      {t.created_at && (
                        <div className="text-xs text-zinc-600">
                          since {new Date(t.created_at).toLocaleDateString()}
                        </div>
                      )}
                    </TD>
                    <TD>
                      {t.lead_email ? (
                        <a href={`mailto:${t.lead_email}`} className="text-sky-300 hover:underline">
                          {t.lead_email}
                        </a>
                      ) : (
                        <span className="text-zinc-600">unassigned</span>
                      )}
                    </TD>
                    <TD>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="tabular-nums font-medium text-yellow-300">
                          {dollars(t.monthly_spend_cents)}
                        </span>
                        {totalSpend > 0 && (
                          <Badge tone="default">
                            {Math.round(((t.monthly_spend_cents ?? 0) / totalSpend) * 100)}%
                          </Badge>
                        )}
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-yellow-400"
                          style={{ width: `${Math.max(2, ((t.monthly_spend_cents ?? 0) / maxSpend) * 100)}%` }}
                        />
                      </div>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openEdit(t)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => onDelete(t)}
                          disabled={deletingId === t.id}
                        >
                          {deletingId === t.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'Edit team' : 'New team'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create team'}
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
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Team name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Platform Engineering"
              autoFocus
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Lead email</span>
            <input
              type="email"
              value={form.lead_email}
              onChange={(e) => setForm((f) => ({ ...f, lead_email: e.target.value }))}
              placeholder="lead@company.com"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
            <span className="text-xs text-zinc-600">Optional. Used for budget alerts and showback statements.</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
