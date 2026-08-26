import { createClient } from '../actions'

export default function NewClientPage() {
  return (
    <div className="p-8">
      <form action={createClient} className="max-w-md space-y-4">
        <h1 className="mb-2 font-['Space_Grotesk'] text-lg font-semibold">Novo cliente</h1>
        <input
          name="name"
          required
          placeholder="Nome"
          className="w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
        />
        <input
          name="slug"
          required
          placeholder="slug (ex: nicho-fitness)"
          pattern="[a-z0-9-]+"
          className="w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
        />
        <button type="submit" className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]">
          Criar
        </button>
      </form>
    </div>
  )
}
