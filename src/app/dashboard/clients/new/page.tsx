import { createClient } from '../actions'

export default function NewClientPage() {
  return (
    <div className="p-8">
      <form action={createClient} className="max-w-md space-y-4">
        <h1 className="mb-2 font-[family-name:var(--font-sora)] text-lg font-semibold">Novo cliente</h1>
        <input
          name="name"
          required
          placeholder="Nome"
          className="w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]"
        />
        <input
          name="slug"
          required
          placeholder="slug (ex: nicho-fitness)"
          pattern="[a-z0-9-]+"
          className="w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]"
        />
        <p className="text-xs text-[var(--ct-text-2)]">
          Vira parte da URL interna do cliente — use letras minúsculas e hífen (ex: gustavo-voe)
        </p>
        <button type="submit" className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]">
          Criar
        </button>
      </form>
    </div>
  )
}
