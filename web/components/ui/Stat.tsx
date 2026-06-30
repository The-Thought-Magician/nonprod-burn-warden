import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'warning' | 'danger' | 'success'
  className?: string
}

const valueTones = {
  default: 'text-zinc-100',
  warning: 'text-yellow-300',
  danger: 'text-red-300',
  success: 'text-emerald-300',
}

export function Stat({ label, value, sub, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueTones[tone]}`}>{value}</div>
      {sub != null && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}

export default Stat
