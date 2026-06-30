import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  recommendations,
  savings_estimates,
  orphan_findings,
  environments,
  workspace_members,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// GET / — public — recommendations by workspace_id ranked by recoverable_cents
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')

  const conds = [eq(recommendations.workspace_id, workspaceId)]
  if (status) conds.push(eq(recommendations.status, status))

  const recs = await db
    .select()
    .from(recommendations)
    .where(and(...conds))
    .orderBy(desc(recommendations.recoverable_cents), desc(recommendations.created_at))

  return c.json(recs)
})

// ---------------------------------------------------------------------------
// POST /generate — auth — generate recs from savings + orphans
// ---------------------------------------------------------------------------
const generateSchema = z.object({
  workspace_id: z.string().min(1),
})

router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Existing open recommendations, to avoid duplicates by (rec_type, env, schedule, orphan).
  const existingRecs = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.workspace_id, workspace_id), eq(recommendations.status, 'open')))

  const existingScheduleKeys = new Set(
    existingRecs
      .filter((r) => r.rec_type === 'schedule')
      .map((r) => `${r.environment_id ?? ''}::${r.schedule_id ?? ''}`),
  )
  const existingOrphanKeys = new Set(
    existingRecs.filter((r) => r.rec_type === 'orphan').map((r) => r.orphan_finding_id ?? ''),
  )

  // Environment name lookup for nicer titles.
  const envRows = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, workspace_id))
  const envName = new Map(envRows.map((e) => [e.id, e.name]))

  let created = 0
  let totalRecoverable = 0

  // 1. Schedule-based recs from savings estimates: pick the best estimate per environment.
  const estimates = await db
    .select()
    .from(savings_estimates)
    .where(eq(savings_estimates.workspace_id, workspace_id))
    .orderBy(desc(savings_estimates.monthly_savings_cents))

  const bestPerEnv = new Map<string, typeof estimates[number]>()
  for (const e of estimates) {
    const key = e.environment_id ?? ''
    if (!key) continue
    if (!bestPerEnv.has(key)) bestPerEnv.set(key, e)
  }

  for (const est of bestPerEnv.values()) {
    if ((est.monthly_savings_cents ?? 0) <= 0) continue
    const key = `${est.environment_id ?? ''}::${est.schedule_id ?? ''}`
    if (existingScheduleKeys.has(key)) continue

    const label = est.environment_id ? envName.get(est.environment_id) ?? 'environment' : 'environment'
    const pct = Math.round(est.savings_pct ?? 0)
    await db.insert(recommendations).values({
      workspace_id,
      environment_id: est.environment_id ?? null,
      schedule_id: est.schedule_id ?? null,
      orphan_finding_id: null,
      rec_type: 'schedule',
      title: `Apply off-hours schedule to ${label}`,
      detail: `Estimated ${pct}% reduction by suspending ${label} outside business hours, saving roughly ${est.hours_saved_per_week ?? 0} hours/week.`,
      recoverable_cents: est.monthly_savings_cents ?? 0,
      status: 'open',
    })
    existingScheduleKeys.add(key)
    created++
    totalRecoverable += est.monthly_savings_cents ?? 0
  }

  // 2. Orphan-based recs from open orphan findings.
  const orphans = await db
    .select()
    .from(orphan_findings)
    .where(and(eq(orphan_findings.workspace_id, workspace_id), eq(orphan_findings.status, 'open')))
    .orderBy(desc(orphan_findings.monthly_cost_cents))

  for (const o of orphans) {
    if (existingOrphanKeys.has(o.id)) continue
    const recoverable = o.monthly_cost_cents ?? 0
    const titleMap: Record<string, string> = {
      stale_sandbox: 'Decommission stale sandbox resource',
      forgotten_preview: 'Tear down forgotten preview environment',
      zero_usage: 'Remove zero-usage resource',
    }
    const title = titleMap[o.finding_type] ?? 'Clean up orphaned resource'
    await db.insert(recommendations).values({
      workspace_id,
      environment_id: o.environment_id ?? null,
      schedule_id: null,
      orphan_finding_id: o.id,
      rec_type: 'orphan',
      title,
      detail: o.reason,
      recoverable_cents: recoverable,
      status: 'open',
    })
    existingOrphanKeys.add(o.id)
    created++
    totalRecoverable += recoverable
  }

  await db.insert(activity_log).values({
    workspace_id,
    actor_id: userId,
    action: 'recommendations.generate',
    entity_type: 'recommendation',
    entity_id: null,
    detail: { created, total_recoverable_cents: totalRecoverable },
  })

  return c.json({ created, total_recoverable_cents: totalRecoverable })
})

// ---------------------------------------------------------------------------
// PATCH /:id/status — auth — set status (applied/dismissed/open)
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  status: z.enum(['open', 'applied', 'dismissed']),
})

router.patch('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { status } = c.req.valid('json')

  const [existing] = await db.select().from(recommendations).where(eq(recommendations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(recommendations)
    .set({ status })
    .where(eq(recommendations.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    action: 'recommendations.status',
    entity_type: 'recommendation',
    entity_id: id,
    detail: { status },
  })

  return c.json(updated)
})

export default router
