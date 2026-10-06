export const PRODUCT_ROLES = ['entrada', 'order_bump', 'upsell', 'ascensao'] as const
export type ProductRole = (typeof PRODUCT_ROLES)[number]

export const PRODUCT_ROLE_LABEL: Record<ProductRole, string> = {
  entrada: 'Entrada',
  order_bump: 'Order bump',
  upsell: 'Upsell / downsell',
  ascensao: 'Ascensão',
}

export const PRODUCT_ROLE_HINT: Record<ProductRole, string> = {
  entrada: 'base do CPA',
  order_bump: 'faturamento e ROAS front',
  upsell: 'faturamento e ROAS front',
  ascensao: 'ROAS próprio, ao lado do front',
}
