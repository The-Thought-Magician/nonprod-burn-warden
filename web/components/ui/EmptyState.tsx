import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-6 py-14 text-center ${className}`}
    >
      {icon && <div className="mb-3 text-3xl text-zinc-600">{icon}</div>}
      <h3 className="text-base font-semibold text-zinc-200">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default EmptyState
