import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { environment_rules, resources, tag_rules, workspace_members } from '../db/schema.js'
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

// match_type values supported against the resource's `name`.
const MATCH_TYPES = [
  'contains',
  'prefix',
  'suffix',
  'exact',
  'regex',
  'glob',
] as const

function matchesPattern(matchType: string, pattern: string, name: string): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  const p = (pattern ?? '').toLowerCase()
  switch (matchType) {
    case 'contains':
      return n.includes(p)
    case 'prefix':
      return n.startsWith(p)
    case 'suffix':
      return n.endsWith(p)
    case 'exact':
      return n === p
    case 'glob': {
      // translate a simple glob (* and ?) to a regex
      const escaped = (pattern ?? '')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      try {
        return new RegExp(`^${escaped}$`, 'i').test(name)
      } catch {
        return false
      }
    }
    case 'regex': {
      try {
        return new RegExp(pattern, 'i').test(name)
      } catch {
        return false
      }
    }
    default:
      // unknown match types fall back to substring matching
      return n.includes(p)
  }
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  env_kind: z.string().min(1),
  match_type: z.enum(MATCH_TYPES),
  pattern: z.string().min(1),
  priority: z.number().int().optional().default(100),
  is_active: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  env_kind: z.string().min(1).optional(),
  match_type: z.enum(MATCH_TYPES).optional(),
  pattern: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

const previewSchema = z.object({
  workspace_id: z.string().min(1),
  match_type: z.enum(MATCH_TYPES),
  pattern: z.string().min(1),
})

const applySchema = z.object({
  workspace_id: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET / — list by workspace_id
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(environment_rules)
    .where(eq(environment_rules.workspace_id, workspaceId))
    .orderBy(asc(environment_rules.priority), desc(environment_rules.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — create
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [rule] = await db
    .insert(environment_rules)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      env_kind: body.env_kind,
      match_type: body.match_type,
      pattern: body.pattern,
      priority: body.priority,
      is_active: body.is_active,
      created_by: userId,
    })
    .returning()
  return c.json(rule, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(environment_rules).where(eq(environment_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(environment_rules)
    .set(body)
    .where(eq(environment_rules.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(environment_rules).where(eq(environment_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(environment_rules).where(eq(environment_rules.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /preview — which resources would a candidate rule match
// ---------------------------------------------------------------------------

router.post('/preview', authMiddleware, zValidator('json', previewSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const all = await db.select().from(resources).where(eq(resources.workspace_id, body.workspace_id))
  const matched = all.filter((r) => matchesPattern(body.match_type, body.pattern, r.name))
  return c.json({ matched, count: matched.length })
})

// ---------------------------------------------------------------------------
// POST /apply — run all active rules, (re)classify resources, report gaps
//
// Rules are applied in priority order (lower priority number = applied first /
// wins). Tag rules are also consulted: a tag rule match takes precedence over a
// name rule because tags are an explicit owner signal (higher confidence).
// ---------------------------------------------------------------------------

router.post('/apply', authMiddleware, zValidator('json', applySchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const envRules = await db
    .select()
    .from(environment_rules)
    .where(and(eq(environment_rules.workspace_id, workspace_id), eq(environment_rules.is_active, true)))
    .orderBy(asc(environment_rules.priority))

  const tagRulesActive = await db
    .select()
    .from(tag_rules)
    .where(and(eq(tag_rules.workspace_id, workspace_id), eq(tag_rules.is_active, true)))
    .orderBy(asc(tag_rules.priority))

  const allResources = await db.select().from(resources).where(eq(resources.workspace_id, workspace_id))

  const envHitCounts = new Map<string, number>()
  const tagHitCounts = new Map<string, number>()

  let classified = 0
  let updated = 0
  const gaps: Array<{ id: string; name: string; resource_type: string }> = []

  for (const r of allResources) {
    let chosenKind: string | null = null
    let source: string | null = null
    let confidence = 0

    // 1) tag rules (highest confidence)
    const tags = (r.tags ?? {}) as Record<string, string>
    for (const tr of tagRulesActive) {
      const v = tags[tr.tag_key]
      if (v === undefined) continue
      // empty configured tag_value means "any value present"
      if (tr.tag_value === '' || tr.tag_value === '*' || v.toLowerCase() === tr.tag_value.toLowerCase()) {
        chosenKind = tr.env_kind
        source = 'tag_rule'
        confidence = 0.95
        tagHitCounts.set(tr.id, (tagHitCounts.get(tr.id) ?? 0) + 1)
        break
      }
    }

    // 2) name/pattern rules
    if (!chosenKind) {
      for (const rule of envRules) {
        if (matchesPattern(rule.match_type, rule.pattern, r.name)) {
          chosenKind = rule.env_kind
          source = 'name_rule'
          confidence = 0.8
          envHitCounts.set(rule.id, (envHitCounts.get(rule.id) ?? 0) + 1)
          break
        }
      }
    }

    if (!chosenKind) {
      // unclassified — only counts as a gap if it has not been manually set
      if (r.classification_source !== 'manual') {
        gaps.push({ id: r.id, name: r.name, resource_type: r.resource_type })
      }
      continue
    }

    classified++

    // never override a manual classification
    if (r.classification_source === 'manual') continue

    if (r.env_kind !== chosenKind || r.classification_source !== source) {
      await db
        .update(resources)
        .set({
          env_kind: chosenKind,
          classification_source: source!,
          classification_confidence: confidence,
        })
        .where(eq(resources.id, r.id))
      updated++
    }
  }

  // persist hit counts
  for (const [id, count] of envHitCounts) {
    await db.update(environment_rules).set({ hit_count: count }).where(eq(environment_rules.id, id))
  }
  for (const id of envRules.map((r) => r.id)) {
    if (!envHitCounts.has(id)) {
      await db.update(environment_rules).set({ hit_count: 0 }).where(eq(environment_rules.id, id))
    }
  }
  for (const [id, count] of tagHitCounts) {
    await db.update(tag_rules).set({ hit_count: count }).where(eq(tag_rules.id, id))
  }

  return c.json({
    classified,
    updated,
    gaps,
    gap_count: gaps.length,
    total_resources: allResources.length,
  })
})

export default router
