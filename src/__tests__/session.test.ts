import { beforeEach, describe, expect, it, vi } from 'vitest'
const { verifyCurrentToken, getManagementAccess, requestRefresh } = vi.hoisted(() => ({ verifyCurrentToken: vi.fn(), getManagementAccess: vi.fn(), requestRefresh: vi.fn() }))
vi.mock('../api', () => ({ verifyCurrentToken, getManagementAccess }))
vi.mock('../utils/token', async (original) => ({ ...await original<typeof import('../utils/token')>(), requestParentTokenRefresh: requestRefresh }))
import { useSession } from '../composables/useSession'
import { getToken, setToken } from '../utils/token'
const reply = (roles: string[], id = 1) => ({ data: { code: 0, data: { id, roles } } })
describe('server-authorized SN session boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getManagementAccess.mockResolvedValue({ allowed: true, access_scope: 'root-only' })
  })
  it('requires a fresh handshake, not a token from a previous iframe', () => {
    setToken('old')
    const session = useSession()
    expect(session.authorized.value).toBe(false)
    expect(getToken()).toBeNull()
    expect(verifyCurrentToken).not.toHaveBeenCalled()
  })
  it.each([
    ['root', 'root-only'], ['admin', 'admin-only'], ['manager', 'manager-only'], ['user', 'auth-only'],
  ])('uses the backend decision for %s under %s', async (role, scope) => {
    verifyCurrentToken.mockResolvedValueOnce(reply([role]))
    getManagementAccess.mockResolvedValueOnce({ allowed: true, access_scope: scope })
    const session = useSession()
    await session.verify('password-session')
    expect(session.authorized.value).toBe(true)
    expect(session.userId.value).toBe(1)
    expect(session.state.value).toBe('ready')
  })
  it('closes when the backend denies a previously authorized session', async () => {
    verifyCurrentToken.mockResolvedValueOnce(reply(['root'])).mockResolvedValueOnce(reply(['admin']))
    getManagementAccess.mockResolvedValueOnce({ allowed: true, access_scope: 'root-only' }).mockResolvedValueOnce({ allowed: false, access_scope: 'root-only' })
    const session = useSession()
    await session.verify('root')
    expect(session.authorized.value).toBe(true)
    await session.verify('admin')
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('denied')
    expect(getToken()).toBeNull()
  })
  it.each([
    { allowed: false, access_scope: 'auth-only' },
    { allowed: false, access_scope: null },
    { allowed: true, access_scope: null },
    { allowed: true, access_scope: 'unknown' },
  ])('does not infer access from root roles when capability is %j', async (access) => {
    verifyCurrentToken.mockResolvedValueOnce(reply(['root']))
    getManagementAccess.mockResolvedValueOnce(access)
    const session = useSession()
    await session.verify('untrusted-session-source')
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('denied')
    expect(getToken()).toBeNull()
  })
  it('does not request management access before identity is verified', async () => {
    verifyCurrentToken.mockResolvedValueOnce(reply(['root'], 0))
    const session = useSession()
    await session.verify('invalid-identity')
    expect(getManagementAccess).not.toHaveBeenCalled()
    expect(session.state.value).toBe('denied')
  })
  it('cannot resurrect a destroyed session from a late root verification', async () => {
    let resolve!: (value: unknown) => void
    verifyCurrentToken.mockReturnValueOnce(new Promise((finish) => { resolve = finish }))
    const session = useSession()
    const pending = session.verify('root')
    session.reset()
    resolve(reply(['root']))
    await pending
    expect(session.authorized.value).toBe(false)
    expect(session.userId.value).toBeNull()
    expect(session.state.value).toBe('waiting')
  })
  it('ignores an old root response after a newer non-root verification', async () => {
    let resolve!: (value: unknown) => void
    verifyCurrentToken.mockReturnValueOnce(new Promise((finish) => { resolve = finish })).mockResolvedValueOnce(reply(['user']))
    getManagementAccess.mockResolvedValueOnce({ allowed: false, access_scope: 'root-only' })
    const session = useSession()
    const pending = session.verify('root')
    await session.verify('user')
    resolve(reply(['root']))
    await pending
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('denied')
  })
  it.each([['revoke', 'revoked'], ['unavailable', 'unavailable']] as const)('clears sensitive content and ignores a capability response after %s', async (action, state) => {
    verifyCurrentToken.mockResolvedValue(reply(['admin']))
    const session = useSession()
    await session.verify('first')
    let resolve!: (value: unknown) => void
    getManagementAccess.mockReturnValueOnce(new Promise((finish) => { resolve = finish }))
    const pending = session.verify('replacement')
    expect(session.authorized.value).toBe(false)
    expect(session.userId.value).toBeNull()
    await vi.waitFor(() => expect(getManagementAccess).toHaveBeenCalledTimes(2))
    session[action]()
    resolve({ allowed: true, access_scope: 'admin-only' })
    await pending
    expect(session.state.value).toBe(state)
    expect(session.authorized.value).toBe(false)
    expect(getToken()).toBeNull()
  })
  it('requires an explicit retry with a fresh host token after access is revoked', async () => {
    verifyCurrentToken.mockResolvedValue(reply(['admin']))
    requestRefresh.mockResolvedValueOnce({ accessToken: 'new-host-token' })
    const session = useSession()
    await session.verify('old-host-token')
    session.revoke()
    expect(requestRefresh).not.toHaveBeenCalled()
    await session.retry()
    expect(requestRefresh).toHaveBeenCalledTimes(1)
    expect(session.authorized.value).toBe(true)
    expect(getToken()).toBe('new-host-token')
  })
  it('fails closed on unavailable backend configuration and can retry', async () => {
    verifyCurrentToken.mockResolvedValue(reply(['root']))
    getManagementAccess.mockRejectedValueOnce(new Error('Service unavailable'))
    const session = useSession()
    await session.verify('root')
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('error')
    expect(getToken()).toBeNull()
    await session.retry()
    expect(session.state.value).toBe('ready')
  })
  it('clears authorization on verification failures and can retry', async () => {
    verifyCurrentToken.mockResolvedValueOnce(reply(['root'])).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply(['root'], 2))
    const session = useSession()
    await session.verify('first')
    await session.verify('replacement')
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('error')
    await session.retry()
    expect(session.userId.value).toBe(2)
  })
  it('does not revive a destroyed session from an outstanding refresh', async () => {
    let resolve!: (value: unknown) => void
    requestRefresh.mockReturnValueOnce(new Promise((finish) => { resolve = finish }))
    const session = useSession()
    session.expire()
    const pending = session.retry()
    session.reset()
    resolve({ accessToken: 'root' })
    await pending
    expect(verifyCurrentToken).not.toHaveBeenCalled()
    expect(getToken()).toBeNull()
  })
})
