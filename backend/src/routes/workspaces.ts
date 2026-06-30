import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric/hyphen'),
  currency: z.string().min(1).optional().default('USD'),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(['owner', 'member']).optional().default('member'),
})

// Membership helpers ---------------------------------------------------------

async function getMembership(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return m ?? null
}

// GET / — list workspaces the user is a member of, with their role -----------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      owner_id: workspaces.owner_id,
      currency: workspaces.currency,
      created_at: workspaces.created_at,
      updated_at: workspaces.updated_at,
      role: workspace_members.role,
    })
    .from(workspace_members)
    .innerJoin(workspaces, eq(workspace_members.workspace_id, workspaces.id))
    .where(eq(workspace_members.user_id, userId))
    .orderBy(desc(workspaces.created_at))
  return c.json(rows)
})

// POST / — create workspace + owner membership -------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db
    .insert(workspaces)
    .values({ name: body.name, slug: body.slug, currency: body.currency, owner_id: userId })
    .returning()
  await db.insert(workspace_members).values({ workspace_id: ws.id, user_id: userId, role: 'owner' })
  return c.json(ws, 201)
})

// GET /:id — workspace detail (member only) ----------------------------------
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  return c.json({ ...ws, role: membership.role })
})

// PUT /:id — update name/currency (owner only) -------------------------------
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// GET /:id/members — list members (member only) ------------------------------
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(workspace_members.created_at)
  return c.json(members)
})

// POST /:id/members — add member by user_id + role (owner only) --------------
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const existing = await getMembership(id, body.user_id)
  if (existing) return c.json({ error: 'Already a member' }, 409)
  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role })
    .returning()
  return c.json(member, 201)
})

// DELETE /:id/members/:memberId — remove member (owner only) -----------------
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!member) return c.json({ error: 'Not found' }, 404)
  if (member.user_id === ws.owner_id) return c.json({ error: 'Cannot remove the workspace owner' }, 400)
  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  return c.json({ success: true })
})

export default router
