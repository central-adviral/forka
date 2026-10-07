import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import type { ClientRole } from '@/lib/repo/client-access-repo'
import { addMember, changeMemberRole, removeMember } from './actions'

interface Member {
  user_id: string
  email: string
  role: ClientRole
  created_at: string
}

const ROLE_OPTIONS: { value: ClientRole; label: string; help: string }[] = [
  { value: 'owner', label: 'Owner', help: 'tudo, inclusive integrações e membros' },
  { value: 'gestor', label: 'Gestor', help: 'cria e edita testes e projetos' },
  { value: 'analista', label: 'Analista', help: 'vê tudo, não altera' },
  { value: 'cliente', label: 'Cliente', help: 'acesso de leitura do cliente' },
]

const fieldClass =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  const { clientSlug } = await params
  const { ok, erro } = await searchParams
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  // list_client_members refuses anyone below owner, which is also the rule for this whole screen.
  const { data: members, error } = (await supabase.rpc('list_client_members', { p_client_id: client.id })) as {
    data: Member[] | null
    error: unknown
  }
  if (error || !members) notFound()

  const context = { client_id: client.id, client_slug: client.slug }

  return (
    <div className="flex max-w-[960px] flex-col gap-10 px-14 pb-24 pt-12">
      <div>
        <span className="font-[family-name:var(--font-geist-mono)] text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ct-text-3)]">
          Configurar
        </span>
        <h1 className="mt-2.5 text-[30px] font-semibold tracking-[-0.04em]">Membros</h1>
        <p className="mt-2 text-sm text-[var(--ct-text-2)]">
          Quem acessa {client.name} e o que cada pessoa pode fazer. Outros clientes continuam invisíveis para elas.
        </p>
      </div>

      {ok && (
        <p role="status" className="rounded-[10px] bg-[var(--ct-an-soft)] px-4 py-3 text-[13px] text-[var(--ct-an)]">
          {ok}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {erro}
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-6">
        <h2 className="text-[15px] font-semibold">Adicionar pessoa</h2>
        <form action={addMember.bind(null, context)} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            E-mail
            <input name="email" type="email" required placeholder="nome@empresa.com" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Papel
            <select name="role" defaultValue="analista" className={fieldClass}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.help}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110"
          >
            Adicionar
          </button>
        </form>
        <p className="text-xs text-[var(--ct-text-3)]">
          Se a pessoa ainda não tem conta, ela recebe um convite por e-mail para criar a senha.
        </p>
      </section>

      <section className="overflow-hidden rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left font-[family-name:var(--font-geist-mono)] text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]">
              <th className="px-5 py-3.5 font-medium">Pessoa</th>
              <th className="px-5 py-3.5 font-medium">Papel</th>
              <th className="px-5 py-3.5 font-medium">Desde</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const memberContext = { ...context, user_id: member.user_id }
              const isSelf = member.user_id === user?.id
              return (
                <tr key={member.user_id} className="border-t border-[var(--ct-line)]">
                  <td className="px-5 py-3.5">
                    <b className="font-medium">{member.email}</b>
                    {isSelf && <span className="ml-2 text-[11.5px] text-[var(--ct-text-3)]">você</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <form action={changeMemberRole.bind(null, memberContext)} className="flex items-center gap-2">
                      <select name="role" defaultValue={member.role} className={fieldClass} aria-label={`Papel de ${member.email}`}>
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="text-xs font-medium text-[var(--ct-accent)] hover:underline">
                        Salvar
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-3.5 font-[family-name:var(--font-geist-mono)] text-[12px] text-[var(--ct-text-3)]">
                    {new Date(member.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <ConfirmDeleteButton
                      action={removeMember.bind(null, memberContext)}
                      label="Remover"
                      warning={isSelf ? 'Remover seu próprio acesso?' : 'Remover acesso?'}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
