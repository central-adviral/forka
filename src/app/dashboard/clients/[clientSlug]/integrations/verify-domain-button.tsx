'use client'

import { useActionState } from 'react'

export function VerifyDomainButton({
  verifyAction,
}: {
  verifyAction: () => Promise<{ verified: boolean }>
}) {
  const [result, formAction, isPending] = useActionState<{ verified: boolean } | null>(
    () => verifyAction(),
    null
  )

  return (
    <div>
      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-[10px] border border-white/[0.08] px-4 py-2.5 text-sm font-medium text-[#8A90A6] disabled:opacity-50"
        >
          {isPending ? 'Verificando...' : 'Verificar'}
        </button>
      </form>
      {result && !isPending && (
        <p className={`mt-2 text-xs ${result.verified ? 'text-[#2DD4A8]' : 'text-[#F5B94D]'}`}>
          {result.verified
            ? 'Domínio verificado!'
            : 'Ainda não encontrado — confira o registro CNAME e tente de novo em alguns minutos.'}
        </p>
      )}
    </div>
  )
}
