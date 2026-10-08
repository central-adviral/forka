// A project holds one active test per layer (0078): the database refuses the second one. This turns
// that refusal into what the gestor needs to do; any other error passes through unchanged.
export function layerConflict(error: { code?: string; message?: string }): Error | null {
  if (error.code !== '23505' || !error.message?.includes('tests_one_active_per_layer')) return null
  return new Error(
    'Este projeto já tem um teste ativo do mesmo tipo. Dois testes de página (ou dois de checkout) no mesmo projeto dividiriam a mesma venda: pause o outro ou junte as variantes num teste só.'
  )
}
