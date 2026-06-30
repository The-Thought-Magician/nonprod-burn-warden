'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

export default function SignUp() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signUp.email({
      name: fd.get('name') as string,
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Failed')
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-2xl font-black text-yellow-400">
            <span>🔥</span> NonprodBurnWarden
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-zinc-100">Create your account</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
          {error && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Name</label>
            <input
              name="name"
              type="text"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-100 focus:border-yellow-500 focus:outline-none"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-100 focus:border-yellow-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-100 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-yellow-400 py-3 font-semibold text-zinc-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
          <p className="text-center text-sm text-zinc-400">
            Already have an account?{' '}
            <Link href="/auth/sign-in" className="text-yellow-400 hover:text-yellow-300">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
