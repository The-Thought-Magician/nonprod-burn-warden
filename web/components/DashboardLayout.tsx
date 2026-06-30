'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Environments', href: '/dashboard/environments' },
      { label: 'Resources', href: '/dashboard/resources' },
      { label: 'Cloud Accounts', href: '/dashboard/accounts' },
    ],
  },
  {
    title: 'Classification',
    items: [
      { label: 'Naming Rules', href: '/dashboard/rules' },
      { label: 'Tag Rules', href: '/dashboard/tag-rules' },
    ],
  },
  {
    title: 'Waste Analysis',
    items: [
      { label: 'Idle Analysis', href: '/dashboard/idle' },
      { label: 'Waste Ledger', href: '/dashboard/ledger' },
      { label: 'Orphans', href: '/dashboard/orphans' },
    ],
  },
  {
    title: 'Savings',
    items: [
      { label: 'Schedules', href: '/dashboard/schedules' },
      { label: 'Savings Calculator', href: '/dashboard/savings' },
      { label: 'Recommendations', href: '/dashboard/recommendations' },
    ],
  },
  {
    title: 'FinOps',
    items: [
      { label: 'Teams', href: '/dashboard/teams' },
      { label: 'Budgets', href: '/dashboard/budgets' },
      { label: 'Showback', href: '/dashboard/showback' },
      { label: 'Holidays', href: '/dashboard/holidays' },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { label: 'Recovery Reports', href: '/dashboard/reports' },
      { label: 'Activity Log', href: '/dashboard/activity' },
    ],
  },
  {
    title: 'Data & Settings',
    items: [
      { label: 'Imports', href: '/dashboard/imports' },
      { label: 'Alerts', href: '/dashboard/alerts' },
      { label: 'Saved Views', href: '/dashboard/views' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('Workspace')

  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!active) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      const u = s.data.user as { name?: string; email?: string }
      setWorkspaceName(u.name || u.email || 'Workspace')
      setReady(true)
    })()
    return () => {
      active = false
    }
  }, [router])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-yellow-400" />
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <span className="text-lg">🔥</span>
        <span className="text-sm font-bold tracking-tight text-zinc-100">NonprodBurnWarden</span>
      </Link>
      <div className="flex flex-col gap-5">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              {section.title}
            </div>
            <div className="flex flex-col">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-yellow-400/10 font-medium text-yellow-300'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-900/40 lg:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-zinc-800 bg-zinc-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <span className="block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
            </button>
            <span className="text-sm font-medium text-zinc-300">{workspaceName}</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
