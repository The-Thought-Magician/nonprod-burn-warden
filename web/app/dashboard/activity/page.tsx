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

type ActivityEntry = {
  id: string
  workspace_id: string
  actor_id?: string | null
  action?: string | null
  entity_type?: string | null
  entity_id?: string | null
  detail?: Record<string, unknown> | null
  created_at?: string | null
}

function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function actionTone(action?: string | null): 'default' | 'warning' | 'danger' | 'success' | 'info' {
  const a = (action || '').toLowerCase()
  if (a.includes('delete') || a.includes('remove') || a.includes('dismiss')) return 'danger'
  if (a.includes('create') || a.includes('add') || a.includes('generate') || a.includes('seed')) return 'success'
  if (a.includes('update') || a.includes('edit') || a.includes('assign') || a.includes('rebuild')) return 'warning'
  if (a.includes('detect') || a.includes('evaluate') || a.includes('apply') || a.includes('calculate')) return 'info'
  return 'default'
}

function entityIcon(entity?: string | null): string {
  const e = (entity || '').toLowerCase()
  if (e.includes('resource')) return '🖥️'
  if (e.includes('environment')) return '🌐'
  if (e.includes('team')) return '👥'
  if (e.includes('budget')) return '💰'
  if (e.includes('schedule')) return '🗓️'
  if (e.includes('rule')) return '⚙️'
  if (e.includes('orphan')) return '🧹'
  if (e.includes('report')) return '📄'
  if (e.includes('alert')) return '🚨'
  if (e.includes('workspace')) return '🏢'
  if (e.includes('ledger') || e.includes('cost')) return '💸'
  return '•'
}

export default function ActivityPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [detail, setDetail] = useState<ActivityEntry | null>(null)

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nbw_workspace_id') : null
    const workspaces = await api.getWorkspaces().catch(() => [])
    const list: any[] = Array.isArray(workspaces) ? workspaces : []
    if (stored && list.some((w) => w.id === stored)) return stored
    const first = list[0]?.id ?? null
    if (first && typeof window !== 'undefined') localStorage.setItem('nbw_workspace_id', first)
    return first
  }, [])

  const loadData = useCallback(async (wsId: string, entity: string, actor: string) => {
    const query: Record<string, string> = { workspace_id: wsId }
    if (entity) query.entity_type = entity
    if (actor) query.actor_id = actor
    const res = await api.getActivity(query)
    setEntries(Array.isArray(res) ? res : [])
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
        await loadData(wsId, '', '')
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load activity.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [resolveWorkspace, loadData])

  const applyServerFilters = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      await loadData(workspaceId, entityFilter, actorFilter)
    } catch (e: any) {
      setError(e?.message || 'Failed to load activity.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, entityFilter, actorFilter, loadData])

  const entityTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.entity_type) set.add(e.entity_type)
    return Array.from(set).sort()
  }, [entries])

  const actors = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.actor_id) set.add(e.actor_id)
    return Array.from(set).sort()
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = entries
    if (q) {
      rows = rows.filter((e) =>
        [e.action, e.entity_type, e.entity_id, e.actor_id, JSON.stringify(e.detail ?? '')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }
    return [...rows].sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
    )
  }, [entries, search])

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>()
    for (const e of filtered) {
      const day = e.created_at ? new Date(e.created_at).toLocaleDateString() : 'Unknown date'
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(e)
    }
    return Array.from(map.entries())
  }, [filtered])

  const last24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000
    return entries.filter((e) => e.created_at && new Date(e.created_at).getTime() >= cutoff).length
  }, [entries])

  if (loading && entries.length === 0) return <PageSpinner label="Loading activity..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before viewing the activity log."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Activity Log</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Audit trail of every change across this workspace: classifications, detections, budgets, reports and more.
          </p>
        </div>
        <Button variant="secondary" onClick={applyServerFilters}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total events" value={entries.length.toLocaleString()} />
        <Stat label="Last 24 hours" value={last24h.toLocaleString()} tone="warning" />
        <Stat label="Distinct actors" value={actors.length.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <h3 className="mr-auto text-sm font-semibold text-zinc-200">Feed</h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
          />
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
          >
            <option value="">All entities</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="max-w-[12rem] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
          >
            <option value="">All actors</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={applyServerFilters}>
            Apply
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<span>🗒️</span>}
                title={entries.length === 0 ? 'No activity yet' : 'No matching events'}
                description={
                  entries.length === 0
                    ? 'Actions like creating environments, running detections or generating reports will appear here.'
                    : 'Try a different search or clear the filters.'
                }
              />
            </div>
          ) : (
            <div className="flex flex-col">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 px-5 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 backdrop-blur">
                    {day}
                  </div>
                  <ul className="divide-y divide-zinc-800">
                    {items.map((e) => (
                      <li key={e.id}>
                        <button
                          onClick={() => setDetail(e)}
                          className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-900/60"
                        >
                          <span className="mt-0.5 text-lg leading-none">{entityIcon(e.entity_type)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={actionTone(e.action)}>{e.action || 'event'}</Badge>
                              {e.entity_type && (
                                <span className="text-sm font-medium text-zinc-200">{e.entity_type}</span>
                              )}
                              {e.entity_id && (
                                <span className="truncate font-mono text-xs text-zinc-600">{e.entity_id}</span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                              {e.actor_id && <span>by {e.actor_id}</span>}
                              {e.detail && Object.keys(e.detail).length > 0 && (
                                <span className="text-zinc-600">· {Object.keys(e.detail).length} field(s)</span>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-600">
                            {relativeTime(e.created_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={detail != null}
        onClose={() => setDetail(null)}
        title="Event detail"
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={actionTone(detail.action)}>{detail.action || 'event'}</Badge>
              {detail.entity_type && <span className="font-medium text-zinc-200">{detail.entity_type}</span>}
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="text-zinc-500">Entity ID</dt>
              <dd className="break-all font-mono text-zinc-300">{detail.entity_id || '—'}</dd>
              <dt className="text-zinc-500">Actor</dt>
              <dd className="break-all text-zinc-300">{detail.actor_id || '—'}</dd>
              <dt className="text-zinc-500">When</dt>
              <dd className="text-zinc-300">
                {detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}
              </dd>
            </dl>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Detail</div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                {detail.detail && Object.keys(detail.detail).length > 0
                  ? JSON.stringify(detail.detail, null, 2)
                  : 'No additional detail.'}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
