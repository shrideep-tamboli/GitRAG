"use client"

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import Button from '@/components/ui/button'

export function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { signIn, signInWithProvider } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await signIn(email, password)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    }
  }

  const handleProviderSignIn = async (provider: 'google' | 'github') => {
    try {
      await signInWithProvider(provider)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-red-500">{error}</div>}
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full p-2 border rounded text-black"
          required
        />
      </div>
      <div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full p-2 border rounded text-black"
          required
        />
      </div>

      <div className="flex flex-col gap-4 mt-4">
        <Button
          type="button"
          className="w-full text-black"
          onClick={() => handleProviderSignIn('google')}
        >
          Sign In with Google
        </Button>
        <Button
          type="button"
          className="w-full text-black"
          onClick={() => handleProviderSignIn('github')}
        >
          Sign In with GitHub
        </Button>
      </div>
    </form>
  )
} 