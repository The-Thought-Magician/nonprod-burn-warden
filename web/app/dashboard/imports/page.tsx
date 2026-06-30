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

type ImportBatch = {
  id: string
  workspace_id: string
  cloud_account_id?: string | null
  kind: string
  source?: string | null
  period?: string | null
  row_count?: number | null
  error_count?: number | null
  status?: string | null
  errors?: ImportError[] | null
  created_by?: string | null
  created_at?: string | null
}

type ImportError = {
  row?: number | null
  line?: number | null
  message?: string | null
  error?: string | null
  field?: string | null
  [k: string]: unknown
}

type CloudAccount = {
  id: string
  provider: string
  account_ref: string
  nickname?: string | null
}

type ImportKind = 'resources' | 'costs' | 'usage'

const KIND_CONFIG: Record<
  ImportKind,
  { label: string; columns: string[]; example: string; description: string }
> = {
  resources: {
    label: 'Resources',
    columns: ['external_id', 'name', 'resource_type', 'service', 'region', 'provider', 'monthly_cost_cents', 'tags'],
    example:
      'external_id,name,resource_type,service,region,provider,monthly_cost_cents,tags\ni-0abc123,api-staging,ec2,EC2,us-east-1,aws,42000,{"env":"staging"}\ni-0def456,worker-dev,ec2,EC2,us-east-1,aws,18000,{"env":"dev"}',
    description: 'Inventory rows: one per cloud resource. Cost in integer cents.',
  },
  costs: {
    label: 'Costs',
    columns: ['external_id', 'period', 'amount_cents', 'run_hours', 'currency'],
    example:
      'external_id,period,amount_cents,run_hours,currency\ni-0abc123,2026-06,42000,720,USD\ni-0def456,2026-06,18000,310,USD',
    description: 'Cost records keyed by resource external_id + period (YYYY-MM).',
  },
  usage: {
    label: 'Usage',
    columns: ['external_id', 'metric', 'value', 'sampled_at'],
    example:
      'external_id,metric,value,sampled_at\ni-0abc123,cpu,3.2,2026-06-15T02:00:00Z\ni-0abc123,cpu,1.1,2026-06-15T03:00:00Z',
    description: 'Usage samples used by idle detection. sampled_at is ISO-8601.',
  },
}

function kindTone(kind?: string | null): 'info' | 'warning' | 'success' | 'default' {
  switch ((kind || '').toLowerCase()) {
    case 'resources':
      return 'info'
    case 'costs':
      return 'warning'
    case 'usage':
      return 'success'
    default:
      return 'default'
  }
}

function statusTone(status?: string | null): 'success' | 'warning' | 'danger' | 'default' {
  switch ((status || '').toLowerCase()) {
    case 'completed':
    case 'success':
    case 'ok':
      return 'success'
    case 'partial':
    case 'completed_with_errors':
      return 'warning'
    case 'failed':
    case 'error':
      return 'danger'
    default:
      return 'default'
  }
}

// Minimal CSV parser: handles quoted fields and embedded commas/quotes.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }

  const splitLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          cur += c
        }
      } else if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += c
      }
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }

  const headers = splitLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? ''
    })
    return obj
  })
  return { headers, rows }
}

// Coerce numeric columns and parse JSON tag column for resource imports.
function coerceRows(kind: ImportKind, rows: Record<string, string>[]): Record<string, unknown>[] {
  const numeric = new Set(['monthly_cost_cents', 'amount_cents', 'run_hours', 'value', 'hourly_rate_cents'])
  return rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (v === '') {
        out[k] = null
        continue
      }
      if (numeric.has(k)) {
        const n = Number(v)
        out[k] = Number.isFinite(n) ? n : v
      } else if (k === 'tags') {
        try {
          out[k] = JSON.parse(v)
        } catch {
          out[k] = v
        }
      } else {
        out[k] = v
      }
    }
    return out
  })
}

export default function ImportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [accounts, setAccounts] = useState<CloudAccount[]>([])
  const [kindFilter, setKindFilter] = useState<string>('all')

  // Import form state.
  const [kind, setKind] = useState<ImportKind>('resources')
  const [csvText, setCsvText] = useState('')
  const [accountId, setAccountId] = useState('')
  const [period, setPeriod] = useState('')
  const [source, setSource] = useState('csv-paste')
  const [submitting, setSubmitting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Detail modal.
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<ImportBatch | null>(null)
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
    const [imports, accts] = await Promise.all([
      api.getImports(wsId),
      api.getCloudAccounts(wsId).catch(() => []),
    ])
    setBatches(Array.isArray(imports) ? imports : [])
    setAccounts(Array.isArray(accts) ? accts : [])
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
        if (active) setError(e?.message || 'Failed to load imports.')
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
      setError(e?.message || 'Failed to reload imports.')
    }
  }, [workspaceId, loadData])

  const onFile = useCallback((file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(typeof reader.result === 'string' ? reader.result : '')
      setSource(`upload:${file.name}`)
    }
    reader.readAsText(file)
  }, [])

  const parsed = useMemo(() => parseCsv(csvText), [csvText])

  const loadExample = useCallback(() => {
    setCsvText(KIND_CONFIG[kind].example)
    setSource('csv-paste')
  }, [kind])

  const onImport = useCallback(async () => {
    if (!workspaceId) return
    if (!csvText.trim()) {
      setImportError('Paste or upload CSV rows first.')
      return
    }
    if (parsed.rows.length === 0) {
      setImportError('No data rows detected. Make sure the first line is a header row.')
      return
    }
    if (kind === 'costs' && !period.trim()) {
      setImportError('A period (YYYY-MM) is required for cost imports unless every row has its own period.')
    }
    setSubmitting(true)
    setImportError(null)
    setNotice(null)
    try {
      const rows = coerceRows(kind, parsed.rows)
      const body: Record<string, unknown> = {
        workspace_id: workspaceId,
        rows,
        source: source.trim() || 'csv-paste',
      }
      if (accountId) body.cloud_account_id = accountId
      if (period.trim()) body.period = period.trim()

      let batch: ImportBatch
      if (kind === 'resources') batch = await api.importResources(body)
      else if (kind === 'costs') batch = await api.importCosts(body)
      else batch = await api.importUsage(body)

      const errs = batch?.error_count ?? 0
      const ok = (batch?.row_count ?? rows.length) - errs
      setNotice(
        `Imported ${ok} ${KIND_CONFIG[kind].label.toLowerCase()} row${ok === 1 ? '' : 's'}` +
          (errs > 0 ? ` with ${errs} error${errs === 1 ? '' : 's'}.` : '.'),
      )
      setCsvText('')
      setPeriod('')
      await loadData(workspaceId)
    } catch (e: any) {
      setImportError(e?.message || 'Import failed.')
    } finally {
      setSubmitting(false)
    }
  }, [workspaceId, csvText, parsed, kind, period, source, accountId, loadData])

  const openDetail = useCallback(async (batch: ImportBatch) => {
    setDetailOpen(true)
    setDetail(batch)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const res = await api.getImport(batch.id)
      setDetail(res || batch)
    } catch (e: any) {
      setDetailError(e?.message || 'Failed to load batch detail.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const accountLabel = useCallback(
    (id?: string | null) => {
      if (!id) return null
      const a = accounts.find((x) => x.id === id)
      if (!a) return id
      return a.nickname || a.account_ref
    },
    [accounts],
  )

  const filtered = useMemo(() => {
    let rows = batches
    if (kindFilter !== 'all') rows = rows.filter((b) => b.kind === kindFilter)
    return [...rows].sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return tb - ta
    })
  }, [batches, kindFilter])

  const totalRows = useMemo(() => batches.reduce((s, b) => s + (b.row_count ?? 0), 0), [batches])
  const totalErrors = useMemo(() => batches.reduce((s, b) => s + (b.error_count ?? 0), 0), [batches])

  if (loading) return <PageSpinner label="Loading imports..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<span>🔥</span>}
          title="No workspace found"
          description="Create or seed a workspace from the dashboard before importing data."
        />
      </div>
    )
  }

  const cfg = KIND_CONFIG[kind]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Imports</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Bulk-load resources, cost records and usage samples from CSV. Paste rows or upload a file, then review per
            batch error reports.
          </p>
        </div>
        <Button variant="secondary" onClick={refresh}>
          Refresh
        </Button>
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
        <Stat label="Import batches" value={batches.length.toLocaleString()} />
        <Stat label="Rows imported" value={totalRows.toLocaleString()} />
        <Stat
          label="Total errors"
          value={totalErrors.toLocaleString()}
          tone={totalErrors > 0 ? 'danger' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">New import</h3>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {importError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {importError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(Object.keys(KIND_CONFIG) as ImportKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  kind === k
                    ? 'border-yellow-500 bg-yellow-400/10 text-yellow-300'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {KIND_CONFIG[k].label}
              </button>
            ))}
          </div>

          <p className="text-sm text-zinc-500">{cfg.description}</p>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">Expected columns:</span>
            {cfg.columns.map((c) => (
              <code key={c} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">
                {c}
              </code>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Cloud account (optional)
              </span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
              >
                <option value="">— none —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.nickname || a.account_ref) + ` (${a.provider})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Period {kind === 'costs' ? '' : '(optional)'}
              </span>
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="YYYY-MM"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Source label</span>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="csv-paste"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-yellow-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">CSV rows</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={loadExample} type="button">
                  Load example
                </Button>
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700">
                  Upload .csv
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={8}
              placeholder={cfg.example}
              spellCheck={false}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-700 focus:border-yellow-500 focus:outline-none"
            />
          </div>

          {csvText.trim() && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  Preview — {parsed.rows.length} data row{parsed.rows.length === 1 ? '' : 's'},{' '}
                  {parsed.headers.length} column{parsed.headers.length === 1 ? '' : 's'}
                </span>
                {parsed.rows.length > 5 && <span className="text-zinc-600">showing first 5</span>}
              </div>
              {parsed.headers.length === 0 ? (
                <p className="text-sm text-zinc-500">No header row detected.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-zinc-500">
                      <tr>
                        {parsed.headers.map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-1 font-mono font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {parsed.rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          {parsed.headers.map((h) => (
                            <td key={h} className="whitespace-nowrap px-2 py-1 font-mono text-zinc-300">
                              {r[h] || <span className="text-zinc-700">∅</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={onImport} disabled={submitting || !csvText.trim()}>
              {submitting ? 'Importing…' : `Import ${parsed.rows.length || ''} ${cfg.label.toLowerCase()} rows`}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">Import history</h3>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-yellow-500 focus:outline-none"
          >
            <option value="all">All kinds</option>
            <option value="resources">Resources</option>
            <option value="costs">Costs</option>
            <option value="usage">Usage</option>
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={batches.length === 0 ? 'No imports yet' : 'No matching batches'}
                description={
                  batches.length === 0
                    ? 'Run your first import using the form above to populate resources, costs or usage.'
                    : 'Try a different kind filter.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Kind</TH>
                  <TH>Source</TH>
                  <TH>Account</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Errors</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Badge tone={kindTone(b.kind)}>{b.kind}</Badge>
                    </TD>
                    <TD className="font-mono text-xs">{b.source || '—'}</TD>
                    <TD>{accountLabel(b.cloud_account_id) || <span className="text-zinc-600">—</span>}</TD>
                    <TD>{b.period || <span className="text-zinc-600">—</span>}</TD>
                    <TD className="text-right tabular-nums">{(b.row_count ?? 0).toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">
                      {(b.error_count ?? 0) > 0 ? (
                        <span className="text-red-300">{b.error_count}</span>
                      ) : (
                        <span className="text-zinc-600">0</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(b.status)}>{b.status || 'unknown'}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-zinc-500">
                      {b.created_at ? new Date(b.created_at).toLocaleString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => openDetail(b)}>
                        Details
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail ? `${detail.kind} import` : 'Import detail'}
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
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Rows" value={(detail.row_count ?? 0).toLocaleString()} />
              <Stat
                label="Errors"
                value={(detail.error_count ?? 0).toLocaleString()}
                tone={(detail.error_count ?? 0) > 0 ? 'danger' : 'default'}
              />
              <Stat label="Status" value={<Badge tone={statusTone(detail.status)}>{detail.status || '—'}</Badge>} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Source</div>
                <div className="font-mono text-zinc-300">{detail.source || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Period</div>
                <div className="text-zinc-300">{detail.period || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Account</div>
                <div className="text-zinc-300">{accountLabel(detail.cloud_account_id) || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Created</div>
                <div className="text-zinc-300">
                  {detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Row errors</h4>
              {detailLoading ? (
                <div className="py-6">
                  <Spinner label="Loading errors…" />
                </div>
              ) : (detail.errors ?? []).length === 0 ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-4 text-center text-sm text-emerald-300">
                  No errors — all rows imported cleanly.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Field</th>
                        <th className="px-3 py-2 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {(detail.errors ?? []).map((err, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 tabular-nums text-zinc-400">
                            {err.row ?? err.line ?? i + 1}
                          </td>
                          <td className="px-3 py-2 font-mono text-zinc-400">{err.field || '—'}</td>
                          <td className="px-3 py-2 text-red-300">
                            {err.message || err.error || JSON.stringify(err)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
