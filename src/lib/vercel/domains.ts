const PROJECT_ID = 'prj_mXHPOPfVsDVmNveh0CrRmS5Q2HHi'
const TEAM_ID = 'team_GqEnlI2jfS1sjKsEkbm8pEeD'
const API_BASE = 'https://api.vercel.com'

interface VercelErrorResponse {
  error?: { code?: string; message?: string }
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

export async function addProjectDomain(domain: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`${API_BASE}/v10/projects/${PROJECT_ID}/domains?teamId=${TEAM_ID}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: domain }),
  })
  if (response.ok) return { ok: true }

  const body = (await response.json().catch(() => ({}))) as VercelErrorResponse
  // 400 aqui é a própria Vercel dizendo que o domínio já está neste projeto — não é erro de verdade.
  if (response.status === 400 && body.error?.message?.toLowerCase().includes('already exists')) {
    return { ok: true }
  }
  return { ok: false, error: body.error?.message ?? `Vercel recusou o domínio (status ${response.status})` }
}

export async function removeProjectDomain(domain: string): Promise<void> {
  const response = await fetch(`${API_BASE}/v9/projects/${PROJECT_ID}/domains/${domain}?teamId=${TEAM_ID}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  // Best-effort: 404 (já não existe) ou qualquer outra falha aqui não deve travar a troca de domínio,
  // que já foi confirmada com sucesso do lado do domínio novo.
  if (!response.ok && response.status !== 404) {
    console.error(`Falha ao remover domínio antigo "${domain}" da Vercel (status ${response.status})`)
  }
}
