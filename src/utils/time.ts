export function parseSnTime(value: number | string): Date {
  const numeric = typeof value === 'number' || /^\d+$/.test(value) ? Number(value) : null
  if (numeric !== null) return new Date(numeric < 1e12 ? numeric * 1000 : numeric)
  // SN records and their audit events use UTC, including SQL strings without an offset.
  const text = String(value)
  const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text
  return new Date(utc)
}
