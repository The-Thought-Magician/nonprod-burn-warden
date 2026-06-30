interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-yellow-400" />
      {label && <span className="text-sm text-zinc-400">{label}</span>}
    </div>
  )
}

export function PageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export default Spinner
