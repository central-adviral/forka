'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

// Landing page of the invite e-mail. Supabase sends the invitee here with the session in the URL
// fragment; the browser client reads it on startup, and the person picks a password.
export default function SetPasswordPage() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Only the tokens in this link count. Whatever session the browser already holds belongs to
    // whoever was signed in before -- setting a password on it would change the wrong account.
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const accessToken = fragment.get('access_token')
    const refreshToken = fragment.get('refresh_token')
    window.history.replaceState(null, '', window.location.pathname)
    const invitee =
      accessToken && refreshToken
        ? createBrowserSupabaseClient()
            .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
            .then(({ data, error }) => (error ? null : data.user))
        : Promise.resolve(null)
    invitee.then((user) => {
      setEmail(user?.email ?? '')
      setReady(user ? 'ok' : 'invalid')
    })
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
    if (password !== confirm) return setError('As duas senhas não são iguais.')
    setSaving(true)
    const { error } = await createBrowserSupabaseClient().auth.updateUser({ password })
    setSaving(false)
    if (error) return setError(error.message)
    router.push('/dashboard')
  }

  const inputClass =
    'h-11 rounded-[10px] border border-white/[0.08] bg-[#111114] px-3.5 text-sm text-[#EDEDF0] outline-none focus:border-[#8B9BFF]'

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#000000]">
      <div className="w-[400px] rounded-2xl border border-white/[0.08] bg-[#0A0A0C] p-10">
        <h1 className="mb-2 text-2xl font-semibold text-[#EDEDF0]">Criar sua senha</h1>
        {ready === 'checking' && <p className="text-sm text-[#A1A1AA]">Validando o convite…</p>}
        {ready === 'invalid' && (
          <p className="text-sm leading-relaxed text-[#A1A1AA]">
            Este link de convite expirou ou já foi usado. Peça um novo convite a quem administra a Central, ou{' '}
            <a href="/login" className="text-[#8B9BFF]">entre com sua senha</a>.
          </p>
        )}
        {ready === 'ok' && (
          <>
            <p className="mb-7 text-sm leading-relaxed text-[#A1A1AA]">
              Você foi convidado para a Central de Tráfego{email ? ` como ${email}` : ''}. Defina uma senha para entrar.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="password" className="text-[13px] font-medium text-[#A1A1AA]">Senha</label>
                <input id="password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="confirm" className="text-[13px] font-medium text-[#A1A1AA]">Repita a senha</label>
                <input id="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
              </div>
              {error && <p className="text-sm text-[#FF7A73]">{error}</p>}
              <button type="submit" disabled={saving} className="mt-1.5 h-[46px] rounded-[10px] bg-[#8B9BFF] text-sm font-semibold text-[#000000] disabled:opacity-60">
                {saving ? 'Salvando…' : 'Salvar e entrar'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
