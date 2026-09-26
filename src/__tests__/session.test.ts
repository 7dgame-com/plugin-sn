import { beforeEach, describe, expect, it, vi } from 'vitest'
const { verifyCurrentToken, requestRefresh } = vi.hoisted(() => ({ verifyCurrentToken: vi.fn(), requestRefresh: vi.fn() }))
vi.mock('../api', () => ({ verifyCurrentToken }))
vi.mock('../utils/token', async (original) => ({ ...await original<typeof import('../utils/token')>(), requestParentTokenRefresh: requestRefresh }))
import { useSession } from '../composables/useSession'
import { getToken, setToken } from '../utils/token'
const reply = (roles: string[], id = 1) => ({ data: { code: 0, data: { id, roles } } })
describe('root session boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires a fresh handshake, not a token from a previous iframe', () => {
    setToken('old')
    const session = useSession()
    expect(session.authorized.value).toBe(false)
    expect(getToken()).toBeNull()
    expect(verifyCurrentToken).not.toHaveBeenCalled()
  })
  it('accepts verified root and closes on a role downgrade', async () => {
    verifyCurrentToken.mockResolvedValueOnce(reply(['root'])).mockResolvedValueOnce(reply(['admin']))
    const session = useSession()
    await session.verify('root')
    expect(session.authorized.value).toBe(true)
    await session.verify('admin')
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('denied')
    expect(getToken()).toBeNull()
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
    const session = useSession()
    const pending = session.verify('root')
    await session.verify('user')
    resolve(reply(['root']))
    await pending
    expect(session.authorized.value).toBe(false)
    expect(session.state.value).toBe('denied')
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
