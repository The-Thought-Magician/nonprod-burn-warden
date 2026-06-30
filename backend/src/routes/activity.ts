import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// Public: list activity_log by workspace_id with optional entity_type / actor_id filters.
// GET /?workspace_id=&entity_type=&actor_id=&limit=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const entityType = c.req.query('entity_type')
  const actorId = c.req.query('actor_id')
  const limitRaw = parseInt(c.req.query('limit') ?? '200', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200

  const conditions = [eq(activity_log.workspace_id, workspaceId)]
  if (entityType) conditions.push(eq(activity_log.entity_type, entityType))
  if (actorId) conditions.push(eq(activity_log.actor_id, actorId))

  const rows = await db
    .select()
    .from(activity_log)
    .where(and(...conditions))
    .orderBy(desc(activity_log.created_at))
    .limit(limit)

  return c.json(rows)
})

export default router
