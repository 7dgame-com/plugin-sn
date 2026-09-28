import { computed, ref } from 'vue'
import { getManagementAccess, verifyCurrentToken } from '../api'
import { removeAllTokens, requestParentTokenRefresh, setToken } from '../utils/token'

export function useSession() {
  const state = ref<'waiting' | 'checking' | 'ready' | 'denied' | 'revoked' | 'unavailable' | 'error'>('waiting')
  const userId = ref<number | null>(null)
  const authorized = ref(false)
  let generation = 0
  let currentToken = ''
  removeAllTokens()

  async function verify(token: string) {
    const run = ++generation
    currentToken = token
    if (!token) { reset(); return }
    removeAllTokens()
    setToken(token)
    authorized.value = false
    userId.value = null
    state.value = 'checking'
    try {
      const { data: body } = await verifyCurrentToken()
      if (run !== generation) return
      if (body.code !== 0 || !Number.isInteger(body.data?.id) || body.data.id <= 0) { deny(); return }
      const access = await getManagementAccess()
      if (run !== generation) return
      const allowed = access?.allowed === true && ['root-only', 'admin-only', 'manager-only', 'auth-only'].includes(access.access_scope ?? '')
      if (!allowed) { deny(); return }
      authorized.value = allowed
      userId.value = body.data.id
      state.value = 'ready'
    } catch {
      if (run !== generation) return
      authorized.value = false
      userId.value = null
      removeAllTokens()
      state.value = 'error'
    }
  }
  function reset() {
    generation++
    currentToken = ''
    removeAllTokens()
    authorized.value = false
    userId.value = null
    state.value = 'waiting'
  }
  function deny() { reset(); state.value = 'denied' }
  function revoke() { reset(); state.value = 'revoked' }
  function unavailable() { reset(); state.value = 'unavailable' }
  function expire() { reset(); state.value = 'error' }
  async function retry() {
    if (currentToken) return verify(currentToken)
    const run = ++generation
    state.value = 'checking'
    const refreshed = await requestParentTokenRefresh()
    if (run !== generation) return
    if (refreshed?.accessToken) await verify(refreshed.accessToken)
    else state.value = 'error'
  }
  return { state, userId, authorized: computed(() => authorized.value), verify, reset, revoke, unavailable, expire, retry }
}
