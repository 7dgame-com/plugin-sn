import type { SnExport } from '../api'

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  // Spreadsheet programs may execute formulas even after leading whitespace.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
export function codesCsv(items: SnExport[]): string {
  return '\ufeff' + [['ID', 'SN', 'Username', 'Device UUID', 'Status', 'Remark'],
    ...items.map((item) => [item.id, item.sn, item.username, item.device_uuid, item.status, item.remark]),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
export function downloadCodes(items: SnExport[]) {
  const url = URL.createObjectURL(new Blob([codesCsv(items)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `sn-codes-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
