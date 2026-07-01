import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  waste_ledger_entries,
  idle_windows,
  resources,
  environments,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// "YYYY-MM" for a Date
function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// GET / — public — waste_ledger_entries by workspace_id/period/environment_id/team_id
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const period = c.req.query('period')
  const environmentId = c.req.query('environment_id')
  const teamId = c.req.query('team_id')

  const conds = [eq(waste_ledger_entries.workspace_id, workspaceId)]
  if (period) conds.push(eq(waste_ledger_entries.period, period))
  if (environmentId) conds.push(eq(waste_ledger_entries.environment_id, environmentId))
  if (teamId) conds.push(eq(waste_ledger_entries.team_id, teamId))

  const rows = await db
    .select()
    .from(waste_ledger_entries)
    .where(and(...conds))
    .orderBy(desc(waste_ledger_entries.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /rebuild — auth — recompute ledger for a period from idle_windows + rates
// ---------------------------------------------------------------------------

const rebuildSchema = z.object({
  workspace_id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM'),
})

router.post('/rebuild', authMiddleware, zValidator('json', rebuildSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, period } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Period bounds (UTC).
  const [yy, mm] = period.split('-').map((n) => parseInt(n, 10))
  const periodStart = Date.UTC(yy, mm - 1, 1)
  const periodEnd = Date.UTC(yy, mm, 1) // exclusive

  // Load all idle windows for the workspace and keep those overlapping the period.
  const windows = await db
    .select()
    .from(idle_windows)
    .where(eq(idle_windows.workspace_id, workspace_id))

  // Resource lookup for rates + classification.
  const resRows = await db.select().from(resources).where(eq(resources.workspace_id, workspace_id))
  const resById = new Map(resRows.map((r) => [r.id, r]))

  // Aggregate per (environment_id, resource_id, team_id) key.
  interface Agg {
    environment_id: string | null
    resource_id: string | null
    team_id: string | null
    idle_hours: number
    off_hours_idle_hours: number
    hourly_rate_cents: number
    wasted_cents: number
    breakdown: Record<string, number>
  }
  const agg = new Map<string, Agg>()

  for (const w of windows) {
    const ws = w.start_at instanceof Date ? w.start_at.getTime() : new Date(w.start_at).getTime()
    const we = w.end_at instanceof Date ? w.end_at.getTime() : new Date(w.end_at).getTime()
    // Overlap with period?
    const overlapStart = Math.max(ws, periodStart)
    const overlapEnd = Math.min(we, periodEnd)
    if (overlapEnd <= overlapStart) continue

    const totalDur = we - ws
    const overlapDur = overlapEnd - overlapStart
    const frac = totalDur > 0 ? overlapDur / totalDur : 1
    const idleHours = (w.duration_hours ?? 0) * frac

    const res = w.resource_id ? resById.get(w.resource_id) : undefined
    const rate = res?.hourly_rate_cents ?? 0
    const envId = w.environment_id ?? res?.environment_id ?? null
    const teamId = res?.team_id ?? null
    const wasted = Math.round(idleHours * rate)
    const offHoursIdle = w.is_off_hours ? idleHours : 0

    const key = `${envId ?? ''}|${w.resource_id ?? ''}|${teamId ?? ''}`
    let a = agg.get(key)
    if (!a) {
      a = {
        environment_id: envId,
        resource_id: w.resource_id ?? null,
        team_id: teamId,
        idle_hours: 0,
        off_hours_idle_hours: 0,
        hourly_rate_cents: rate,
        wasted_cents: 0,
        breakdown: {},
      }
      agg.set(key, a)
    }
    a.idle_hours += idleHours
    a.off_hours_idle_hours += offHoursIdle
    a.wasted_cents += wasted
    a.hourly_rate_cents = rate
    if (res?.provider) a.breakdown[`provider:${res.provider}`] = (a.breakdown[`provider:${res.provider}`] ?? 0) + wasted
    if (res?.service) a.breakdown[`service:${res.service}`] = (a.breakdown[`service:${res.service}`] ?? 0) + wasted
    if (res?.region) a.breakdown[`region:${res.region}`] = (a.breakdown[`region:${res.region}`] ?? 0) + wasted
  }

  // Replace existing ledger entries for this workspace+period.
  await db
    .delete(waste_ledger_entries)
    .where(and(eq(waste_ledger_entries.workspace_id, workspace_id), eq(waste_ledger_entries.period, period)))

  let totalWasted = 0
  const toInsert = [...agg.values()].map((a) => {
    totalWasted += a.wasted_cents
    return {
      workspace_id,
      environment_id: a.environment_id,
      resource_id: a.resource_id,
      team_id: a.team_id,
      period,
      idle_hours: a.idle_hours,
      off_hours_idle_hours: a.off_hours_idle_hours,
      hourly_rate_cents: a.hourly_rate_cents,
      wasted_cents: a.wasted_cents,
      breakdown: a.breakdown,
    }
  })

  if (toInsert.length > 0) {
    await db.insert(waste_ledger_entries).values(toInsert)
  }

  return c.json({ entries_created: toInsert.length, total_wasted_cents: totalWasted })
})

// ---------------------------------------------------------------------------
// GET /summary — public — totals: monthly + trailing-30, by provider/service/region
// ---------------------------------------------------------------------------

router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const entries = await db
    .select()
    .from(waste_ledger_entries)
    .where(eq(waste_ledger_entries.workspace_id, workspaceId))

  const nowPeriod = periodOf(new Date())
  let monthlyCents = 0
  for (const e of entries) {
    if (e.period === nowPeriod) monthlyCents += e.wasted_cents
  }

  // Trailing-30: ledger entries created in the last 30 days.
  const cutoff = Date.now() - 30 * 86_400_000
  let trailing30Cents = 0
  for (const e of entries) {
    const created = e.created_at instanceof Date ? e.created_at.getTime() : new Date(e.created_at as any).getTime()
    if (created >= cutoff) trailing30Cents += e.wasted_cents
  }

  // Group by provider/service/region from breakdown jsonb, falling back to a
  // proportional split across the environment's resources when an entry was
  // written (e.g. by the sample seeder) without a breakdown map.
  const byProvider: Record<string, number> = {}
  const byService: Record<string, number> = {}
  const byRegion: Record<string, number> = {}

  const hasAttributionKeys = (bd: Record<string, unknown>) =>
    Object.keys(bd).some((k) => k.startsWith('provider:') || k.startsWith('service:') || k.startsWith('region:'))

  const envIdsNeedingFallback = [
    ...new Set(
      entries
        .filter((e) => !hasAttributionKeys((e.breakdown ?? {}) as Record<string, unknown>) && e.environment_id)
        .map((e) => e.environment_id as string),
    ),
  ]
  const fallbackResourcesByEnv = new Map<string, Array<{ provider: string | null; service: string | null; region: string | null }>>()
  if (envIdsNeedingFallback.length > 0) {
    const rows = await db
      .select()
      .from(resources)
      .where(and(eq(resources.workspace_id, workspaceId), inArray(resources.environment_id, envIdsNeedingFallback)))
    for (const r of rows) {
      const list = fallbackResourcesByEnv.get(r.environment_id as string) ?? []
      list.push({ provider: r.provider, service: r.service, region: r.region })
      fallbackResourcesByEnv.set(r.environment_id as string, list)
    }
  }

  for (const e of entries) {
    const bd = (e.breakdown ?? {}) as Record<string, number>
    if (hasAttributionKeys(bd)) {
      for (const [k, v] of Object.entries(bd)) {
        if (k.startsWith('provider:')) byProvider[k.slice(9)] = (byProvider[k.slice(9)] ?? 0) + v
        else if (k.startsWith('service:')) byService[k.slice(8)] = (byService[k.slice(8)] ?? 0) + v
        else if (k.startsWith('region:')) byRegion[k.slice(7)] = (byRegion[k.slice(7)] ?? 0) + v
      }
      continue
    }
    const envResources = e.environment_id ? fallbackResourcesByEnv.get(e.environment_id) ?? [] : []
    if (envResources.length === 0) continue
    const share = e.wasted_cents / envResources.length
    for (const r of envResources) {
      if (r.provider) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + share
      if (r.service) byService[r.service] = (byService[r.service] ?? 0) + share
      if (r.region) byRegion[r.region] = (byRegion[r.region] ?? 0) + share
    }
  }

  return c.json({
    monthly_cents: monthlyCents,
    trailing30_cents: trailing30Cents,
    by_provider: byProvider,
    by_service: byService,
    by_region: byRegion,
  })
})

// ---------------------------------------------------------------------------
// GET /by-environment — public — waste grouped per environment
// ---------------------------------------------------------------------------

router.get('/by-environment', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const entries = await db
    .select()
    .from(waste_ledger_entries)
    .where(eq(waste_ledger_entries.workspace_id, workspaceId))

  const envs = await db.select().from(environments).where(eq(environments.workspace_id, workspaceId))
  const envName = new Map(envs.map((e) => [e.id, e.name]))

  const totals = new Map<string, number>()
  for (const e of entries) {
    if (!e.environment_id) continue
    totals.set(e.environment_id, (totals.get(e.environment_id) ?? 0) + e.wasted_cents)
  }

  const out = [...totals.entries()]
    .map(([environment_id, wasted_cents]) => ({
      environment_id,
      name: envName.get(environment_id) ?? 'Unknown',
      wasted_cents,
    }))
    .sort((a, b) => b.wasted_cents - a.wasted_cents)

  return c.json(out)
})

export default router
