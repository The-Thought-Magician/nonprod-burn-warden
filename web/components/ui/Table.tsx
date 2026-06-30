import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes } from 'react'

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className={`w-full text-left text-sm ${className}`}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-zinc-800">{children}</tbody>
}

export function TR({ children, className = '', ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`hover:bg-zinc-900/50 ${className}`} {...props}>
      {children}
    </tr>
  )
}

export function TH({ children, className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`px-4 py-3 font-medium ${className}`} {...props}>
      {children}
    </th>
  )
}

export function TD({ children, className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 text-zinc-300 ${className}`} {...props}>
      {children}
    </td>
  )
}

export default Table
