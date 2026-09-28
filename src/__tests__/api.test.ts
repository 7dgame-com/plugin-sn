import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { mainApi, getManagementAccess, listCodes, searchAccounts, generateCodes, updateCode, revealCode, exportCodes, errorMessage } from '../api'
import { getToken, removeAllTokens, setToken } from '../utils/token'

describe('SN management API contract', () => {
  beforeEach(() => { removeAllTokens(); setToken('root-token') })
  it('gets the trusted access scope from the management backend', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ data: { success: true, data: { allowed: true, access_scope: 'admin-only' } }, status: 200, statusText: 'OK', headers: {}, config }))
    mainApi.defaults.adapter = adapter
    await expect(getManagementAccess()).resolves.toEqual({ allowed: true, access_scope: 'admin-only' })
    expect(adapter.mock.calls[0][0].url).toBe('/plugin-sn/access')
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer root-token')
  })
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
  it('revokes access on management 403 without retrying or retaining a token', async () => {
    const revoked = vi.fn()
    window.addEventListener('sn-access-revoked', revoked)
    try {
      const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        throw new AxiosError('Forbidden', 'ERR_BAD_REQUEST', config, undefined, { data: { message: 'SN access denied' }, status: 403, statusText: 'Forbidden', headers: {}, config })
      })
      mainApi.defaults.adapter = adapter
      await expect(generateCodes({ user_id: 9, count: 1, remark: '' })).rejects.toThrow('Forbidden')
      expect(adapter).toHaveBeenCalledTimes(1)
      expect(revoked).toHaveBeenCalledTimes(1)
      expect(getToken()).toBeNull()
      await expect(listCodes({ page: 1, page_size: 20 })).rejects.toThrow('Session not ready')
      expect(adapter).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('sn-access-revoked', revoked)
    }
  })
  it('ignores a late 403 from a previous session instead of revoking the replacement', async () => {
    let fail!: () => void
    mainApi.defaults.adapter = (config) => new Promise((_resolve, reject) => {
      fail = () => reject(new AxiosError('Forbidden', 'ERR_BAD_REQUEST', config, undefined, { data: {}, status: 403, statusText: 'Forbidden', headers: {}, config }))
    })
    const revoked = vi.fn()
    window.addEventListener('sn-access-revoked', revoked)
    try {
      const pending = revealCode(1)
      await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
      removeAllTokens()
      setToken('replacement')
      fail()
      await expect(pending).rejects.toThrow('Forbidden')
      expect(revoked).not.toHaveBeenCalled()
      expect(getToken()).toBe('replacement')
    } finally {
      window.removeEventListener('sn-access-revoked', revoked)
    }
  })
  it('surfaces server errors and rejects an application-level failure', async () => {
    mainApi.defaults.adapter = async (config) => ({ data: { success: false, message: 'Account is not eligible' }, status: 200, statusText: 'OK', headers: {}, config })
    await expect(generateCodes({ user_id: 1, count: 1, remark: '' })).rejects.toThrow('Account is not eligible')
    expect(errorMessage(new AxiosError('Bad request', undefined, undefined, undefined, { data: { message: 'SN disabled' } } as never))).toBe('SN disabled')
  })
})
