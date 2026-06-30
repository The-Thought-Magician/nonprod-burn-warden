import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'warning' | 'danger' | 'success' | 'info'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  warning: 'bg-yellow-400/10 text-yellow-300 border-yellow-500/40',
  danger: 'bg-red-500/10 text-red-300 border-red-500/40',
  success: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
  info: 'bg-sky-500/10 text-sky-300 border-sky-500/40',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
