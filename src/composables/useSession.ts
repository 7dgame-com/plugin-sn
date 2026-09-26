import { computed, ref } from 'vue'
import { verifyCurrentToken } from '../api'
import { removeAllTokens, requestParentTokenRefresh, setToken } from '../utils/token'

export function useSession() {
  const state = ref<'waiting' | 'checking' | 'ready' | 'denied' | 'error'>('waiting')
  const userId = ref<number | null>(null)
  const authorized = ref(false)
  let generation = 0
  let currentToken = ''
  removeAllTokens()

  async function verify(token: string) {
    const run = ++generation
    currentToken = token
    if (!token) { reset(); return }
    setToken(token)
    state.value = 'checking'
    try {
      const { data: body } = await verifyCurrentToken()
      if (run !== generation) return
      const allowed = body.code === 0 && Number.isInteger(body.data?.id) && body.data?.roles?.includes('root') === true
      authorized.value = allowed
      userId.value = allowed ? body.data.id : null
      state.value = allowed ? 'ready' : 'denied'
      if (!allowed) removeAllTokens()
    } catch {
      if (run !== generation) return
      authorized.value = false
      userId.value = null
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
  return { state, userId, authorized: computed(() => authorized.value), verify, reset, expire, retry }
}
