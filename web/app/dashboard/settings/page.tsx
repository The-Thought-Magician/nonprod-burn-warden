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

const WS_KEY = 'nbw_workspace_id'

type Workspace = {
  id: string
  name: string
  slug?: string
  owner_id?: string | null
  currency?: string | null
  role?: string | null
  created_at?: string | null
}

type Member = {
  id: string
  workspace_id: string
  user_id: string
  role?: string | null
  created_at?: string | null
}

type Plan = { id: string; name?: string | null; price_cents?: number | null }
type Subscription = {
  id?: string
  user_id?: string
  plan_id?: string
  status?: string | null
  current_period_end?: string | null
}
type BillingPlan = {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function roleTone(role?: string | null): 'success' | 'info' | 'default' {
  const r = (role || '').toLowerCase()
  if (r === 'owner') return 'success'
  if (r === 'admin') return 'info'
  return 'default'
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY']

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  // workspace edit form
  const [wsForm, setWsForm] = useState({ name: '', currency: 'USD' })
  const [savingWs, setSavingWs] = useState(false)

  // create workspace modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', slug: '', currency: 'USD' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // add member modal
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'member' })
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // billing actions
  const [billingBusy, setBillingBusy] = useState<'checkout' | 'portal' | null>(null)
  const [resetting, setResetting] = useState(false)

  const current = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  )
  const isOwner = (current?.role || '').toLowerCase() === 'owner'

  const loadWorkspaceScoped = useCallback(async (wsId: string) => {
    const [mem, bill] = await Promise.all([
      api.getWorkspaceMembers(wsId).catch(() => []),
      api.getBillingPlan().catch(() => null),
    ])
    setMembers(Array.isArray(mem) ? mem : [])
    setBilling(bill)
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ws: Workspace[] = await api.getWorkspaces()
      const list = Array.isArray(ws) ? ws : []
      setWorkspaces(list)
      if (list.length === 0) {
        setWorkspaceId(null)
        setLoading(false)
        return
      }
      const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
      const active = list.find((w) => w.id === stored)?.id ?? list[0].id
      setWorkspaceId(active)
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, active)
      const cur = list.find((w) => w.id === active)
      setWsForm({ name: cur?.name ?? '', currency: cur?.currency ?? 'USD' })
      await loadWorkspaceScoped(active)
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings.')
    } finally {
      setLoading(false)
    }
  }, [loadWorkspaceScoped])

  useEffect(() => {
    init()
  }, [init])

  const switchWorkspace = useCallback(
    async (id: string) => {
      setWorkspaceId(id)
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, id)
      const cur = workspaces.find((w) => w.id === id)
      setWsForm({ name: cur?.name ?? '', currency: cur?.currency ?? 'USD' })
      setNotice(null)
      setError(null)
      try {
        await loadWorkspaceScoped(id)
      } catch (e: any) {
        setError(e?.message || 'Failed to load workspace.')
      }
    },
    [workspaces, loadWorkspaceScoped],
  )

  const onSaveWorkspace = useCallback(async () => {
    if (!workspaceId) return
    const name = wsForm.name.trim()
    if (!name) {
      setError('Workspace name cannot be empty.')
      return
    }
    setSavingWs(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await api.updateWorkspace(workspaceId, {
        name,
        currency: wsForm.currency,
      })
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === workspaceId ? { ...w, name, currency: wsForm.currency, ...updated } : w)),
      )
      setNotice('Workspace settings saved.')
    } catch (e: any) {
      setError(e?.message || 'Failed to save workspace.')
    } finally {
      setSavingWs(false)
    }
  }, [workspaceId, wsForm])

  const onCreateWorkspace = useCallback(async () => {
    const name = createForm.name.trim()
    if (!name) {
      setCreateError('Workspace name is required.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const body: Record<string, unknown> = { name, currency: createForm.currency }
      const slug = createForm.slug.trim()
      if (slug) body.slug = slug
      const ws: Workspace = await api.createWorkspace(body)
      setCreateOpen(false)
      setCreateForm({ name: '', slug: '', currency: 'USD' })
      setNotice(`Created workspace "${name}".`)
      await init()
      if (ws?.id) await switchWorkspace(ws.id)
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create workspace.')
    } finally {
      setCreating(false)
    }
  }, [createForm, init, switchWorkspace])

  const onAddMember = useCallback(async () => {
    if (!workspaceId) return
    const userId = memberForm.user_id.trim()
    if (!userId) {
      setMemberError('A user ID is required.')
      return
    }
    setAddingMember(true)
    setMemberError(null)
    setNotice(null)
    try {
      await api.addWorkspaceMember(workspaceId, { user_id: userId, role: memberForm.role })
      setMemberOpen(false)
      setMemberForm({ user_id: '', role: 'member' })
      setNotice('Member added.')
      const mem = await api.getWorkspaceMembers(workspaceId)
      setMembers(Array.isArray(mem) ? mem : [])
    } catch (e: any) {
      setMemberError(e?.message || 'Failed to add member.')
    } finally {
      setAddingMember(false)
    }
  }, [workspaceId, memberForm])

  const onRemoveMember = useCallback(
    async (m: Member) => {
      if (!workspaceId) return
      if (typeof window !== 'undefined' && !window.confirm(`Remove member "${m.user_id}" from this workspace?`)) {
        return
      }
      setRemovingId(m.id)
      setError(null)
      setNotice(null)
      try {
        await api.removeWorkspaceMember(workspaceId, m.id)
        setNotice('Member removed.')
        setMembers((prev) => prev.filter((x) => x.id !== m.id))
      } catch (e: any) {
        setError(e?.message || 'Failed to remove member.')
      } finally {
        setRemovingId(null)
      }
    },
    [workspaceId],
  )

  const onCheckout = useCallback(async () => {
    setBillingBusy('checkout')
    setError(null)
    setNotice(null)
    try {
      const res = await api.createCheckout()
      if (res?.url && typeof window !== 'undefined') {
        window.location.href = res.url
      } else {
        setNotice('Checkout session created.')
      }
    } catch (e: any) {
      const msg = e?.message || 'Checkout failed.'
      if (/503/.test(msg) || /not.*configured|unconfigured|disabled/i.test(msg)) {
        setError('Billing is not configured on this deployment. Stripe is optional and all features remain free.')
      } else {
        setError(msg)
      }
    } finally {
      setBillingBusy(null)
    }
  }, [])

  const onPortal = useCallback(async () => {
    setBillingBusy('portal')
    setError(null)
    setNotice(null)
    try {
      const res = await api.createPortal()
      if (res?.url && typeof window !== 'undefined') {
        window.location.href = res.url
      } else {
        setNotice('Billing portal session created.')
      }
    } catch (e: any) {
      const msg = e?.message || 'Could not open billing portal.'
      if (/503/.test(msg) || /not.*configured|unconfigured|disabled/i.test(msg)) {
        setError('Billing is not configured on this deployment. Stripe is optional and all features remain free.')
      } else {
        setError(msg)
      }
    } finally {
      setBillingBusy(null)
    }
  }, [])

  const onResetSample = useCallback(async () => {
    if (!workspaceId) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Reset sample data for this workspace? This deletes and regenerates all demo accounts, resources, usage, costs and findings.',
      )
    ) {
      return
    }
    setResetting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.resetSample({ workspace_id: workspaceId })
      const counts = res?.counts ? Object.values(res.counts).reduce((a: number, b: any) => a + Number(b || 0), 0) : null
      setNotice(counts != null ? `Sample data regenerated (${counts} records).` : 'Sample data regenerated.')
      await loadWorkspaceScoped(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to reset sample data.')
    } finally {
      setResetting(false)
    }
  }, [workspaceId, loadWorkspaceScoped])

  if (loading) return <PageSpinner label="Loading settings..." />

  if (workspaces.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspaces yet"
          description="Create your first workspace to configure settings, members and billing."
          action={<Button onClick={() => setCreateOpen(true)}>Create workspace</Button>}
        />
        <Modal
          open={createOpen}
          onClose={() => !creating && setCreateOpen(false)}
          title="Create workspace"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={onCreateWorkspace} disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {createError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {createError}
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Slug (optional)</span>
              <input
                value={createForm.slug}
                onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="auto-generated if blank"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Currency</span>
              <select
                value={createForm.currency}
                onChange={(e) => setCreateForm((f) => ({ ...f, currency: e.target.value }))}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Modal>
      </div>
    )
  }

  const stripeEnabled = !!billing?.stripeEnabled
  const planName = billing?.plan?.name ?? billing?.subscription?.plan_id ?? 'Free'
  const planPrice = billing?.plan?.price_cents ?? 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage workspace details, members, billing and demo data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={workspaceId ?? ''}
              onChange={(e) => switchWorkspace(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            New workspace
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Members" value={members.length.toLocaleString()} />
        <Stat label="Your role" value={current?.role ?? 'member'} tone="warning" />
        <Stat label="Plan" value={planName} sub={planPrice > 0 ? `${dollars(planPrice)} / mo` : 'All features free'} />
      </div>

      {/* Workspace details */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Workspace details</h3>
          {!isOwner && <Badge tone="default">read-only · owner can edit</Badge>}
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
              <input
                value={wsForm.name}
                onChange={(e) => setWsForm((f) => ({ ...f, name: e.target.value }))}
                disabled={!isOwner}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Currency</span>
              <select
                value={wsForm.currency}
                onChange={(e) => setWsForm((f) => ({ ...f, currency: e.target.value }))}
                disabled={!isOwner}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Slug</span>
              <input
                value={current?.slug ?? ''}
                disabled
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace ID</span>
              <input
                value={current?.id ?? ''}
                disabled
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-500"
              />
            </label>
          </div>
          {isOwner && (
            <div className="mt-4 flex justify-end">
              <Button onClick={onSaveWorkspace} disabled={savingWs}>
                {savingWs ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Members</h3>
          {isOwner && <Button onClick={() => setMemberOpen(true)}>Add member</Button>}
        </CardHeader>
        <CardBody className="p-0">
          {members.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<span>👥</span>}
                title="No members listed"
                description={isOwner ? 'Add a teammate by their user ID.' : 'Only the owner can manage members.'}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User ID</TH>
                  <TH>Role</TH>
                  <TH>Since</TH>
                  {isOwner && <TH className="text-right">Actions</TH>}
                </TR>
              </THead>
              <TBody>
                {members.map((m) => (
                  <TR key={m.id}>
                    <TD className="break-all font-mono text-xs text-slate-300">{m.user_id}</TD>
                    <TD>
                      <Badge tone={roleTone(m.role)}>{m.role || 'member'}</Badge>
                    </TD>
                    <TD>{m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}</TD>
                    {isOwner && (
                      <TD className="text-right">
                        <Button
                          variant="danger"
                          onClick={() => onRemoveMember(m)}
                          disabled={removingId === m.id || (m.role || '').toLowerCase() === 'owner'}
                        >
                          {(m.role || '').toLowerCase() === 'owner'
                            ? 'Owner'
                            : removingId === m.id
                              ? 'Removing…'
                              : 'Remove'}
                        </Button>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-slate-200">Billing</h3>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {!stripeEnabled && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
              Stripe billing is not configured on this deployment. NonprodBurnWarden is fully free, every feature is
              available without a paid plan. Checkout and portal actions will return 503 until billing is enabled.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Current plan</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-lg font-semibold text-slate-100">{planName}</span>
                <Badge tone={billing?.subscription?.status === 'active' ? 'success' : 'default'}>
                  {billing?.subscription?.status ?? 'free'}
                </Badge>
              </div>
              {planPrice > 0 && <div className="mt-1 text-xs text-slate-500">{dollars(planPrice)} / month</div>}
              {billing?.subscription?.current_period_end && (
                <div className="mt-1 text-xs text-slate-600">
                  Renews {new Date(billing.subscription.current_period_end).toLocaleDateString()}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onCheckout} disabled={!stripeEnabled || billingBusy != null}>
                {billingBusy === 'checkout' ? 'Opening…' : 'Upgrade to Pro'}
              </Button>
              <Button variant="secondary" onClick={onPortal} disabled={!stripeEnabled || billingBusy != null}>
                {billingBusy === 'portal' ? 'Opening…' : 'Manage billing'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Demo data */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-slate-200">Demo data</h3>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-slate-500">
            Reset this workspace to a fresh deterministic sample. Existing demo accounts, resources, usage, costs,
            idle windows and findings are deleted and regenerated.
          </p>
          <Button variant="danger" onClick={onResetSample} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset sample data'}
          </Button>
        </CardBody>
      </Card>

      {/* Create workspace modal */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Create workspace"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={onCreateWorkspace} disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {createError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {createError}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Slug (optional)</span>
            <input
              value={createForm.slug}
              onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="auto-generated if blank"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Currency</span>
            <select
              value={createForm.currency}
              onChange={(e) => setCreateForm((f) => ({ ...f, currency: e.target.value }))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      {/* Add member modal */}
      <Modal
        open={memberOpen}
        onClose={() => !addingMember && setMemberOpen(false)}
        title="Add member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMemberOpen(false)} disabled={addingMember}>
              Cancel
            </Button>
            <Button onClick={onAddMember} disabled={addingMember}>
              {addingMember ? 'Adding…' : 'Add member'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {memberError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {memberError}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">User ID</span>
            <input
              value={memberForm.user_id}
              onChange={(e) => setMemberForm((f) => ({ ...f, user_id: e.target.value }))}
              placeholder="The teammate's user ID"
              autoFocus
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Role</span>
            <select
              value={memberForm.role}
              onChange={(e) => setMemberForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}
