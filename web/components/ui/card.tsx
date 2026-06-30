import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Card({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`px-5 py-4 border-b border-zinc-800 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardBody({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`px-5 py-4 ${className}`} {...props}>
      {children}
    </div>
  )
}

export default Card
