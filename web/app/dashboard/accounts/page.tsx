'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type CloudAccount = {
  id: string
  workspace_id: string
  provider: string
  account_ref: string
  nickname?: string | null
  default_region?: string | null
  created_by?: string | null
  created_at?: string | null
  resource_count?: number | null
  monthly_cost_cents?: number | null
}

type EnvBreakdownRow = {
  environment_id?: string | null
  name?: string | null
  env_kind?: string | null
  resource_count?: number | null
  monthly_cost_cents?: number | null
}

type AccountDetail = CloudAccount & {
  env_breakdown?: EnvBreakdownRow[]
}

const PROVIDERS = ['aws', 'gcp', 'azure', 'other']

const PROVIDER_TONE: Record<string, 'warning' | 'info' | 'success' | 'default'> = {
  aws: 'warning',
  gcp: 'info',
  azure: 'success',
  other: 'default',
}

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function envTone(kind?: string | null): 'success' | 'warning' | 'info' | 'default' {
  switch ((kind || '').toLowerCase()) {
    case 'prod':
    case 'production':
      return 'success'
    case 'staging':
    case 'stage':
      return 'info'
    case 'dev':
    case 'development':
    case 'test':
    case 'qa':
    case 'sandbox':
    case 'preview':
      return 'warning'
    default:
      return 'default'
  }
}

type FormState = {
  provider: string
  account_ref: string
  nickname: string
  default_region: string
}

const emptyForm: FormState = { provider: 'aws', account_ref: '', nickname: '', default_region: '' }

export default function CloudAccountsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<CloudAccount[]>([])
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState<string>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CloudAccount | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

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
    const res = await api.getCloudAccounts(wsId)
    setAccounts(Array.isArray(res) ? res : [])
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
        if (active) setError(e?.message || 'Failed to load cloud accounts.')
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
      setError(e?.message || 'Failed to reload cloud accounts.')
    }
  }, [workspaceId, loadData])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((acct: CloudAccount) => {
    setEditing(acct)
    setForm({
      provider: acct.provider ?? 'aws',
      account_ref: acct.account_ref ?? '',
      nickname: acct.nickname ?? '',
      default_region: acct.default_region ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }, [])

  const onSubmit = useCallback(async () => {
    if (!workspaceId) return
    const accountRef = form.account_ref.trim()
    if (!editing && !accountRef) {
      setFormError('Account reference (account id / project id) is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      if (editing) {
        // Backend update only changes nickname/region.
        await api.updateCloudAccount(editing.id, {
          nickname: form.nickname.trim() || null,
          default_region: form.default_region.trim() || null,
        })
        setNotice(`Updated account "${form.nickname.trim() || accountRef}".`)
      } else {
        await api.createCloudAccount({
          workspace_id: workspaceId,
          provider: form.provider,
          account_ref: accountRef,
          nickname: form.nickname.trim() || null,
          default_region: form.default_region.trim() || null,
        })
        setNotice(`Connected ${form.provider.toUpperCase()} account "${form.nickname.trim() || accountRef}".`)
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
    async (acct: CloudAccount) => {
      if (!workspaceId) return
      const label = acct.nickname || acct.account_ref
      if (
        typeof window !== 'undefined' &&
        !window.confirm(`Delete cloud account "${label}"? Resources tied to it may be affected.`)
      ) {
        return
      }
      setDeletingId(acct.id)
      setError(null)
      setNotice(null)
      try {
        await api.deleteCloudAccount(acct.id)
        setNotice(`Deleted account "${label}".`)
        await loadData(workspaceId)
      } catch (e: any) {
        setError(e?.message || 'Delete failed.')
      } finally {
        setDeletingId(null)
      }
    },
    [workspaceId, loadData],
  )

  const openDetail = useCallback(async (acct: CloudAccount) => {
    setDetailOpen(true)
    setDetail({ ...acct })
    setDetailError(null)
    setDetailLoading(true)
    try {
      const res = await api.getCloudAccount(acct.id)
      setDetail(res || acct)
    } catch (e: any) {
      setDetailError(e?.message || 'Failed to load account breakdown.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const providers = useMemo(() => {
    const set = new Set<string>()
    accounts.forEach((a) => a.provider && set.add(a.provider))
    return Array.from(set).sort()
  }, [accounts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = accounts
    if (providerFilter !== 'all') rows = rows.filter((a) => a.provider === providerFilter)
    if (q) {
      rows = rows.filter((a) =>
        [a.nickname, a.account_ref, a.provider, a.default_region]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }
    return [...rows].sort((a, b) => (b.monthly_cost_cents ?? 0) - (a.monthly_cost_cents ?? 0))
  }, [accounts, search, providerFilter])

  const totalSpend = useMemo(
    () => accounts.reduce((s, a) => s + (a.monthly_cost_cents ?? 0), 0),
    [accounts],
  )
  const totalResources = useMemo(
    () => accounts.reduce((s, a) => s + (a.resource_count ?? 0), 0),
    [accounts],
  )
  const maxSpend = accounts.reduce((m, a) => Math.max(m, a.monthly_cost_cents ?? 0), 0) || 1

  const detailEnvMax = useMemo(() => {
    const rows = detail?.env_breakdown ?? []
    return rows.reduce((m, r) => Math.max(m, r.monthly_cost_cents ?? 0), 0) || 1
  }, [detail])

  if (loading) return <PageSpinner label="Loading cloud accounts..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before connecting cloud accounts."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Cloud Accounts</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Connect AWS, GCP and Azure accounts. Each account rolls up its resource count, monthly spend and per
            environment breakdown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={openCreate}>Connect account</Button>
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
        <Stat label="Connected accounts" value={accounts.length.toLocaleString()} />
        <Stat label="Total monthly spend" value={dollars(totalSpend)} tone="warning" />
        <Stat label="Tracked resources" value={totalResources.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">All accounts</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
            >
              <option value="all">All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts…"
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={accounts.length === 0 ? 'No cloud accounts yet' : 'No matching accounts'}
                description={
                  accounts.length === 0
                    ? 'Connect your first cloud account to begin tracking nonprod spend and idle waste.'
                    : 'Try a different search term or provider filter.'
                }
                action={
                  accounts.length === 0 ? <Button onClick={openCreate}>Connect account</Button> : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Provider</TH>
                  <TH>Region</TH>
                  <TH className="text-right">Resources</TH>
                  <TH className="w-1/4">Monthly spend</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <button
                        onClick={() => openDetail(a)}
                        className="text-left font-medium text-zinc-100 hover:text-yellow-300 hover:underline"
                      >
                        {a.nickname || a.account_ref}
                      </button>
                      {a.nickname && (
                        <div className="font-mono text-xs text-zinc-600">{a.account_ref}</div>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={PROVIDER_TONE[a.provider] ?? 'default'}>
                        {(a.provider || 'other').toUpperCase()}
                      </Badge>
                    </TD>
                    <TD>{a.default_region || <span className="text-zinc-600">—</span>}</TD>
                    <TD className="text-right tabular-nums">{(a.resource_count ?? 0).toLocaleString()}</TD>
                    <TD>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="tabular-nums font-medium text-yellow-300">
                          {dollars(a.monthly_cost_cents)}
                        </span>
                        {totalSpend > 0 && (
                          <Badge tone="default">
                            {Math.round(((a.monthly_cost_cents ?? 0) / totalSpend) * 100)}%
                          </Badge>
                        )}
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-yellow-400"
                          style={{ width: `${Math.max(2, ((a.monthly_cost_cents ?? 0) / maxSpend) * 100)}%` }}
                        />
                      </div>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openDetail(a)}>
                          Breakdown
                        </Button>
                        <Button variant="ghost" onClick={() => openEdit(a)}>
                          Edit
                        </Button>
                        <Button variant="danger" onClick={() => onDelete(a)} disabled={deletingId === a.id}>
                          {deletingId === a.id ? 'Deleting…' : 'Delete'}
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
        title={editing ? 'Edit cloud account' : 'Connect cloud account'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Connect account'}
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
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Provider</span>
            <select
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              disabled={!!editing}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none disabled:opacity-50"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
            {editing && <span className="text-xs text-zinc-600">Provider cannot be changed after connecting.</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Account reference
            </span>
            <input
              value={form.account_ref}
              onChange={(e) => setForm((f) => ({ ...f, account_ref: e.target.value }))}
              placeholder="e.g. 123456789012 or my-gcp-project"
              autoFocus
              disabled={!!editing}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none disabled:opacity-50"
            />
            <span className="text-xs text-zinc-600">
              {editing
                ? 'The account id / project id is fixed once connected.'
                : 'AWS account id, GCP project id, or Azure subscription id.'}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Nickname</span>
            <input
              value={form.nickname}
              onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
              placeholder="e.g. Dev Sandbox"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Default region</span>
            <input
              value={form.default_region}
              onChange={(e) => setForm((f) => ({ ...f, default_region: e.target.value }))}
              placeholder="e.g. us-east-1"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail ? detail.nickname || detail.account_ref : 'Account breakdown'}
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setDetailOpen(false)}>
            Close
          </Button>
        }
      >
        {detailError && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {detailError}
          </div>
        )}
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={PROVIDER_TONE[detail.provider] ?? 'default'}>
                {(detail.provider || 'other').toUpperCase()}
              </Badge>
              <span className="font-mono text-zinc-400">{detail.account_ref}</span>
              {detail.default_region && <Badge tone="default">{detail.default_region}</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Resources" value={(detail.resource_count ?? 0).toLocaleString()} />
              <Stat label="Monthly spend" value={dollars(detail.monthly_cost_cents)} tone="warning" />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Environment breakdown
              </h4>
              {detailLoading ? (
                <div className="py-6">
                  <Spinner label="Loading breakdown…" />
                </div>
              ) : (detail.env_breakdown ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
                  No environment-attributed spend yet for this account.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {(detail.env_breakdown ?? []).map((row, i) => (
                    <div key={row.environment_id ?? `env-${i}`}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <Badge tone={envTone(row.env_kind)}>{row.env_kind || 'unknown'}</Badge>
                          <span className="text-zinc-200">{row.name || 'Unassigned'}</span>
                          <span className="text-xs text-zinc-600">
                            {(row.resource_count ?? 0).toLocaleString()} res
                          </span>
                        </span>
                        <span className="tabular-nums font-medium text-yellow-300">
                          {dollars(row.monthly_cost_cents)}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-yellow-400"
                          style={{
                            width: `${Math.max(2, ((row.monthly_cost_cents ?? 0) / detailEnvMax) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
