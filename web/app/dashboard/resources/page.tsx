'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const ENV_KINDS = ['dev', 'staging', 'qa', 'sandbox', 'preview', 'prod']
const PROVIDERS = ['aws', 'gcp', 'azure', 'other']

function dollars(cents?: number | null): string {
  const c = typeof cents === 'number' ? cents : 0
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function envTone(kind?: string): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  if (kind === 'prod') return 'danger'
  if (kind === 'staging' || kind === 'qa') return 'warning'
  if (kind === 'preview' || kind === 'sandbox') return 'info'
  if (kind === 'dev') return 'success'
  return 'default'
}

export default function ResourcesPage() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [resources, setResources] = useState<any[]>([])
  const [environments, setEnvironments] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])

  // filters
  const [search, setSearch] = useState('')
  const [filterEnvKind, setFilterEnvKind] = useState('')
  const [filterEnvId, setFilterEnvId] = useState('')
  const [filterTeamId, setFilterTeamId] = useState('')

  // selection for bulk classify
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState({
    external_id: '',
    name: '',
    resource_type: '',
    service: '',
    region: '',
    provider: 'aws',
    env_kind: '',
    environment_id: '',
    team_id: '',
    monthly_cost_cents: '',
  })

  // classify modal (single or bulk)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const [classifyTargets, setClassifyTargets] = useState<string[]>([])
  const [classifyForm, setClassifyForm] = useState({ env_kind: '', environment_id: '', team_id: '' })
  const [classifying, setClassifying] = useState(false)

  const fetchResources = useCallback(
    async (wsId: string) => {
      const query: Record<string, string> = { workspace_id: wsId }
      if (filterEnvKind) query.env_kind = filterEnvKind
      if (filterEnvId) query.environment_id = filterEnvId
      if (filterTeamId) query.team_id = filterTeamId
      const res = await api.getResources(query)
      setResources(Array.isArray(res) ? res : [])
    },
    [filterEnvKind, filterEnvId, filterTeamId],
  )

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const ws = await api.getWorkspaces()
      const wsList = Array.isArray(ws) ? ws : []
      if (wsList.length === 0) {
        setWorkspaceId('')
        setResources([])
        setLoading(false)
        return
      }
      const wsId = wsList[0].id
      setWorkspaceId(wsId)
      const [, envs, tms] = await Promise.all([
        fetchResources(wsId),
        api.getEnvironments(wsId),
        api.getTeams(wsId),
      ])
      setEnvironments(Array.isArray(envs) ? envs : [])
      setTeams(Array.isArray(tms) ? tms : [])
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load resources')
    } finally {
      setLoading(false)
    }
  }, [fetchResources])

  // initial load
  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // refetch resources when server-side filters change (after initial workspace resolved)
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      try {
        await fetchResources(workspaceId)
        if (active) setSelected(new Set())
      } catch (err: any) {
        if (active) setError(err?.message ?? 'Failed to load resources')
      }
    })()
    return () => {
      active = false
    }
  }, [workspaceId, filterEnvKind, filterEnvId, filterTeamId, fetchResources])

  const envName = useCallback(
    (envId?: string | null) => environments.find((e) => e.id === envId)?.name ?? '—',
    [environments],
  )
  const teamName = useCallback(
    (tId?: string | null) => teams.find((t) => t.id === tId)?.name ?? '—',
    [teams],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return resources
    return resources.filter(
      (r) =>
        (r.name ?? '').toLowerCase().includes(q) ||
        (r.external_id ?? '').toLowerCase().includes(q) ||
        (r.service ?? '').toLowerCase().includes(q) ||
        (r.resource_type ?? '').toLowerCase().includes(q) ||
        (r.region ?? '').toLowerCase().includes(q),
    )
  }, [resources, search])

  const totalMonthly = useMemo(
    () => visible.reduce((s, r) => s + (r.monthly_cost_cents ?? 0), 0),
    [visible],
  )

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (prev.size === visible.length) return new Set()
      return new Set(visible.map((r) => r.id))
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setCreating(true)
    setError('')
    try {
      const body: any = {
        workspace_id: workspaceId,
        external_id: createForm.external_id,
        name: createForm.name,
        resource_type: createForm.resource_type || null,
        service: createForm.service || null,
        region: createForm.region || null,
        provider: createForm.provider,
        env_kind: createForm.env_kind || null,
        environment_id: createForm.environment_id || null,
        team_id: createForm.team_id || null,
      }
      const cost = createForm.monthly_cost_cents.trim()
      if (cost !== '') body.monthly_cost_cents = Math.round(parseFloat(cost) * 100)
      await api.createResource(body)
      setCreateOpen(false)
      setCreateForm({
        external_id: '',
        name: '',
        resource_type: '',
        service: '',
        region: '',
        provider: 'aws',
        env_kind: '',
        environment_id: '',
        team_id: '',
        monthly_cost_cents: '',
      })
      await fetchResources(workspaceId)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create resource')
    } finally {
      setCreating(false)
    }
  }

  function openClassifySingle(r: any) {
    setClassifyTargets([r.id])
    setClassifyForm({
      env_kind: r.env_kind ?? '',
      environment_id: r.environment_id ?? '',
      team_id: r.team_id ?? '',
    })
    setClassifyOpen(true)
  }

  function openClassifyBulk() {
    if (selected.size === 0) return
    setClassifyTargets([...selected])
    setClassifyForm({ env_kind: '', environment_id: '', team_id: '' })
    setClassifyOpen(true)
  }

  async function handleClassify(e: React.FormEvent) {
    e.preventDefault()
    if (classifyTargets.length === 0) return
    setClassifying(true)
    setError('')
    try {
      const body: any = { classification_source: 'manual' }
      // Only send fields that the user set (empty string = leave unchanged for bulk)
      if (classifyForm.env_kind) body.env_kind = classifyForm.env_kind
      if (classifyForm.environment_id) body.environment_id = classifyForm.environment_id
      if (classifyForm.team_id) body.team_id = classifyForm.team_id
      // Sentinels to clear
      if (classifyForm.environment_id === '__clear__') body.environment_id = null
      if (classifyForm.team_id === '__clear__') body.team_id = null

      await Promise.all(classifyTargets.map((id) => api.assignResource(id, body)))
      setClassifyOpen(false)
      setSelected(new Set())
      await fetchResources(workspaceId)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to classify resources')
    } finally {
      setClassifying(false)
    }
  }

  async function handleDelete(r: any) {
    if (!confirm(`Delete resource "${r.name ?? r.external_id}"? This cannot be undone.`)) return
    setError('')
    try {
      await api.deleteResource(r.id)
      await fetchResources(workspaceId)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(r.id)
        return next
      })
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete resource')
    }
  }

  if (loading) return <PageSpinner label="Loading resources..." />

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Create a workspace and seed sample data to start cataloging resources."
        action={
          <Link href="/dashboard">
            <Button>Go to dashboard</Button>
          </Link>
        }
      />
    )
  }

  const allSelected = visible.length > 0 && selected.size === visible.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Resource Inventory</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {visible.length} resource{visible.length === 1 ? '' : 's'} · {dollars(totalMonthly)}/mo
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" onClick={openClassifyBulk}>
              Classify {selected.size} selected
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>+ Add resource</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
      )}

      {/* Filters */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Search
              </label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="name, id, service, region..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Env kind
              </label>
              <select
                value={filterEnvKind}
                onChange={(e) => setFilterEnvKind(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">All kinds</option>
                {ENV_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Environment
              </label>
              <select
                value={filterEnvId}
                onChange={(e) => setFilterEnvId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">All environments</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Team
              </label>
              <select
                value={filterTeamId}
                onChange={(e) => setFilterTeamId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {(search || filterEnvKind || filterEnvId || filterTeamId) && (
            <div className="mt-3">
              <button
                onClick={() => {
                  setSearch('')
                  setFilterEnvKind('')
                  setFilterEnvId('')
                  setFilterTeamId('')
                }}
                className="text-xs text-yellow-400 hover:text-yellow-300"
              >
                Clear filters
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Table */}
      {visible.length === 0 ? (
        <EmptyState
          title="No resources match"
          description={
            resources.length === 0
              ? 'Add a resource manually or import an inventory CSV.'
              : 'Try clearing filters or adjusting your search.'
          }
          action={<Button onClick={() => setCreateOpen(true)}>+ Add resource</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                  className="h-4 w-4 accent-yellow-400"
                />
              </TH>
              <TH>Resource</TH>
              <TH>Provider</TH>
              <TH>Env Kind</TH>
              <TH>Environment</TH>
              <TH>Team</TH>
              <TH className="text-right">Monthly</TH>
              <TH>Source</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((r) => (
              <TR key={r.id}>
                <TD>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    aria-label={`Select ${r.name}`}
                    className="h-4 w-4 accent-yellow-400"
                  />
                </TD>
                <TD>
                  <Link
                    href={`/dashboard/resources/${r.id}`}
                    className="font-medium text-zinc-100 hover:text-yellow-300"
                  >
                    {r.name ?? r.external_id}
                  </Link>
                  <div className="text-xs text-zinc-500">
                    {[r.service, r.resource_type, r.region].filter(Boolean).join(' · ') || r.external_id}
                  </div>
                </TD>
                <TD className="uppercase">{r.provider ?? '—'}</TD>
                <TD>
                  {r.env_kind ? (
                    <Badge tone={envTone(r.env_kind)}>{r.env_kind}</Badge>
                  ) : (
                    <span className="text-zinc-600">unclassified</span>
                  )}
                </TD>
                <TD>{envName(r.environment_id)}</TD>
                <TD>{teamName(r.team_id)}</TD>
                <TD className="text-right tabular-nums">{dollars(r.monthly_cost_cents)}</TD>
                <TD>
                  {r.classification_source ? (
                    <span className="text-xs text-zinc-400">
                      {r.classification_source}
                      {r.classification_confidence != null && r.classification_source !== 'manual'
                        ? ` ${Math.round(Number(r.classification_confidence) * 100)}%`
                        : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => openClassifySingle(r)}
                      className="rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-yellow-300"
                    >
                      Classify
                    </button>
                    <button
                      onClick={() => handleDelete(r)}
                      className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-red-900/40 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Add resource"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-resource-form" disabled={creating}>
              {creating ? 'Adding...' : 'Add resource'}
            </Button>
          </>
        }
      >
        <form id="create-resource-form" onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">External ID *</label>
              <input
                required
                value={createForm.external_id}
                onChange={(e) => setCreateForm({ ...createForm, external_id: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Name *</label>
              <input
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Provider</label>
              <select
                value={createForm.provider}
                onChange={(e) => setCreateForm({ ...createForm, provider: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Service</label>
              <input
                value={createForm.service}
                onChange={(e) => setCreateForm({ ...createForm, service: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Resource type</label>
              <input
                value={createForm.resource_type}
                onChange={(e) => setCreateForm({ ...createForm, resource_type: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Region</label>
              <input
                value={createForm.region}
                onChange={(e) => setCreateForm({ ...createForm, region: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Env kind</label>
              <select
                value={createForm.env_kind}
                onChange={(e) => setCreateForm({ ...createForm, env_kind: e.target.value })}
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
              <label className="mb-1 block text-xs text-zinc-500">Monthly cost ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={createForm.monthly_cost_cents}
                onChange={(e) => setCreateForm({ ...createForm, monthly_cost_cents: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Environment</label>
              <select
                value={createForm.environment_id}
                onChange={(e) => setCreateForm({ ...createForm, environment_id: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">None</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Team</label>
              <select
                value={createForm.team_id}
                onChange={(e) => setCreateForm({ ...createForm, team_id: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">None</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </form>
      </Modal>

      {/* Classify modal */}
      <Modal
        open={classifyOpen}
        onClose={() => !classifying && setClassifyOpen(false)}
        title={
          classifyTargets.length > 1
            ? `Classify ${classifyTargets.length} resources`
            : 'Manual classification'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setClassifyOpen(false)} disabled={classifying}>
              Cancel
            </Button>
            <Button type="submit" form="classify-form" disabled={classifying}>
              {classifying ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Applying
                </span>
              ) : (
                'Apply'
              )}
            </Button>
          </>
        }
      >
        <form id="classify-form" onSubmit={handleClassify} className="space-y-3">
          {classifyTargets.length > 1 && (
            <p className="text-xs text-zinc-500">
              Leave a field on its default to keep each resource&apos;s current value.
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Env kind</label>
            <select
              value={classifyForm.env_kind}
              onChange={(e) => setClassifyForm({ ...classifyForm, env_kind: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
            >
              <option value="">{classifyTargets.length > 1 ? 'Leave unchanged' : 'Unclassified'}</option>
              {ENV_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Environment</label>
            <select
              value={classifyForm.environment_id}
              onChange={(e) => setClassifyForm({ ...classifyForm, environment_id: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
            >
              <option value="">{classifyTargets.length > 1 ? 'Leave unchanged' : 'None'}</option>
              <option value="__clear__">— clear —</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Team</label>
            <select
              value={classifyForm.team_id}
              onChange={(e) => setClassifyForm({ ...classifyForm, team_id: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
            >
              <option value="">{classifyTargets.length > 1 ? 'Leave unchanged' : 'None'}</option>
              <option value="__clear__">— clear —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  )
}
