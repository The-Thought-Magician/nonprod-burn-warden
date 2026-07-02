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

type SavedView = {
  id: string
  workspace_id: string
  user_id?: string | null
  name: string
  target: string
  filters?: Record<string, unknown> | null
  is_default?: boolean | null
  created_at?: string | null
}

const TARGETS: { value: string; label: string }[] = [
  { value: 'resources', label: 'Resources' },
  { value: 'environments', label: 'Environments' },
  { value: 'idle', label: 'Idle Analysis' },
  { value: 'ledger', label: 'Waste Ledger' },
  { value: 'orphans', label: 'Orphans' },
  { value: 'recommendations', label: 'Recommendations' },
  { value: 'budgets', label: 'Budgets' },
  { value: 'showback', label: 'Showback' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'activity', label: 'Activity Log' },
  { value: 'reports', label: 'Recovery Reports' },
]

function targetLabel(target: string): string {
  return TARGETS.find((t) => t.value === target)?.label ?? target
}

type FormState = { name: string; target: string; filters: string; is_default: boolean }

const emptyForm: FormState = { name: '', target: 'resources', filters: '{}', is_default: false }

export default function ViewsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [views, setViews] = useState<SavedView[]>([])
  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SavedView | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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
    const res = await api.getViews(wsId)
    setViews(Array.isArray(res) ? res : [])
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
        if (active) setError(e?.message || 'Failed to load saved views.')
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
      setError(e?.message || 'Failed to reload saved views.')
    }
  }, [workspaceId, loadData])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((v: SavedView) => {
    setEditing(v)
    setForm({
      name: v.name ?? '',
      target: v.target ?? 'resources',
      filters: JSON.stringify(v.filters ?? {}, null, 2),
      is_default: !!v.is_default,
    })
    setFormError(null)
    setModalOpen(true)
  }, [])

  const onSubmit = useCallback(async () => {
    if (!workspaceId) return
    const name = form.name.trim()
    if (!name) {
      setFormError('A view name is required.')
      return
    }
    let parsedFilters: unknown = {}
    const raw = form.filters.trim()
    if (raw) {
      try {
        parsedFilters = JSON.parse(raw)
      } catch {
        setFormError('Filters must be valid JSON (e.g. {"env_kind":"dev"}).')
        return
      }
    }
    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      if (editing) {
        await api.updateView(editing.id, {
          name,
          target: form.target,
          filters: parsedFilters,
          is_default: form.is_default,
        })
        setNotice(`Updated view "${name}".`)
      } else {
        await api.createView({
          workspace_id: workspaceId,
          name,
          target: form.target,
          filters: parsedFilters,
          is_default: form.is_default,
        })
        setNotice(`Created view "${name}".`)
      }
      setModalOpen(false)
      await loadData(workspaceId)
    } catch (e: any) {
      setFormError(e?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }, [workspaceId, form, editing, loadData])

  const onSetDefault = useCallback(
    async (v: SavedView) => {
      if (!workspaceId) return
      setBusyId(v.id)
      setError(null)
      setNotice(null)
      try {
        // Clear any existing default for the same target, then set this one.
        const others = views.filter(
          (o) => o.id !== v.id && o.target === v.target && o.is_default,
        )
        for (const o of others) {
          await api.updateView(o.id, { is_default: false })
        }
        await api.updateView(v.id, { is_default: true })
        setNotice(`"${v.name}" is now the default view for ${targetLabel(v.target)}.`)
        await loadData(workspaceId)
      } catch (e: any) {
        setError(e?.message || 'Failed to set default.')
      } finally {
        setBusyId(null)
      }
    },
    [workspaceId, views, loadData],
  )

  const onClearDefault = useCallback(
    async (v: SavedView) => {
      if (!workspaceId) return
      setBusyId(v.id)
      setError(null)
      setNotice(null)
      try {
        await api.updateView(v.id, { is_default: false })
        setNotice(`Cleared default flag on "${v.name}".`)
        await loadData(workspaceId)
      } catch (e: any) {
        setError(e?.message || 'Failed to clear default.')
      } finally {
        setBusyId(null)
      }
    },
    [workspaceId, loadData],
  )

  const onDelete = useCallback(
    async (v: SavedView) => {
      if (!workspaceId) return
      if (typeof window !== 'undefined' && !window.confirm(`Delete saved view "${v.name}"?`)) return
      setBusyId(v.id)
      setError(null)
      setNotice(null)
      try {
        await api.deleteView(v.id)
        setNotice(`Deleted view "${v.name}".`)
        await loadData(workspaceId)
      } catch (e: any) {
        setError(e?.message || 'Delete failed.')
      } finally {
        setBusyId(null)
      }
    },
    [workspaceId, loadData],
  )

  const targetsPresent = useMemo(() => {
    const set = new Set<string>()
    for (const v of views) set.add(v.target)
    return Array.from(set).sort()
  }, [views])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = views
    if (targetFilter) rows = rows.filter((v) => v.target === targetFilter)
    if (q) {
      rows = rows.filter((v) =>
        [v.name, v.target, JSON.stringify(v.filters ?? '')].join(' ').toLowerCase().includes(q),
      )
    }
    return [...rows].sort((a, b) => {
      if (a.target !== b.target) return a.target.localeCompare(b.target)
      if (!!b.is_default !== !!a.is_default) return b.is_default ? 1 : -1
      return a.name.localeCompare(b.name)
    })
  }, [views, search, targetFilter])

  const defaultCount = useMemo(() => views.filter((v) => v.is_default).length, [views])

  if (loading) return <PageSpinner label="Loading saved views..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before managing saved views."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Saved Views</h1>
          <p className="mt-1 text-sm text-slate-500">
            Save filter presets for lists like resources, idle analysis and the waste ledger. Mark one default per
            target.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={openCreate}>New view</Button>
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
        <Stat label="Saved views" value={views.length.toLocaleString()} />
        <Stat label="Defaults set" value={defaultCount.toLocaleString()} tone="warning" />
        <Stat label="Targets covered" value={targetsPresent.length.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <h3 className="mr-auto text-sm font-semibold text-slate-200">All views</h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search views…"
            className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All targets</option>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<span>🔖</span>}
                title={views.length === 0 ? 'No saved views yet' : 'No matching views'}
                description={
                  views.length === 0
                    ? 'Create a view to store a reusable set of filters for a list page.'
                    : 'Try a different search term or target.'
                }
                action={views.length === 0 ? <Button onClick={openCreate}>New view</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Target</TH>
                  <TH>Filters</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((v) => {
                  const filterKeys = v.filters ? Object.keys(v.filters) : []
                  return (
                    <TR key={v.id}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-100">{v.name}</span>
                          {v.is_default && <Badge tone="success">default</Badge>}
                        </div>
                        {v.created_at && (
                          <div className="text-xs text-slate-600">
                            since {new Date(v.created_at).toLocaleDateString()}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <Badge tone="info">{targetLabel(v.target)}</Badge>
                      </TD>
                      <TD>
                        {filterKeys.length === 0 ? (
                          <span className="text-slate-600">no filters</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {filterKeys.slice(0, 4).map((k) => (
                              <span
                                key={k}
                                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-400"
                              >
                                {k}={String((v.filters as Record<string, unknown>)[k])}
                              </span>
                            ))}
                            {filterKeys.length > 4 && (
                              <span className="text-xs text-slate-600">+{filterKeys.length - 4}</span>
                            )}
                          </div>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          {v.is_default ? (
                            <Button
                              variant="ghost"
                              onClick={() => onClearDefault(v)}
                              disabled={busyId === v.id}
                            >
                              Unset default
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => onSetDefault(v)}
                              disabled={busyId === v.id}
                            >
                              Set default
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => openEdit(v)} disabled={busyId === v.id}>
                            Edit
                          </Button>
                          <Button variant="danger" onClick={() => onDelete(v)} disabled={busyId === v.id}>
                            {busyId === v.id ? '…' : 'Delete'}
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
        title={editing ? 'Edit saved view' : 'New saved view'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create view'}
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
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">View name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Idle dev resources"
              autoFocus
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Target list</span>
            <select
              value={form.target}
              onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {TARGETS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Filters (JSON)</span>
            <textarea
              value={form.filters}
              onChange={(e) => setForm((f) => ({ ...f, filters: e.target.value }))}
              rows={5}
              spellCheck={false}
              placeholder='{"env_kind":"dev","status":"open"}'
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <span className="text-xs text-slate-600">
              Stored as JSON and re-applied when the view is opened on its target page.
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-emerald-400"
            />
            <span className="text-sm text-slate-300">Make this the default view for its target</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
