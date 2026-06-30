import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_views, workspace_members } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All saved-view operations are auth-gated (per-user).
router.use('*', authMiddleware)

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  target: z.string().min(1),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  is_default: z.boolean().optional().default(false),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  is_default: z.boolean().optional(),
})

// GET /?workspace_id= — saved views for the current user + workspace
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(saved_views)
    .where(and(eq(saved_views.workspace_id, workspaceId), eq(saved_views.user_id, userId)))
    .orderBy(saved_views.created_at)

  return c.json(rows)
})

// POST / — create a saved view for the current user
router.post('/', zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // If this view is marked default, clear other defaults for the same user+workspace+target.
  if (body.is_default) {
    await db
      .update(saved_views)
      .set({ is_default: false })
      .where(
        and(
          eq(saved_views.workspace_id, body.workspace_id),
          eq(saved_views.user_id, userId),
          eq(saved_views.target, body.target),
        ),
      )
  }

  const [view] = await db
    .insert(saved_views)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      name: body.name,
      target: body.target,
      filters: body.filters as Record<string, unknown>,
      is_default: body.is_default,
    })
    .returning()

  return c.json(view, 201)
})

// PUT /:id — update filters / name / is_default (owner-only)
router.put('/:id', zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const target = body.target ?? existing.target

  if (body.is_default) {
    await db
      .update(saved_views)
      .set({ is_default: false })
      .where(
        and(
          eq(saved_views.workspace_id, existing.workspace_id),
          eq(saved_views.user_id, userId),
          eq(saved_views.target, target),
        ),
      )
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.target !== undefined) patch.target = body.target
  if (body.filters !== undefined) patch.filters = body.filters
  if (body.is_default !== undefined) patch.is_default = body.is_default

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(saved_views)
    .set(patch)
    .where(eq(saved_views.id, id))
    .returning()

  return c.json(updated)
})

// DELETE /:id — owner-only
router.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(saved_views).where(eq(saved_views.id, id))
  return c.json({ success: true })
})

export default router
