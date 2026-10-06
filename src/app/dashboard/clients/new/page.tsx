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
          className="w-full rounded-[10px] border border-white/[0.08] bg-[#111114] px-3.5 py-2.5 text-sm text-[#EDEDF0] placeholder:text-[#A1A1AA] outline-none focus:border-[#8B9BFF]"
        />
        <input
          name="slug"
          required
          placeholder="slug (ex: nicho-fitness)"
          pattern="[a-z0-9-]+"
          className="w-full rounded-[10px] border border-white/[0.08] bg-[#111114] px-3.5 py-2.5 text-sm text-[#EDEDF0] placeholder:text-[#A1A1AA] outline-none focus:border-[#8B9BFF]"
        />
        <p className="text-xs text-[#A1A1AA]">
          Vira parte da URL interna do cliente — use letras minúsculas e hífen (ex: gustavo-voe)
        </p>
        <button type="submit" className="rounded-[10px] bg-[#8B9BFF] px-4 py-2.5 text-sm font-semibold text-[#000000]">
          Criar
        </button>
      </form>
    </div>
  )
}
