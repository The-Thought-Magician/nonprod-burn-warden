import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NonprodBurnWarden',
  description: 'Find and recover wasted non-production cloud spend from idle and orphaned resources.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
