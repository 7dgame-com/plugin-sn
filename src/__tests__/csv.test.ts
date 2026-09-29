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
  it('preserves new 16-character and legacy 32-character SN values in the same export', () => {
    const csv = codesCsv([
      { id: 1, sn: '0000-1111-2222-3333', username: 'test-user', device_uuid: null, status: 'pending', remark: null },
      { id: 2, sn: '0000-1111-2222-3333-4444-5555-6666-7777', username: 'test-user', device_uuid: 'device-2', status: 'active', remark: null },
    ])
    expect(csv.split('\r\n').slice(1)).toEqual([
      '"1","0000-1111-2222-3333","test-user","","pending",""',
      '"2","0000-1111-2222-3333-4444-5555-6666-7777","test-user","device-2","active",""',
    ])
  })
  it('retains a revoked SN for archival export when its account no longer exists', () => {
    const csv = codesCsv([{ id: 3, sn: '0000-1111-2222-3333', username: null, device_uuid: 'original-device', status: 'revoked', remark: '账号已删除' }])
    expect(csv.split('\r\n')[1]).toBe('"3","0000-1111-2222-3333","","original-device","revoked","账号已删除"')
  })
})
