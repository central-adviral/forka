import { createClient } from '../actions'

export default function NewClientPage() {
  return (
    <form action={createClient} className="max-w-md space-y-4">
      <h1 className="text-lg font-semibold">Novo cliente</h1>
      <input name="name" required placeholder="Nome" className="w-full rounded border px-3 py-2" />
      <input
        name="slug"
        required
        placeholder="slug (ex: nicho-fitness)"
        pattern="[a-z0-9-]+"
        className="w-full rounded border px-3 py-2"
      />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        Criar
      </button>
    </form>
  )
}
