import { describe, it, expect } from 'vitest'
import { readDataHealth, type DataHealthRow } from './data-health'

const row: DataHealthRow = {
  traceable_sales: 47,
  counted_sales: 45,
  recovered: 2,
  refunds: 1,
  median_delay_seconds: 70,
  clicks: 600,
  bot_clicks: 26,
  rate_limited_clicks: 3,
  buyers: 40,
  buyers_in_other_tests: 12,
  client_untracked_payments: 5,
}

describe('readDataHealth', () => {
  it('reads the share of traceable sales that reached the test', () => {
    const [coverage] = readDataHealth(row)
    expect(coverage).toMatchObject({ value: '96%', tone: 'ok' })
    expect(readDataHealth({ ...row, counted_sales: 40 })[0].tone).toBe('warn')
    expect(readDataHealth({ ...row, counted_sales: 30 })[0].tone).toBe('crit')
  })

  it('has nothing to judge before a traceable sale exists', () => {
    expect(readDataHealth({ ...row, traceable_sales: 0, counted_sales: 0 })[0]).toMatchObject({ value: '—', tone: 'info' })
  })

  it('shows the webhook delay in plain units and flags buyers shared with another test', () => {
    const items = readDataHealth(row)
    expect(items.find((item) => item.label === 'Atraso do webhook')!.value).toBe('70 s')
    expect(readDataHealth({ ...row, median_delay_seconds: 7200 }).find((item) => item.label === 'Atraso do webhook')).toMatchObject({ value: '2 h', tone: 'warn' })
    expect(items.find((item) => item.label === 'Compradores em outro teste')).toMatchObject({ value: '30%', tone: 'warn' })
  })
})
