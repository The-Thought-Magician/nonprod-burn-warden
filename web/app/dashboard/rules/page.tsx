'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'nbw.workspace_id'

type Workspace = { id: string; name: string; role?: string }

type EnvironmentRule = {
  id: string
  workspace_id: string
  name: string
  env_kind: string | null
  match_type: string
  pattern: string
  priority: number
  is_active: boolean
  hit_count: number
  created_at?: string
}

type MatchedResource = {
  id: string
  name: string
  resource_type?: string
  service?: string
  region?: string
  env_kind?: string | null
  monthly_cost_cents?: number
}

const ENV_KINDS = ['production', 'staging', 'development', 'qa', 'preview', 'sandbox', 'test']
const MATCH_TYPES = ['glob', 'regex', 'prefix', 'suffix', 'contains', 'exact']

type RuleForm = {
  name: string
  env_kind: string
  match_type: string
  pattern: string
  priority: number
  is_active: boolean
}

const emptyForm: RuleForm = {
  name: '',
  env_kind: 'development',
  match_type: 'glob',
  pattern: '',
  priority: 100,
  is_active: true,
}

function envTone(kind: string | null | undefined) {
  if (!kind) return 'default' as const
  if (kind === 'production') return 'danger' as const
  if (kind === 'staging' || kind === 'qa') return 'info' as const
  return 'warning' as const
}

function money(cents?: number) {
  if (cents == null) return '-'
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function RulesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [rules, setRules] = useState<EnvironmentRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<string>('all')

  // modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EnvironmentRule | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // preview state
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<{ matched: MatchedResource[]; count: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLabel, setPreviewLabel] = useState('')

  // apply state
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ classified: number; updated: number; gaps: any } | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  // resolve workspace
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
      const data: EnvironmentRule[] = await api.getEnvironmentRules(wsId)
      setRules(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load rules')
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
        q ? r.name.toLowerCase().includes(q) || r.pattern.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  }, [rules, search, kindFilter])

  const stats = useMemo(() => {
    const active = rules.filter((r) => r.is_active).length
    const totalHits = rules.reduce((s, r) => s + (r.hit_count || 0), 0)
    const kinds = new Set(rules.map((r) => r.env_kind).filter(Boolean)).size
    return { total: rules.length, active, totalHits, kinds }
  }, [rules])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(rule: EnvironmentRule) {
    setEditing(rule)
    setForm({
      name: rule.name,
      env_kind: rule.env_kind || 'development',
      match_type: rule.match_type,
      pattern: rule.pattern,
      priority: rule.priority,
      is_active: rule.is_active,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submitForm() {
    if (!form.name.trim() || !form.pattern.trim()) {
      setFormError('Name and pattern are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      env_kind: form.env_kind,
      match_type: form.match_type,
      pattern: form.pattern.trim(),
      priority: Number(form.priority) || 0,
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api.updateEnvironmentRule(editing.id, body)
      } else {
        await api.createEnvironmentRule(body)
      }
      setModalOpen(false)
      await loadRules(workspaceId)
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rule: EnvironmentRule) {
    try {
      await api.updateEnvironmentRule(rule.id, { is_active: !rule.is_active })
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r)))
    } catch (e: any) {
      setError(e?.message || 'Failed to update rule')
    }
  }

  async function removeRule(rule: EnvironmentRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return
    try {
      await api.deleteEnvironmentRule(rule.id)
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete rule')
    }
  }

  async function previewRule(rule?: EnvironmentRule) {
    setPreviewOpen(true)
    setPreviewing(true)
    setPreviewError(null)
    setPreviewResult(null)
    const body = rule
      ? {
          workspace_id: workspaceId,
          env_kind: rule.env_kind,
          match_type: rule.match_type,
          pattern: rule.pattern,
        }
      : {
          workspace_id: workspaceId,
          env_kind: form.env_kind,
          match_type: form.match_type,
          pattern: form.pattern.trim(),
        }
    setPreviewLabel(rule ? `${rule.match_type}: ${rule.pattern}` : `${form.match_type}: ${form.pattern.trim()}`)
    try {
      const res = await api.previewEnvironmentRule(body)
      setPreviewResult({ matched: res?.matched || [], count: res?.count ?? (res?.matched?.length || 0) })
    } catch (e: any) {
      setPreviewError(e?.message || 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  async function applyAll() {
    setApplying(true)
    setApplyError(null)
    setApplyResult(null)
    try {
      const res = await api.applyEnvironmentRules({ workspace_id: workspaceId })
      setApplyResult({
        classified: res?.classified ?? 0,
        updated: res?.updated ?? 0,
        gaps: res?.gaps ?? null,
      })
      await loadRules(workspaceId)
    } catch (e: any) {
      setApplyError(e?.message || 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  const gapList: { label: string; value: number }[] = useMemo(() => {
    const g = applyResult?.gaps
    if (!g) return []
    if (Array.isArray(g)) {
      return g.map((x: any) =>
        typeof x === 'string'
          ? { label: x, value: 0 }
          : { label: x.label || x.env_kind || x.name || 'Unclassified', value: x.count ?? x.value ?? 0 },
      )
    }
    if (typeof g === 'object') {
      return Object.entries(g).map(([k, v]) => ({ label: k, value: Number(v) || 0 }))
    }
    return []
  }, [applyResult])

  if (loading && !rules.length && !error) return <PageSpinner label="Loading naming rules..." />

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Naming &amp; Pattern Rules</h1>
          <p className="mt-1 text-sm text-slate-500">
            Classify resources into environments by matching names against patterns. Lower priority wins.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => previewRule(undefined)} disabled={!workspaceId}>
            Test pattern
          </Button>
          <Button variant="primary" onClick={openCreate} disabled={!workspaceId}>
            New rule
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!workspaceId && !loading ? (
        <EmptyState
          title="No workspace found"
          description="Create or seed a workspace from the dashboard first, then return to manage classification rules."
        />
      ) : (
        <>
          {/* stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total rules" value={stats.total} />
            <Stat label="Active" value={stats.active} tone="success" />
            <Stat label="Total matches" value={stats.totalHits.toLocaleString()} tone="warning" />
            <Stat label="Env kinds covered" value={stats.kinds} />
          </div>

          {/* apply panel */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Apply rules</h2>
                <p className="text-xs text-slate-500">
                  Run every active rule against the inventory to (re)classify resources and surface coverage gaps.
                </p>
              </div>
              <Button variant="primary" onClick={applyAll} disabled={applying || !rules.length}>
                {applying ? <Spinner /> : 'Apply all rules'}
              </Button>
            </CardHeader>
            {(applyResult || applyError) && (
              <CardBody className="space-y-4">
                {applyError && <div className="text-sm text-red-300">{applyError}</div>}
                {applyResult && (
                  <>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Stat label="Classified" value={applyResult.classified} tone="success" />
                      <Stat label="Updated" value={applyResult.updated} tone="warning" />
                      <Stat label="Coverage gaps" value={gapList.length} tone={gapList.length ? 'danger' : 'default'} />
                    </div>
                    {gapList.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Unclassified / gaps
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {gapList.map((g) => (
                            <Badge key={g.label} tone="danger">
                              {g.label}
                              {g.value ? ` · ${g.value}` : ''}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardBody>
            )}
          </Card>

          {/* filters */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or pattern..."
              className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">All env kinds</option>
              {ENV_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              {filtered.length} of {rules.length} rules
            </span>
          </div>

          {/* table */}
          {rules.length === 0 ? (
            <EmptyState
              title="No rules yet"
              description="Add a naming or pattern rule to start auto-classifying resources into environments."
              action={<Button onClick={openCreate}>New rule</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No rules match your filters" description="Try clearing the search or env-kind filter." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Priority</TH>
                  <TH>Name</TH>
                  <TH>Match</TH>
                  <TH>Pattern</TH>
                  <TH>Env kind</TH>
                  <TH className="text-right">Hits</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="tabular-nums text-slate-400">{r.priority}</TD>
                    <TD className="font-medium text-slate-100">{r.name}</TD>
                    <TD>
                      <Badge tone="info">{r.match_type}</Badge>
                    </TD>
                    <TD>
                      <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-emerald-300">{r.pattern}</code>
                    </TD>
                    <TD>
                      {r.env_kind ? <Badge tone={envTone(r.env_kind)}>{r.env_kind}</Badge> : <span className="text-slate-600">-</span>}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-300">{(r.hit_count || 0).toLocaleString()}</TD>
                    <TD>
                      <button
                        onClick={() => toggleActive(r)}
                        className="cursor-pointer"
                        title="Toggle active"
                      >
                        <Badge tone={r.is_active ? 'success' : 'default'}>{r.is_active ? 'active' : 'paused'}</Badge>
                      </button>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2 py-1" onClick={() => previewRule(r)}>
                          Preview
                        </Button>
                        <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        <Button variant="ghost" className="px-2 py-1 text-red-300 hover:text-red-200" onClick={() => removeRule(r)}>
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

      {/* create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit rule' : 'New naming rule'}
        footer={
          <>
            <Button variant="secondary" onClick={() => previewRule(undefined)} disabled={!form.pattern.trim()}>
              Preview match
            </Button>
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
              placeholder="e.g. Dev clusters by prefix"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Match type">
              <select
                value={form.match_type}
                onChange={(e) => setForm((f) => ({ ...f, match_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {MATCH_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Env kind">
              <select
                value={form.env_kind}
                onChange={(e) => setForm((f) => ({ ...f, env_kind: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {ENV_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Pattern">
            <input
              value={form.pattern}
              onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
              placeholder="e.g. dev-* or .*staging.*"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-emerald-300"
            />
          </Field>
          <div className="grid grid-cols-2 items-end gap-4">
            <Field label="Priority (lower wins)">
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="h-4 w-4 accent-emerald-400"
              />
              Active
            </label>
          </div>
        </div>
      </Modal>

      {/* preview modal */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Pattern preview"
        footer={
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        }
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-400">
            Resources matched by{' '}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-emerald-300">{previewLabel || '—'}</code>
          </div>
          {previewing ? (
            <div className="py-8">
              <Spinner label="Matching resources..." />
            </div>
          ) : previewError ? (
            <div className="text-sm text-red-300">{previewError}</div>
          ) : previewResult && previewResult.count === 0 ? (
            <EmptyState title="No matches" description="This pattern does not match any current resources." />
          ) : previewResult ? (
            <>
              <Badge tone="success">{previewResult.count} matched</Badge>
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Type</TH>
                      <TH>Region</TH>
                      <TH className="text-right">Monthly</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {previewResult.matched.map((m) => (
                      <TR key={m.id}>
                        <TD className="font-medium text-slate-100">{m.name}</TD>
                        <TD className="text-slate-400">{m.resource_type || m.service || '-'}</TD>
                        <TD className="text-slate-400">{m.region || '-'}</TD>
                        <TD className="text-right tabular-nums text-slate-300">{money(m.monthly_cost_cents)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
