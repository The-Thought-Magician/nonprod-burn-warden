import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tag_rules, resources, workspace_members } from '../db/schema.js'
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

function tagMatches(tagValue: string, actual: string | undefined): boolean {
  if (actual === undefined) return false
  // empty / "*" configured value means "any value present"
  if (tagValue === '' || tagValue === '*') return true
  return actual.toLowerCase() === tagValue.toLowerCase()
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  env_kind: z.string().min(1),
  tag_key: z.string().min(1),
  tag_value: z.string().optional().default(''),
  priority: z.number().int().optional().default(100),
  is_active: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  env_kind: z.string().min(1).optional(),
  tag_key: z.string().min(1).optional(),
  tag_value: z.string().optional(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// GET / — list by workspace_id with live hit counts
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(tag_rules)
    .where(eq(tag_rules.workspace_id, workspaceId))
    .orderBy(asc(tag_rules.priority), desc(tag_rules.created_at))

  if (rows.length === 0) return c.json([])

  // recompute live hit counts against current resources so the UI always shows
  // an accurate match count even if /apply has not been run recently.
  const all = await db.select().from(resources).where(eq(resources.workspace_id, workspaceId))
  const result = rows.map((rule) => {
    const liveHits = all.filter((r) => {
      const tags = (r.tags ?? {}) as Record<string, string>
      return tagMatches(rule.tag_value, tags[rule.tag_key])
    }).length
    return { ...rule, hit_count: rule.hit_count, live_hit_count: liveHits }
  })

  return c.json(result)
})

// ---------------------------------------------------------------------------
// POST / — create
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // compute initial hit count from current resources
  const all = await db.select().from(resources).where(eq(resources.workspace_id, body.workspace_id))
  const hits = all.filter((r) => {
    const tags = (r.tags ?? {}) as Record<string, string>
    return tagMatches(body.tag_value, tags[body.tag_key])
  }).length

  const [rule] = await db
    .insert(tag_rules)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      env_kind: body.env_kind,
      tag_key: body.tag_key,
      tag_value: body.tag_value,
      priority: body.priority,
      is_active: body.is_active,
      hit_count: hits,
      created_by: userId,
    })
    .returning()

  return c.json(rule, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update (recomputes hit count)
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tag_rules).where(eq(tag_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const merged = { ...existing, ...body }

  const all = await db.select().from(resources).where(eq(resources.workspace_id, existing.workspace_id))
  const hits = all.filter((r) => {
    const tags = (r.tags ?? {}) as Record<string, string>
    return tagMatches(merged.tag_value, tags[merged.tag_key])
  }).length

  const [updated] = await db
    .update(tag_rules)
    .set({ ...body, hit_count: hits })
    .where(eq(tag_rules.id, id))
    .returning()

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tag_rules).where(eq(tag_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(tag_rules).where(eq(tag_rules.id, id))
  return c.json({ success: true })
})

export default router
