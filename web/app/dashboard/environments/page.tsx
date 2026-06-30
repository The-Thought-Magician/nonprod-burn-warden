'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const ACTIVE_WS_KEY = 'nbw_active_workspace'

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface Workspace {
  id: string
  name: string
}

interface Environment {
  id: string
  name: string
  env_kind: string
  timezone?: string | null
  is_production?: boolean
  resource_count?: number
  monthly_cost_cents?: number
  idle_waste_cents?: number
}

interface LedgerEnvRow {
  environment_id: string
  name: string
  wasted_cents: number
}

const ENV_KINDS = ['dev', 'staging', 'preview', 'sandbox', 'qa', 'test', 'production']

function envTone(kind: string, isProd?: boolean): 'warning' | 'info' | 'default' | 'success' {
  if (isProd) return 'success'
  switch ((kind || '').toLowerCase()) {
    case 'dev':
      return 'info'
    case 'staging':
    case 'qa':
    case 'test':
      return 'warning'
    case 'production':
      return 'success'
    default:
      return 'default'
  }
}

type SortKey = 'name' | 'monthly_cost_cents' | 'idle_waste_cents' | 'resource_count'

export default function EnvironmentsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [ledgerByEnv, setLedgerByEnv] = useState<Record<string, number>>({})

  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('idle_waste_cents')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    name: '',
    env_kind: 'dev',
    timezone: 'UTC',
    is_production: false,
    description: '',
  })

  const loadData = useCallback(async (wsId: string) => {
    const [envs, ledger] = await Promise.all([
      api.getEnvironments(wsId) as Promise<Environment[]>,
      api.getLedgerByEnvironment(wsId).catch(() => []) as Promise<LedgerEnvRow[]>,
    ])
    setEnvironments(Array.isArray(envs) ? envs : [])
    const map: Record<string, number> = {}
    if (Array.isArray(ledger)) {
      for (const row of ledger) map[row.environment_id] = row.wasted_cents ?? 0
    }
    setLedgerByEnv(map)
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const ws: Workspace[] = await api.getWorkspaces()
      if (!ws || ws.length === 0) {
        setNoWorkspace(true)
        setLoading(false)
        return
      }
      const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_WS_KEY) : null
      const active = ws.find((w) => w.id === stored)?.id ?? ws[0].id
      setWorkspaceId(active)
      if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_WS_KEY, active)
      await loadData(active)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load environments')
    } finally {
      setLoading(false)
    }
  }, [loadData])

  useEffect(() => {
    init()
  }, [init])

  const openCreate = () => {
    setForm({ name: '', env_kind: 'dev', timezone: 'UTC', is_production: false, description: '' })
    setFormError('')
    setModalOpen(true)
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await api.createEnvironment({
        workspace_id: workspaceId,
        name: form.name.trim(),
        env_kind: form.env_kind,
        timezone: form.timezone.trim() || 'UTC',
        is_production: form.is_production,
        description: form.description.trim() || undefined,
      })
      setModalOpen(false)
      await loadData(workspaceId)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create environment')
    } finally {
      setSaving(false)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const wasteFor = useCallback(
    (env: Environment) => env.idle_waste_cents ?? ledgerByEnv[env.id] ?? 0,
    [ledgerByEnv],
  )

  const filtered = useMemo(() => {
    let rows = environments
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((e) => e.name.toLowerCase().includes(q))
    }
    if (kindFilter !== 'all') {
      rows = rows.filter((e) => (e.env_kind || '').toLowerCase() === kindFilter)
    }
    const sorted = [...rows].sort((a, b) => {
      let av: number | string
      let bv: number | string
      if (sortKey === 'name') {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      } else if (sortKey === 'idle_waste_cents') {
        av = wasteFor(a)
        bv = wasteFor(b)
      } else {
        av = (a[sortKey] as number) ?? 0
        bv = (b[sortKey] as number) ?? 0
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [environments, search, kindFilter, sortKey, sortDir, wasteFor])

  const totals = useMemo(() => {
    return environments.reduce(
      (acc, e) => {
        acc.cost += e.monthly_cost_cents ?? 0
        acc.waste += wasteFor(e)
        acc.resources += e.resource_count ?? 0
        return acc
      },
      { cost: 0, waste: 0, resources: 0 },
    )
  }, [environments, wasteFor])

  if (loading) return <PageSpinner label="Loading environments..." />

  if (noWorkspace) {
    return (
      <EmptyState
        icon="🔥"
        title="No workspace found"
        description="Create or seed a workspace from the Overview page before managing environments."
        action={
          <Link href="/dashboard">
            <Button>Go to overview</Button>
          </Link>
        }
      />
    )
  }

  const SortArrow = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span className="text-yellow-400">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span> : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Environments</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cost and idle-waste per environment. Group resources into dev, staging, preview, and more.
          </p>
        </div>
        <Button onClick={openCreate}>+ New environment</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Stat label="Environments" value={environments.length} />
        <Stat label="Total monthly cost" value={fmtMoney(totals.cost)} />
        <Stat label="Total idle waste" value={fmtMoney(totals.waste)} tone="danger" />
        <Stat label="Resources" value={totals.resources} />
      </div>

      {environments.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="No environments yet"
          description="Create your first environment, or seed sample data from the Overview page to populate environments automatically."
          action={<Button onClick={openCreate}>+ New environment</Button>}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search environments..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-yellow-500 focus:outline-none"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
            >
              <option value="all">All kinds</option>
              {ENV_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-500">
              {filtered.length} of {environments.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No matches" description="No environments match your search or filter." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    Name <SortArrow k="name" />
                  </TH>
                  <TH>Kind</TH>
                  <TH>Timezone</TH>
                  <TH
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('resource_count')}
                  >
                    Resources <SortArrow k="resource_count" />
                  </TH>
                  <TH
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('monthly_cost_cents')}
                  >
                    Monthly cost <SortArrow k="monthly_cost_cents" />
                  </TH>
                  <TH
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('idle_waste_cents')}
                  >
                    Idle waste <SortArrow k="idle_waste_cents" />
                  </TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((env) => (
                  <TR key={env.id}>
                    <TD>
                      <Link
                        href={`/dashboard/environments/${env.id}`}
                        className="font-medium text-zinc-100 hover:text-yellow-300"
                      >
                        {env.name}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={envTone(env.env_kind, env.is_production)}>
                        {env.is_production ? 'production' : env.env_kind}
                      </Badge>
                    </TD>
                    <TD className="text-zinc-400">{env.timezone || '—'}</TD>
                    <TD className="text-right tabular-nums">{env.resource_count ?? 0}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(env.monthly_cost_cents)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-red-300">
                      {fmtMoney(wasteFor(env))}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      {/* Create modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New environment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} type="button">
              Cancel
            </Button>
            <Button type="submit" form="env-create-form" disabled={saving}>
              {saving ? 'Creating...' : 'Create environment'}
            </Button>
          </>
        }
      >
        <form id="env-create-form" onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-2.5 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
              placeholder="e.g. dev-eu-west"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Kind</label>
              <select
                value={form.env_kind}
                onChange={(e) => setForm({ ...form, env_kind: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-yellow-500 focus:outline-none"
              >
                {ENV_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Timezone</label>
              <input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="UTC"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-yellow-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Description (optional)</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What runs here?"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.is_production}
              onChange={(e) => setForm({ ...form, is_production: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-yellow-400"
            />
            Production environment (excluded from idle-waste recovery)
          </label>
        </form>
      </Modal>
    </div>
  )
}
