// Host tokens stay in memory; reopening an iframe requires a new handshake.
let token: string | null = null
let generation = 0
export const getToken = () => token
export const getTokenGeneration = () => generation
export function setToken(value: string) { token = value }
export function removeAllTokens() { token = null; generation++ }
export function isInIframe() {
  try { return window.self !== window.top } catch { return true }
}

export function requestParentTokenRefresh(): Promise<{ accessToken: string } | null> {
  return new Promise((resolve) => {
    const finish = (value: { accessToken: string } | null) => {
      window.clearTimeout(timer)
      window.removeEventListener('message', listener)
      resolve(value)
    }
    const listener = (event: MessageEvent) => {
      if (event.source !== window.parent) return
      if (event.data?.type === 'DESTROY') finish(null)
      if (event.data?.type === 'TOKEN_UPDATE' && typeof event.data.payload?.token === 'string') {
        finish({ accessToken: event.data.payload.token })
      }
    }
    const timer = window.setTimeout(() => finish(null), 3000)
    window.addEventListener('message', listener)
    window.parent.postMessage({ type: 'TOKEN_REFRESH_REQUEST', id: `sn-refresh-${Date.now()}` }, '*')
  })
}
