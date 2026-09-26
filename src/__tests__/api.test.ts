import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { mainApi, listCodes, searchAccounts, generateCodes, updateCode, revealCode, exportCodes, errorMessage } from '../api'
import { removeAllTokens, setToken } from '../utils/token'

describe('SN management API contract', () => {
  beforeEach(() => { removeAllTokens(); setToken('root-token') })
  it('sends generation, reveal, changes and export through their audited APIs', async () => {
    const requests: InternalAxiosRequestConfig[] = []
    mainApi.defaults.adapter = async (config) => {
      requests.push(config)
      return { data: { success: true, data: { items: [], id: 12, sn: 'TEST' } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    await generateCodes({ user_id: 9, count: 2, remark: 'campus' })
    await revealCode(12)
    await updateCode(12, { enabled: false })
    await exportCodes([12, 13])
    expect(requests.map((r) => [r.method, r.url, r.data && JSON.parse(r.data)])).toEqual([
      ['post', '/plugin-sn/generate', { user_id: 9, count: 2, remark: 'campus' }],
      ['post', '/plugin-sn/12/reveal', undefined],
      ['patch', '/plugin-sn/12', { enabled: false }],
      ['post', '/plugin-sn/export', { ids: [12, 13] }],
    ])
    expect(requests.every((r) => r.headers.Authorization === 'Bearer root-token')).toBe(true)
  })
  it('passes pagination and filters without sending SN credentials in URLs', async () => {
    const requests: InternalAxiosRequestConfig[] = []
    mainApi.defaults.adapter = async (config) => {
      requests.push(config)
      return { data: { success: true, data: { items: [], total: 0, page: 2, page_size: 20 } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    await listCodes({ q: 'ABCD', status: 'active', user_id: 9, page: 2, page_size: 20 })
    await searchAccounts('student', 3)
    expect(requests[0].params).toEqual({ q: 'ABCD', status: 'active', user_id: 9, page: 2, page_size: 20 })
    expect(requests[1].params).toEqual({ q: 'student', page: 3, page_size: 30 })
  })
  it('does not retry generation after an ambiguous network error', async () => {
    const adapter = vi.fn(async () => { throw new Error('network lost') })
    mainApi.defaults.adapter = adapter
    await expect(generateCodes({ user_id: 9, count: 2, remark: '' })).rejects.toThrow('network lost')
    expect(adapter).toHaveBeenCalledTimes(1)
  })
  it('rejects late sensitive responses after logout', async () => {
    let finish!: () => void
    mainApi.defaults.adapter = (config) => new Promise((resolve) => { finish = () => resolve({ data: { success: true, data: { id: 1, sn: 'SECRET' } }, status: 200, statusText: 'OK', headers: {}, config }) })
    const pending = revealCode(1)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    removeAllTokens()
    finish()
    await expect(pending).rejects.toThrow('Session ended')
  })
  it('surfaces server errors and rejects an application-level failure', async () => {
    mainApi.defaults.adapter = async (config) => ({ data: { success: false, message: 'Account is not eligible' }, status: 200, statusText: 'OK', headers: {}, config })
    await expect(generateCodes({ user_id: 1, count: 1, remark: '' })).rejects.toThrow('Account is not eligible')
    expect(errorMessage(new AxiosError('Bad request', undefined, undefined, undefined, { data: { message: 'SN disabled' } } as never))).toBe('SN disabled')
  })
})
