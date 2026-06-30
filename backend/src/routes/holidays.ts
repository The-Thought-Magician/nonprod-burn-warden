import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { holiday_calendars, holidays, workspace_members } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

// ---------------------------------------------------------------------------
// Standard holiday sets (fixed-date public holidays). Year is substituted in at
// seed time. Movable feasts (e.g. Thanksgiving, UK bank holidays) are computed.
// ---------------------------------------------------------------------------

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  // month is 1-based. weekday: 0=Sun..6=Sat. n is 1-based occurrence.
  const first = new Date(Date.UTC(year, month - 1, 1))
  const firstWeekday = first.getUTCDay()
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0))
  const lastDay = last.getUTCDate()
  const lastWeekday = last.getUTCDay()
  const day = lastDay - ((lastWeekday - weekday + 7) % 7)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fixed(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function standardHolidaySet(region: string, year: number): Array<{ name: string; date: string }> {
  const r = region.toUpperCase()
  if (r === 'UK' || r === 'GB') {
    return [
      { name: "New Year's Day", date: fixed(year, 1, 1) },
      { name: 'Good Friday', date: goodFriday(year) },
      { name: 'Early May Bank Holiday', date: nthWeekdayOfMonth(year, 5, 1, 1) },
      { name: 'Spring Bank Holiday', date: lastWeekdayOfMonth(year, 5, 1) },
      { name: 'Summer Bank Holiday', date: lastWeekdayOfMonth(year, 8, 1) },
      { name: 'Christmas Day', date: fixed(year, 12, 25) },
      { name: 'Boxing Day', date: fixed(year, 12, 26) },
    ]
  }
  // Default: US federal holidays.
  return [
    { name: "New Year's Day", date: fixed(year, 1, 1) },
    { name: 'Martin Luther King Jr. Day', date: nthWeekdayOfMonth(year, 1, 1, 3) },
    { name: "Presidents' Day", date: nthWeekdayOfMonth(year, 2, 1, 3) },
    { name: 'Memorial Day', date: lastWeekdayOfMonth(year, 5, 1) },
    { name: 'Juneteenth', date: fixed(year, 6, 19) },
    { name: 'Independence Day', date: fixed(year, 7, 4) },
    { name: 'Labor Day', date: nthWeekdayOfMonth(year, 9, 1, 1) },
    { name: 'Columbus Day', date: nthWeekdayOfMonth(year, 10, 1, 2) },
    { name: 'Veterans Day', date: fixed(year, 11, 11) },
    { name: 'Thanksgiving', date: nthWeekdayOfMonth(year, 11, 4, 4) },
    { name: 'Christmas Day', date: fixed(year, 12, 25) },
  ]
}

// Anonymous Gregorian (Meeus/Jones/Butcher) algorithm for Easter Sunday, then
// subtract 2 days for Good Friday.
function goodFriday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  const easter = new Date(Date.UTC(year, month - 1, day))
  const gf = new Date(easter.getTime() - 2 * 86_400_000)
  return `${gf.getUTCFullYear()}-${String(gf.getUTCMonth() + 1).padStart(2, '0')}-${String(
    gf.getUTCDate(),
  ).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

const calendarSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().optional().default(''),
})

// GET /calendars — list calendars by workspace_id (+ holiday_count).
router.get('/calendars', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const cals = await db
    .select()
    .from(holiday_calendars)
    .where(eq(holiday_calendars.workspace_id, workspaceId))
    .orderBy(holiday_calendars.created_at)

  const allHolidays = await db
    .select({ holiday_calendar_id: holidays.holiday_calendar_id })
    .from(holidays)
    .where(eq(holidays.workspace_id, workspaceId))

  const counts = new Map<string, number>()
  for (const h of allHolidays) {
    counts.set(h.holiday_calendar_id, (counts.get(h.holiday_calendar_id) ?? 0) + 1)
  }

  return c.json(cals.map((cal) => ({ ...cal, holiday_count: counts.get(cal.id) ?? 0 })))
})

// POST /calendars — create calendar.
router.post('/calendars', authMiddleware, zValidator('json', calendarSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [cal] = await db
    .insert(holiday_calendars)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      region: body.region,
      created_by: userId,
    })
    .returning()
  return c.json(cal, 201)
})

// DELETE /calendars/:id — delete calendar + its holidays.
router.delete('/calendars/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [cal] = await db.select().from(holiday_calendars).where(eq(holiday_calendars.id, id))
  if (!cal) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(cal.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(holidays).where(eq(holidays.holiday_calendar_id, id))
  await db.delete(holiday_calendars).where(eq(holiday_calendars.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

const holidaySchema = z.object({
  holiday_calendar_id: z.string().min(1),
  name: z.string().min(1),
  date: z.string().min(1),
  is_full_day: z.boolean().optional().default(true),
})

// GET / — list holidays by holiday_calendar_id.
router.get('/', async (c) => {
  const calendarId = c.req.query('holiday_calendar_id')
  if (!calendarId) return c.json({ error: 'holiday_calendar_id is required' }, 400)
  const rows = await db
    .select()
    .from(holidays)
    .where(eq(holidays.holiday_calendar_id, calendarId))
    .orderBy(holidays.date)
  return c.json(rows)
})

// POST / — add holiday to a calendar.
router.post('/', authMiddleware, zValidator('json', holidaySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [cal] = await db
    .select()
    .from(holiday_calendars)
    .where(eq(holiday_calendars.id, body.holiday_calendar_id))
  if (!cal) return c.json({ error: 'Calendar not found' }, 404)
  if (!(await isMember(cal.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [h] = await db
    .insert(holidays)
    .values({
      workspace_id: cal.workspace_id,
      holiday_calendar_id: body.holiday_calendar_id,
      name: body.name,
      date: body.date,
      is_full_day: body.is_full_day,
    })
    .returning()
  return c.json(h, 201)
})

// DELETE /:id — delete a holiday.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [h] = await db.select().from(holidays).where(eq(holidays.id, id))
  if (!h) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(h.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(holidays).where(eq(holidays.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /seed-standard — seed a standard holiday set (US/UK) into a calendar.
// Skips dates already present so it is idempotent.
// ---------------------------------------------------------------------------

const seedSchema = z.object({
  holiday_calendar_id: z.string().min(1),
  region: z.string().optional().default('US'),
  year: z.number().int().optional(),
})

router.post('/seed-standard', authMiddleware, zValidator('json', seedSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [cal] = await db
    .select()
    .from(holiday_calendars)
    .where(eq(holiday_calendars.id, body.holiday_calendar_id))
  if (!cal) return c.json({ error: 'Calendar not found' }, 404)
  if (!(await isMember(cal.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const year = body.year ?? new Date().getUTCFullYear()
  const set = standardHolidaySet(body.region ?? 'US', year)

  const existing = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(eq(holidays.holiday_calendar_id, body.holiday_calendar_id))
  const existingDates = new Set(existing.map((e) => e.date))

  const toInsert = set
    .filter((h) => !existingDates.has(h.date))
    .map((h) => ({
      workspace_id: cal.workspace_id,
      holiday_calendar_id: body.holiday_calendar_id,
      name: h.name,
      date: h.date,
      is_full_day: true,
    }))

  if (toInsert.length > 0) {
    await db.insert(holidays).values(toInsert)
  }

  return c.json({ created: toInsert.length })
})

export default router
