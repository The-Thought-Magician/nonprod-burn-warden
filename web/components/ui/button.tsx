import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500/60 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-yellow-400 text-zinc-950 hover:bg-yellow-300',
    secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700',
    ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export default Button
