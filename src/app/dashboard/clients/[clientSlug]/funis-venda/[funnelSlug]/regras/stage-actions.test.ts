import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  gestor: true,
  archived: null as string | null,
  calls: [] as unknown[][],
  archiveError: null as string | null,
  presetCount: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: { id: '00000000-0000-4000-8000-0000000000aa' }, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ count: state.presetCount, error: null }),
      }
      return builder
    },
  }),
}))
vi.mock('@/lib/view-as', () => ({ canActAs: async () => state.gestor }))
vi.mock('@/lib/repo/project-archive-repo', () => ({ archivedProjectError: async () => state.archived }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/repo/funnel-stages-repo', () => {
  const record =
    (name: string, result?: () => unknown) =>
    async (...args: unknown[]) => {
      state.calls.push([name, ...args.slice(1)])
      return result?.()
    }
  return {
    createStage: record('createStage', () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
    reorderStages: record('reorderStages'),
    updateStage: record('updateStage'),
    setStageArchived: async (...args: unknown[]) => {
      state.calls.push(['setStageArchived', ...args.slice(1)])
      if (state.archiveError) throw new Error(state.archiveError)
    },
    moveFrontToStage: record('moveFrontToStage'),
    createCostCombo: record('createCostCombo'),
    updateCostCombo: record('updateCostCombo'),
    deleteCostCombo: record('deleteCostCombo'),
    createStagePreset: record('createStagePreset'),
    deleteStagePreset: record('deleteStagePreset'),
  }
})

import { addStage, archiveStage, placeStageAction, saveCombo, savePreset, saveStage } from './stage-actions'

const context = { client_id: 'c-1', client_slug: 'voe', funnel_slug: 't15', sales_funnel_id: 'f-1' }
const CAP = '11111111-1111-4111-8111-111111111111'
const VND = '22222222-2222-4222-8222-222222222222'
const fields = { name: 'Captação', tag: 'cap', measure: 'lead' as const, meta: '6,50', metaRoas: '', janelaInicio: '', janelaFim: '' }

describe('stage actions', () => {
  beforeEach(() => {
    state.gestor = true
    state.archived = null
    state.calls = []
    state.archiveError = null
    state.presetCount = 0
  })

  it('creates the dropped stage and saves the lane order with its new id', async () => {
    const result = await addStage(context, { name: 'Vendas', tag: 'vnd', measure: 'compra', parallel: false, order: [CAP, 'new'] })
    expect(result).toEqual({ error: null, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    expect(state.calls[0]).toEqual(['createStage', 'f-1', expect.objectContaining({ name: 'Vendas', tag: 'VND', position: 1, parallel: false })])
    expect(state.calls[1]).toEqual(['reorderStages', 'f-1', [CAP, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']])
  })

  it('refuses an analista and an archived project before writing', async () => {
    state.gestor = false
    expect(await saveStage(context, CAP, fields)).toEqual({ error: 'Só gestor ou owner pode mudar as etapas.' })
    state.gestor = true
    state.archived = 'Funil arquivado: restaure para editar.'
    expect(await placeStageAction(context, CAP, true, [CAP])).toEqual({ error: 'Funil arquivado: restaure para editar.' })
    expect(state.calls).toEqual([])
  })

  it('reads pt-BR metas, the ascension rate in % and drops ROAS off a non-sale stage', async () => {
    expect(await saveStage(context, CAP, { ...fields, metaRoas: '2' })).toEqual({ error: null })
    expect(state.calls[0]).toEqual(['updateStage', CAP, expect.objectContaining({ tag: 'CAP', meta: 6.5, metaRoas: null, janelaInicio: null })])
    await saveStage(context, CAP, { ...fields, measure: 'ascensao', meta: '8' })
    expect(state.calls[1]).toEqual(['updateStage', CAP, expect.objectContaining({ measure: 'ascensao', meta: 0.08 })])
  })

  it('refuses a bad meta or a window that ends before it starts', async () => {
    expect((await saveStage(context, CAP, { ...fields, meta: '-1' })).error).toMatch(/maior que zero/)
    expect((await saveStage(context, CAP, { ...fields, janelaInicio: '2026-10-10', janelaFim: '2026-10-01' })).error).toMatch(/fim da janela/)
    expect(state.calls).toEqual([])
  })

  it('passes the database refusal of a stage with active fronts', async () => {
    state.archiveError = 'A etapa ainda tem frentes ativas: mova ou arquive as frentes antes.'
    expect(await archiveStage(context, CAP, true)).toEqual({ error: 'A etapa ainda tem frentes ativas: mova ou arquive as frentes antes.' })
  })

  it('needs a stage to sum and a stage to divide by in a combo', async () => {
    const combo = { name: 'CPA do lançamento', enabled: true, stageIds: [CAP, VND], over: 'stage' as const, overStageId: VND, meta: '' }
    expect((await saveCombo(context, null, { ...combo, stageIds: [] }, 0)).error).toMatch(/ao menos uma etapa/)
    expect((await saveCombo(context, null, { ...combo, overStageId: null }, 0)).error).toMatch(/etapa que divide/)
    expect(await saveCombo(context, null, { ...combo, over: 'receita' }, 2)).toEqual({ error: null })
    expect(state.calls[0]).toEqual(['createCostCombo', 'f-1', expect.objectContaining({ over: 'receita', overStageId: null, position: 2 })])
  })

  it('turns the default palette into the client list before saving a stage into it', async () => {
    await savePreset(context, { name: 'Lembrete', tag: 'LEMB', measure: 'alcance', parallel: false })
    const presets = state.calls.filter((call) => call[0] === 'createStagePreset')
    expect(presets.length).toBe(8)
    expect(presets.at(-1)).toEqual(['createStagePreset', 'c-1', expect.objectContaining({ name: 'Lembrete' })])
  })
})
