import axios, { type InternalAxiosRequestConfig } from 'axios'
import { getToken, getTokenGeneration, requestParentTokenRefresh, setToken } from '../utils/token'

export const mainApi = axios.create({ baseURL: '/api/v1', timeout: 15000 })
type RequestConfig = InternalAxiosRequestConfig & { _retried?: boolean; _generation?: number }
let refresh: Promise<{ accessToken: string } | null> | null = null

mainApi.interceptors.request.use((config: RequestConfig) => {
  config._generation ??= getTokenGeneration()
  if (config._generation !== getTokenGeneration()) throw new Error('Session ended')
  const token = getToken()
  if (!token) throw new Error('Session not ready')
  config.headers.Authorization = `Bearer ${token}`
  return config
})
mainApi.interceptors.response.use((response) => {
  if ((response.config as RequestConfig)._generation !== getTokenGeneration()) throw new Error('Session ended')
  return response
}, async (error) => {
  const config = error.config as RequestConfig | undefined
  if (!config || error.response?.status !== 401) return Promise.reject(error)
  if (config._generation !== getTokenGeneration()) return Promise.reject(error)
  if (config._retried) {
    window.dispatchEvent(new Event('sn-session-expired'))
    return Promise.reject(error)
  }
  config._retried = true
  refresh ??= requestParentTokenRefresh().finally(() => { refresh = null })
  const result = await refresh
  if (config._generation !== getTokenGeneration()) return Promise.reject(error)
  if (!result?.accessToken) {
    window.dispatchEvent(new Event('sn-session-expired'))
    window.parent.postMessage({ type: 'TOKEN_EXPIRED', id: `sn-expired-${Date.now()}` }, '*')
    return Promise.reject(error)
  }
  setToken(result.accessToken)
  return mainApi(config)
})

export interface Account { id: number; username: string; nickname: string | null }
export type SnStatus = 'pending' | 'active' | 'disabled'
export interface SnItem {
  id: number; sn_tail: string; user_id: number; username: string; nickname: string | null
  enabled: boolean; status: SnStatus; device_uuid: string | null; created_at: number | string
  activated_at: number | string | null; last_login_at: number | string | null; remark: string | null
}
export interface AuditEvent {
  id: number; event_type: string; action: string; user_id: number | null; created_at: number | string
  context: Record<string, unknown> | string | null
}
export interface SnDetail extends SnItem { events: AuditEvent[] }
export interface SnExport { id: number; sn: string; username: string; device_uuid: string | null; status: SnStatus; remark: string | null }
export interface Page<T> { items: T[]; total: number; page: number; page_size: number }
interface Envelope<T> { success: boolean; data: T; message?: string }
async function data<T>(request: Promise<{ data: Envelope<T> }>): Promise<T> {
  const { data: body } = await request
  if (body.success !== true) throw new Error(body.message || 'Request failed')
  return body.data
}
export const verifyCurrentToken = () => mainApi.get<{ code: number; data: { id: number; roles: string[] } }>('/plugin/verify-token')
export const searchAccounts = (q: string, page = 1) => data<Page<Account>>(mainApi.get('/plugin-sn/accounts', { params: { q, page, page_size: 30 } }))
export const listCodes = (params: { q?: string; status?: string; user_id?: number; page: number; page_size: number }) => data<Page<SnItem>>(mainApi.get('/plugin-sn', { params }))
export const getCode = (id: number) => data<SnDetail>(mainApi.get(`/plugin-sn/${id}`))
export const generateCodes = (payload: { user_id: number; count: number; remark: string }) => data<{ items: (SnItem & { sn: string })[] }>(mainApi.post('/plugin-sn/generate', payload))
export const updateCode = (id: number, payload: { enabled?: boolean; remark?: string }) => data<SnItem>(mainApi.patch(`/plugin-sn/${id}`, payload))
export const revealCode = (id: number) => data<{ id: number; sn: string }>(mainApi.post(`/plugin-sn/${id}/reveal`))
export const exportCodes = (ids: number[]) => data<{ items: SnExport[] }>(mainApi.post('/plugin-sn/export', { ids }))
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === 'string') return error.response.data.message
  return error instanceof Error ? error.message : String(error)
}
