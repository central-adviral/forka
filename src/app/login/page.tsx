'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const supabase = createBrowserSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0E1A]">
      <div className="w-[400px] rounded-2xl border border-white/[0.08] bg-[#141829] p-10">
        <h1 className="mb-2 font-['Space_Grotesk'] text-2xl font-semibold text-[#E8EAF2]">Entrar</h1>
        <p className="mb-7 text-sm leading-relaxed text-[#8A90A6]">
          Acesse seus clientes, testes e relatórios de conversão.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-[13px] font-medium text-[#8A90A6]">E-mail</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-[13px] font-medium text-[#8A90A6]">Senha</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
            />
          </div>
          {error && <p className="text-sm text-[#F76C6C]">{error}</p>}
          <button
            type="submit"
            className="mt-1.5 h-[46px] rounded-[10px] bg-[#7C6FF0] text-sm font-semibold text-[#0B0E1A]"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
