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

type Alert = {
  id: string
  workspace_id: string
  alert_rule_id?: string | null
  environment_id?: string | null
  team_id?: string | null
  severity?: string | null
  message?: string | null
  link?: string | null
  status?: string | null
  created_at?: string | null
}

type AlertRule = {
  id: string
  workspace_id: string
  name: string
  rule_type: string
  threshold_cents?: number | null
  severity?: string | null
  is_active?: boolean | null
  created_by?: string | null
  created_at?: string | null
}

const RULE_TYPES = [
  { value: 'env_waste', label: 'Environment waste exceeds threshold' },
  { value: 'budget_breach', label: 'Team over budget' },
  { value: 'orphan_cost', label: 'Orphan cost exceeds threshold' },
  { value: 'idle_spike', label: 'Idle-hours spike' },
  { value: 'total_spend', label: 'Total spend exceeds threshold' },
]

const SEVERITIES = ['info', 'warning', 'critical']

function dollars(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function severityTone(sev?: string | null): 'danger' | 'warning' | 'info' | 'default' {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'danger'
    case 'warning':
    case 'medium':
      return 'warning'
    case 'info':
    case 'low':
      return 'info'
    default:
      return 'default'
  }
}

function statusTone(status?: string | null): 'danger' | 'warning' | 'success' | 'default' {
  switch ((status || '').toLowerCase()) {
    case 'open':
    case 'firing':
    case 'active':
      return 'danger'
    case 'acknowledged':
    case 'ack':
      return 'warning'
    case 'resolved':
    case 'closed':
      return 'success'
    default:
      return 'default'
  }
}

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 3, warning: 2, medium: 2, info: 1, low: 1 }

type RuleForm = {
  name: string
  rule_type: string
  threshold: string
  severity: string
  is_active: boolean
}

const emptyRuleForm: RuleForm = {
  name: '',
  rule_type: 'env_waste',
  threshold: '',
  severity: 'warning',
  is_active: true,
}

export default function AlertsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [severityFilter, setSeverityFilter] = useState<string>('all')

  const [evaluating, setEvaluating] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  // Rule modal.
  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm)
  const [savingRule, setSavingRule] = useState(false)
  const [ruleFormError, setRuleFormError] = useState<string | null>(null)
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nbw_workspace_id') : null
    const workspaces = await api.getWorkspaces().catch(() => [])
    const list: any[] = Array.isArray(workspaces) ? workspaces : []
    if (stored && list.some((w) => w.id === stored)) return stored
    const first = list[0]?.id ?? null
    if (first && typeof window !== 'undefined') localStorage.setItem('nbw_workspace_id', first)
    return first
  }, [])

  const loadData = useCallback(
    async (wsId: string, status: string) => {
      const query: Record<string, string> = { workspace_id: wsId }
      if (status !== 'all') query.status = status
      const [alertsRes, rulesRes] = await Promise.all([
        api.getAlerts(query),
        api.getAlertRules(wsId),
      ])
      setAlerts(Array.isArray(alertsRes) ? alertsRes : [])
      setRules(Array.isArray(rulesRes) ? rulesRes : [])
    },
    [],
  )

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
        await loadData(wsId, statusFilter)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load alerts.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // statusFilter intentionally excluded; refetch handled by its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveWorkspace, loadData])

  // Re-fetch alert feed when the status filter changes (server-side filter).
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      setError(null)
      try {
        const query: Record<string, string> = { workspace_id: workspaceId }
        if (statusFilter !== 'all') query.status = statusFilter
        const res = await api.getAlerts(query)
        if (active) setAlerts(Array.isArray(res) ? res : [])
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load alerts.')
      }
    })()
    return () => {
      active = false
    }
  }, [statusFilter, workspaceId])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      await loadData(workspaceId, statusFilter)
    } catch (e: any) {
      setError(e?.message || 'Failed to reload alerts.')
    }
  }, [workspaceId, statusFilter, loadData])

  const onEvaluate = useCallback(async () => {
    if (!workspaceId) return
    setEvaluating(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.evaluateAlerts({ workspace_id: workspaceId })
      const created = res?.alerts_created ?? 0
      setNotice(
        created > 0
          ? `Evaluation complete — ${created} new alert${created === 1 ? '' : 's'} created.`
          : 'Evaluation complete — no new alerts triggered.',
      )
      await loadData(workspaceId, statusFilter)
    } catch (e: any) {
      setError(e?.message || 'Evaluation failed.')
    } finally {
      setEvaluating(false)
    }
  }, [workspaceId, statusFilter, loadData])

  const setStatus = useCallback(
    async (alert: Alert, status: string) => {
      if (!workspaceId) return
      setActingId(alert.id)
      setError(null)
      setNotice(null)
      try {
        await api.setAlertStatus(alert.id, { status })
        setNotice(`Alert ${status}.`)
        await loadData(workspaceId, statusFilter)
      } catch (e: any) {
        setError(e?.message || 'Failed to update alert.')
      } finally {
        setActingId(null)
      }
    },
    [workspaceId, statusFilter, loadData],
  )

  // Rule CRUD.
  const openCreateRule = useCallback(() => {
    setEditingRule(null)
    setRuleForm(emptyRuleForm)
    setRuleFormError(null)
    setRuleModalOpen(true)
  }, [])

  const openEditRule = useCallback((rule: AlertRule) => {
    setEditingRule(rule)
    setRuleForm({
      name: rule.name ?? '',
      rule_type: rule.rule_type ?? 'env_waste',
      threshold: rule.threshold_cents != null ? String(rule.threshold_cents / 100) : '',
      severity: rule.severity ?? 'warning',
      is_active: rule.is_active ?? true,
    })
    setRuleFormError(null)
    setRuleModalOpen(true)
  }, [])

  const onSubmitRule = useCallback(async () => {
    if (!workspaceId) return
    const name = ruleForm.name.trim()
    if (!name) {
      setRuleFormError('Rule name is required.')
      return
    }
    let thresholdCents: number | null = null
    if (ruleForm.threshold.trim() !== '') {
      const dollarsVal = Number(ruleForm.threshold)
      if (!Number.isFinite(dollarsVal) || dollarsVal < 0) {
        setRuleFormError('Threshold must be a non-negative dollar amount.')
        return
      }
      thresholdCents = Math.round(dollarsVal * 100)
    }
    setSavingRule(true)
    setRuleFormError(null)
    setNotice(null)
    try {
      const payload: Record<string, unknown> = {
        name,
        rule_type: ruleForm.rule_type,
        threshold_cents: thresholdCents,
        severity: ruleForm.severity,
        is_active: ruleForm.is_active,
      }
      if (editingRule) {
        await api.updateAlertRule(editingRule.id, payload)
        setNotice(`Updated rule "${name}".`)
      } else {
        await api.createAlertRule({ workspace_id: workspaceId, ...payload })
        setNotice(`Created rule "${name}".`)
      }
      setRuleModalOpen(false)
      await loadData(workspaceId, statusFilter)
    } catch (e: any) {
      setRuleFormError(e?.message || 'Save failed.')
    } finally {
      setSavingRule(false)
    }
  }, [workspaceId, ruleForm, editingRule, statusFilter, loadData])

  const toggleRuleActive = useCallback(
    async (rule: AlertRule) => {
      if (!workspaceId) return
      setActingId(rule.id)
      setError(null)
      try {
        await api.updateAlertRule(rule.id, { is_active: !(rule.is_active ?? false) })
        await loadData(workspaceId, statusFilter)
      } catch (e: any) {
        setError(e?.message || 'Failed to toggle rule.')
      } finally {
        setActingId(null)
      }
    },
    [workspaceId, statusFilter, loadData],
  )

  const onDeleteRule = useCallback(
    async (rule: AlertRule) => {
      if (!workspaceId) return
      if (typeof window !== 'undefined' && !window.confirm(`Delete alert rule "${rule.name}"?`)) return
      setDeletingRuleId(rule.id)
      setError(null)
      setNotice(null)
      try {
        await api.deleteAlertRule(rule.id)
        setNotice(`Deleted rule "${rule.name}".`)
        await loadData(workspaceId, statusFilter)
      } catch (e: any) {
        setError(e?.message || 'Delete failed.')
      } finally {
        setDeletingRuleId(null)
      }
    },
    [workspaceId, statusFilter, loadData],
  )

  const ruleTypeLabel = useCallback((t?: string | null) => {
    return RULE_TYPES.find((r) => r.value === t)?.label ?? t ?? 'custom'
  }, [])

  const filteredAlerts = useMemo(() => {
    let rows = alerts
    if (severityFilter !== 'all') {
      rows = rows.filter((a) => (a.severity || '').toLowerCase() === severityFilter)
    }
    return [...rows].sort((a, b) => {
      const sa = SEVERITY_RANK[(a.severity || '').toLowerCase()] ?? 0
      const sb = SEVERITY_RANK[(b.severity || '').toLowerCase()] ?? 0
      if (sb !== sa) return sb - sa
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return tb - ta
    })
  }, [alerts, severityFilter])

  const openCount = useMemo(
    () => alerts.filter((a) => (a.status || '').toLowerCase() === 'open' || (a.status || '').toLowerCase() === 'firing').length,
    [alerts],
  )
  const criticalCount = useMemo(
    () => alerts.filter((a) => severityTone(a.severity) === 'danger').length,
    [alerts],
  )
  const activeRules = useMemo(() => rules.filter((r) => r.is_active).length, [rules])

  if (loading) return <PageSpinner label="Loading alerts..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before configuring alerts."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Alerts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Define threshold rules over waste, budgets and orphans. Evaluate to fire alerts, then acknowledge or
            resolve them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={onEvaluate} disabled={evaluating}>
            {evaluating ? 'Evaluating…' : 'Evaluate now'}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Stat label="Open alerts" value={openCount.toLocaleString()} tone={openCount > 0 ? 'danger' : 'default'} />
        <Stat
          label="Critical"
          value={criticalCount.toLocaleString()}
          tone={criticalCount > 0 ? 'danger' : 'default'}
        />
        <Stat label="Total in view" value={alerts.length.toLocaleString()} />
        <Stat label="Active rules" value={`${activeRules} / ${rules.length}`} />
      </div>

      {/* Alert feed */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Alert feed</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All severities</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredAlerts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={alerts.length === 0 ? 'No alerts' : 'No matching alerts'}
                description={
                  alerts.length === 0
                    ? 'Nothing has fired for the current status filter. Create rules and run "Evaluate now" to check thresholds.'
                    : 'Try a different severity filter.'
                }
                action={alerts.length === 0 ? <Button onClick={onEvaluate} disabled={evaluating}>Evaluate now</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Message</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredAlerts.map((a) => {
                  const status = (a.status || '').toLowerCase()
                  const busy = actingId === a.id
                  return (
                    <TR key={a.id}>
                      <TD>
                        <Badge tone={severityTone(a.severity)}>{a.severity || 'info'}</Badge>
                      </TD>
                      <TD>
                        <div className="text-slate-100">{a.message || '—'}</div>
                        {a.link && (
                          <a href={a.link} className="text-xs text-sky-300 hover:underline">
                            View detail →
                          </a>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(a.status)}>{a.status || 'open'}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-slate-500">
                        {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          {status !== 'acknowledged' && status !== 'resolved' && (
                            <Button variant="secondary" onClick={() => setStatus(a, 'acknowledged')} disabled={busy}>
                              {busy ? '…' : 'Acknowledge'}
                            </Button>
                          )}
                          {status !== 'resolved' && (
                            <Button variant="ghost" onClick={() => setStatus(a, 'resolved')} disabled={busy}>
                              {busy ? '…' : 'Resolve'}
                            </Button>
                          )}
                          {status === 'resolved' && (
                            <Button variant="ghost" onClick={() => setStatus(a, 'open')} disabled={busy}>
                              {busy ? '…' : 'Reopen'}
                            </Button>
                          )}
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

      {/* Alert rules */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Alert rules</h3>
            <p className="text-xs text-slate-500">Thresholds evaluated against waste, budgets and orphan findings.</p>
          </div>
          <Button onClick={openCreateRule}>New rule</Button>
        </CardHeader>
        <CardBody className="p-0">
          {rules.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No alert rules"
                description="Create a rule so the evaluator knows what to watch — e.g. notify when a dev environment wastes more than $500/mo."
                action={<Button onClick={openCreateRule}>New rule</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Threshold</TH>
                  <TH>Severity</TH>
                  <TH>Active</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rules.map((r) => {
                  const busy = actingId === r.id
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium text-slate-100">{r.name}</TD>
                      <TD className="text-slate-400">{ruleTypeLabel(r.rule_type)}</TD>
                      <TD className="text-right tabular-nums">
                        {r.threshold_cents != null ? dollars(r.threshold_cents) : <span className="text-slate-600">—</span>}
                      </TD>
                      <TD>
                        <Badge tone={severityTone(r.severity)}>{r.severity || 'info'}</Badge>
                      </TD>
                      <TD>
                        <button
                          onClick={() => toggleRuleActive(r)}
                          disabled={busy}
                          className="disabled:opacity-50"
                          title={r.is_active ? 'Click to disable' : 'Click to enable'}
                        >
                          <Badge tone={r.is_active ? 'success' : 'default'}>
                            {r.is_active ? 'Active' : 'Disabled'}
                          </Badge>
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => openEditRule(r)}>
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => onDeleteRule(r)}
                            disabled={deletingRuleId === r.id}
                          >
                            {deletingRuleId === r.id ? 'Deleting…' : 'Delete'}
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
        open={ruleModalOpen}
        onClose={() => !savingRule && setRuleModalOpen(false)}
        title={editingRule ? 'Edit alert rule' : 'New alert rule'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRuleModalOpen(false)} disabled={savingRule}>
              Cancel
            </Button>
            <Button onClick={onSubmitRule} disabled={savingRule}>
              {savingRule ? 'Saving…' : editingRule ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {ruleFormError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {ruleFormError}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Rule name</span>
            <input
              value={ruleForm.name}
              onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Dev waste over $500"
              autoFocus
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Rule type</span>
            <select
              value={ruleForm.rule_type}
              onChange={(e) => setRuleForm((f) => ({ ...f, rule_type: e.target.value }))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Threshold (USD)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ruleForm.threshold}
                onChange={(e) => setRuleForm((f) => ({ ...f, threshold: e.target.value }))}
                placeholder="500"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
              <span className="text-xs text-slate-600">Stored as cents. Leave blank for non-threshold rules.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Severity</span>
              <select
                value={ruleForm.severity}
                onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value }))}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ruleForm.is_active}
              onChange={(e) => setRuleForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-400 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-300">Active — include in evaluation runs</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
