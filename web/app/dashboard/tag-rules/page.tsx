'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'nbw.workspace_id'

type Workspace = { id: string; name: string }

type TagRule = {
  id: string
  workspace_id: string
  name: string
  env_kind: string | null
  tag_key: string
  tag_value: string | null
  priority: number
  is_active: boolean
  hit_count: number
  created_at?: string
}

const ENV_KINDS = ['production', 'staging', 'development', 'qa', 'preview', 'sandbox', 'test']

type TagForm = {
  name: string
  env_kind: string
  tag_key: string
  tag_value: string
  priority: number
  is_active: boolean
}

const emptyForm: TagForm = {
  name: '',
  env_kind: 'development',
  tag_key: '',
  tag_value: '',
  priority: 100,
  is_active: true,
}

function envTone(kind: string | null | undefined) {
  if (!kind) return 'default' as const
  if (kind === 'production') return 'danger' as const
  if (kind === 'staging' || kind === 'qa') return 'info' as const
  return 'warning' as const
}

export default function TagRulesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [rules, setRules] = useState<TagRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<TagRule | null>(null)
  const [form, setForm] = useState<TagForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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

  const loadRules = useCallback(async (wsId: string) => {
    if (!wsId) return
    setLoading(true)
    setError(null)
    try {
      const data: TagRule[] = await api.getTagRules(wsId)
      setRules(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load tag rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) {
      if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, workspaceId)
      loadRules(workspaceId)
    }
  }, [workspaceId, loadRules])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules
      .filter((r) => (kindFilter === 'all' ? true : (r.env_kind || '') === kindFilter))
      .filter((r) =>
        q
          ? r.name.toLowerCase().includes(q) ||
            r.tag_key.toLowerCase().includes(q) ||
            (r.tag_value || '').toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  }, [rules, search, kindFilter])

  const stats = useMemo(() => {
    const active = rules.filter((r) => r.is_active).length
    const totalHits = rules.reduce((s, r) => s + (r.hit_count || 0), 0)
    const keys = new Set(rules.map((r) => r.tag_key).filter(Boolean)).size
    return { total: rules.length, active, totalHits, keys }
  }, [rules])

  const topRules = useMemo(
    () => [...rules].sort((a, b) => (b.hit_count || 0) - (a.hit_count || 0)).slice(0, 6),
    [rules],
  )
  const maxHits = useMemo(() => Math.max(1, ...topRules.map((r) => r.hit_count || 0)), [topRules])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(rule: TagRule) {
    setEditing(rule)
    setForm({
      name: rule.name,
      env_kind: rule.env_kind || 'development',
      tag_key: rule.tag_key,
      tag_value: rule.tag_value || '',
      priority: rule.priority,
      is_active: rule.is_active,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submitForm() {
    if (!form.name.trim() || !form.tag_key.trim()) {
      setFormError('Name and tag key are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      env_kind: form.env_kind,
      tag_key: form.tag_key.trim(),
      tag_value: form.tag_value.trim() || null,
      priority: Number(form.priority) || 0,
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api.updateTagRule(editing.id, body)
      } else {
        await api.createTagRule(body)
      }
      setModalOpen(false)
      await loadRules(workspaceId)
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save tag rule')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rule: TagRule) {
    try {
      await api.updateTagRule(rule.id, { is_active: !rule.is_active })
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r)))
    } catch (e: any) {
      setError(e?.message || 'Failed to update tag rule')
    }
  }

  async function removeRule(rule: TagRule) {
    if (!confirm(`Delete tag rule "${rule.name}"?`)) return
    try {
      await api.deleteTagRule(rule.id)
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete tag rule')
    }
  }

  if (loading && !rules.length && !error) return <PageSpinner label="Loading tag rules..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Tag Rules</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Classify resources by cloud tags. Match a tag key alone, or a specific key/value pair.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={openCreate} disabled={!workspaceId}>
            New tag rule
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {!workspaceId && !loading ? (
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard first, then return to manage tag rules."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total tag rules" value={stats.total} />
            <Stat label="Active" value={stats.active} tone="success" />
            <Stat label="Total matches" value={stats.totalHits.toLocaleString()} tone="warning" />
            <Stat label="Distinct keys" value={stats.keys} />
          </div>

          {/* hit count bars */}
          {topRules.some((r) => (r.hit_count || 0) > 0) && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Top rules by matches
              </div>
              <div className="space-y-2.5">
                {topRules.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <div className="w-44 truncate text-sm text-zinc-300" title={r.name}>
                      {r.name}
                    </div>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-yellow-400"
                        style={{ width: `${((r.hit_count || 0) / maxHits) * 100}%` }}
                      />
                    </div>
                    <div className="w-16 text-right text-sm tabular-nums text-zinc-400">
                      {(r.hit_count || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, key or value..."
              className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="all">All env kinds</option>
              {ENV_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-500">
              {filtered.length} of {rules.length} rules
            </span>
          </div>

          {rules.length === 0 ? (
            <EmptyState
              title="No tag rules yet"
              description="Add a tag rule to classify resources by their cloud tags (e.g. env=staging)."
              action={<Button onClick={openCreate}>New tag rule</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No rules match your filters" description="Try clearing the search or env-kind filter." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Priority</TH>
                  <TH>Name</TH>
                  <TH>Tag key</TH>
                  <TH>Tag value</TH>
                  <TH>Env kind</TH>
                  <TH className="text-right">Hits</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="tabular-nums text-zinc-400">{r.priority}</TD>
                    <TD className="font-medium text-zinc-100">{r.name}</TD>
                    <TD>
                      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-yellow-300">{r.tag_key}</code>
                    </TD>
                    <TD>
                      {r.tag_value ? (
                        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200">{r.tag_value}</code>
                      ) : (
                        <span className="text-xs text-zinc-600">any value</span>
                      )}
                    </TD>
                    <TD>
                      {r.env_kind ? (
                        <Badge tone={envTone(r.env_kind)}>{r.env_kind}</Badge>
                      ) : (
                        <span className="text-zinc-600">-</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-zinc-300">{(r.hit_count || 0).toLocaleString()}</TD>
                    <TD>
                      <button onClick={() => toggleActive(r)} className="cursor-pointer" title="Toggle active">
                        <Badge tone={r.is_active ? 'success' : 'default'}>{r.is_active ? 'active' : 'paused'}</Badge>
                      </button>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-red-300 hover:text-red-200"
                          onClick={() => removeRule(r)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit tag rule' : 'New tag rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitForm} disabled={saving}>
              {saving ? <Spinner /> : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-300">{formError}</div>}
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Staging by env tag"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tag key">
              <input
                value={form.tag_key}
                onChange={(e) => setForm((f) => ({ ...f, tag_key: e.target.value }))}
                placeholder="e.g. environment"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-yellow-300"
              />
            </Field>
            <Field label="Tag value (optional)">
              <input
                value={form.tag_value}
                onChange={(e) => setForm((f) => ({ ...f, tag_value: e.target.value }))}
                placeholder="blank = match any value"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 items-end gap-4">
            <Field label="Env kind">
              <select
                value={form.env_kind}
                onChange={(e) => setForm((f) => ({ ...f, env_kind: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                {ENV_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority (lower wins)">
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 accent-yellow-400"
            />
            Active
          </label>
        </div>
      </Modal>
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
