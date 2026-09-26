import { describe, expect, it } from 'vitest'
import { codesCsv, csvCell } from '../utils/csv'
describe('CSV export', () => {
  it.each(['=1+1', '+SUM(A1)', '-1', '@SUM(A1)', '  =cmd()', '\t=1', '\rmalicious'])('neutralizes spreadsheet formula/control prefix %j', (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`)
  })
  it('quotes commas, newlines and double quotes without losing data', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"')
    expect(csvCell(null)).toBe('""')
  })
  it('exports full server-returned SN values and UTF-8 BOM', () => {
    const csv = codesCsv([{ id: 1, sn: 'AAAA-BBBB-CCCC', username: '=formula', device_uuid: null, status: 'pending', remark: '中文' }])
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain('AAAA-BBBB-CCCC')
    expect(csv).toContain('"\'=formula"')
    expect(csv).toContain('中文')
  })
})
