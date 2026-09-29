import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElDrawer, ElMessageBox, ElSelect, ElTable } from 'element-plus'
import SnList from '../views/SnList.vue'
import i18n, { setLanguage } from '../i18n'
import { exportCodes, getCode, listCodes, revealCode, updateCode, type SnItem } from '../api'
import { downloadCodes } from '../utils/csv'

vi.mock('../api', () => ({
  listCodes: vi.fn(), getCode: vi.fn(), updateCode: vi.fn(), revealCode: vi.fn(), exportCodes: vi.fn(),
  generateCodes: vi.fn(), searchAccounts: vi.fn(), errorMessage: (error: Error) => error.message,
}))
vi.mock('../utils/csv', () => ({ downloadCodes: vi.fn() }))

const active: SnItem = {
  id: 1, sn_tail: 'LIVE', user_id: 9, original_user_id: 9, username: 'classroom', nickname: null,
  enabled: true, status: 'active', revocation_reason: null, device_uuid: 'device-1',
  created_at: '2026-09-28 01:00:00', activated_at: '2026-09-28 01:01:00', last_login_at: null, remark: null,
}
const disabled: SnItem = { ...active, id: 2, sn_tail: 'STOP', enabled: false, status: 'disabled' }
const revoked: SnItem = {
  ...active, id: 3, sn_tail: 'GONE', user_id: null, original_user_id: 623, username: null, nickname: null,
  enabled: false, status: 'revoked', revocation_reason: 'account_deleted',
}
const audit = { id: 4, event_type: 'device_sn', action: 'generate', user_id: 4, created_at: '2026-09-28 01:00:00', context: { count: 1 } }
let wrapper: VueWrapper | undefined
let records: SnItem[]
const clickButton = async (scope: VueWrapper | ReturnType<VueWrapper['find']>, text: string) => {
  const button = scope.findAll('button').find((item) => item.text() === text)
  expect(button, `button ${text}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
const row = (suffix: string) => {
  const result = wrapper!.findAll('tbody tr').find((item) => item.text().includes(suffix))
  expect(result, `SN row ${suffix}`).toBeDefined()
  return result!
}
async function render() {
  wrapper = mount(SnList, { attachTo: document.body, global: { plugins: [ElementPlus, i18n] } })
  await flushPromises()
  return wrapper
}

describe('permanently revoked SN records', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    setLanguage('zh-CN')
    records = [structuredClone(active), structuredClone(disabled), structuredClone(revoked)]
    vi.mocked(listCodes).mockImplementation(async () => ({ items: records, total: records.length, page: 1, page_size: 20 }))
    vi.mocked(getCode).mockResolvedValue({ ...revoked, events: [audit] })
    vi.mocked(updateCode).mockResolvedValue(revoked)
    vi.mocked(revealCode).mockResolvedValue({ id: revoked.id, sn: '0000-1111-2222-3333' })
    vi.mocked(exportCodes).mockResolvedValue({ items: [{ ...revoked, sn: '0000-1111-2222-3333' }] })
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['zh-CN', '已作废', '账号已删除（原 ID：623）', '恢复', '停用', '详情', '查看完整码'],
    ['en-US', 'Revoked', 'Account deleted (original ID: 623)', 'Restore', 'Disable', 'Details', 'Reveal code'],
  ])('shows the deleted account and only archival actions in %s', async (locale, status, account, restore, disable, details, reveal) => {
    setLanguage(locale)
    await render()
    expect(row('GONE').text()).toContain(status)
    expect(row('GONE').text()).toContain(account)
    expect(row('GONE').findAll('button').map((button) => button.text())).toEqual([details, reveal])
    expect(row('STOP').text()).toContain(restore)
    expect(row('LIVE').text()).toContain(disable)
  })

  it('filters by revoked through the backend status parameter', async () => {
    await render()
    const select = wrapper!.findAllComponents(ElSelect)[0]
    expect(select.findAllComponents({ name: 'ElOption' }).some((option) => option.props('value') === 'revoked')).toBe(true)
    select.vm.$emit('update:modelValue', 'revoked')
    select.vm.$emit('change', 'revoked')
    await flushPromises()
    expect(listCodes).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'revoked', page: 1 }))
  })

  it('guards direct toggle calls for revoked status or account-deletion reason', async () => {
    await render()
    const vm = wrapper!.vm as unknown as { toggle: (item: SnItem) => Promise<void> }
    await vm.toggle(revoked)
    await vm.toggle({ ...disabled, revocation_reason: 'account_deleted' })
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(updateCode).not.toHaveBeenCalled()
  })

  it('still restores an ordinarily disabled SN', async () => {
    await render()
    await clickButton(row('STOP'), '恢复')
    expect(ElMessageBox.confirm).toHaveBeenCalledOnce()
    expect(updateCode).toHaveBeenCalledWith(disabled.id, { enabled: true })
  })

  it('does not restore a record that becomes revoked while confirmation is open', async () => {
    let confirm!: (value: 'confirm') => void
    vi.mocked(ElMessageBox.confirm).mockReturnValueOnce(new Promise((resolve) => { confirm = resolve }))
    await render()
    await clickButton(row('STOP'), '恢复')
    records = records.map((item) => item.id === disabled.id ? { ...revoked, id: disabled.id, sn_tail: 'STOP' } : item)
    await clickButton(wrapper!, '刷新')
    confirm('confirm')
    await flushPromises()
    expect(updateCode).not.toHaveBeenCalled()
    expect(row('STOP').text()).not.toContain('恢复')
  })

  it('syncs revocation from details to the list and retains it after closing details or receiving an older list', async () => {
    vi.mocked(getCode).mockResolvedValueOnce({ ...revoked, id: disabled.id, sn_tail: disabled.sn_tail, original_user_id: disabled.user_id, events: [audit] })
    vi.mocked(revealCode).mockResolvedValueOnce({ id: disabled.id, sn: '0000-1111-2222-3333' })
    await render()
    await clickButton(row('STOP'), '详情')
    expect(row('STOP').text()).toContain('已作废')
    expect(row('STOP').text()).toContain('账号已删除（原 ID：9）')
    expect(row('STOP').text()).not.toContain('恢复')
    const drawer = wrapper!.findComponent(ElDrawer)
    drawer.vm.$emit('update:modelValue', false)
    drawer.vm.$emit('closed')
    await flushPromises()
    // The mock list still contains its older, disabled representation.
    await clickButton(wrapper!, '刷新')
    expect(row('STOP').text()).toContain('已作废')
    expect(row('STOP').text()).not.toContain('恢复')
    await clickButton(row('STOP'), '查看完整码')
    expect(wrapper!.find('.el-dialog .dialog-note').text()).toContain('此 SN 已永久作废，不能恢复')
    expect(updateCode).not.toHaveBeenCalled()
  })

  it('uses revocation learned during an in-flight reveal instead of the clicked row snapshot', async () => {
    let finishReveal!: (value: { id: number; sn: string }) => void
    vi.mocked(revealCode).mockReturnValueOnce(new Promise((resolve) => { finishReveal = resolve }))
    await render()
    await clickButton(row('LIVE'), '查看完整码')
    records = records.map((item) => item.id === active.id ? { ...revoked, id: active.id, sn_tail: active.sn_tail } : item)
    await clickButton(wrapper!, '刷新')
    finishReveal({ id: active.id, sn: '0000-1111-2222-3333' })
    await flushPromises()
    expect(wrapper!.find('.el-dialog .dialog-note').text()).toContain('此 SN 已永久作废，不能恢复')
    expect(row('LIVE').text()).not.toContain('停用')
  })

  it('keeps reveal, export, remark updates and existing audits available for archival use', async () => {
    await render()
    await clickButton(row('GONE'), '查看完整码')
    expect(revealCode).toHaveBeenCalledWith(revoked.id)
    expect(wrapper!.text()).toContain('此 SN 已永久作废，不能恢复')
    expect(wrapper!.find<HTMLInputElement>('.secret-text input').element.value).toBe('0000-1111-2222-3333')
    await clickButton(wrapper!, '关闭')
    await clickButton(row('GONE'), '详情')
    expect(getCode).toHaveBeenCalledWith(revoked.id)
    expect(wrapper!.find('.el-descriptions').text()).toContain('账号已删除（原 ID：623）')
    expect(wrapper!.find('.audit-timeline').text()).toContain('生成')
    await wrapper!.find('.remark-form textarea').setValue('保留原账号的分发记录')
    await clickButton(wrapper!, '保存备注')
    expect(updateCode).toHaveBeenCalledWith(revoked.id, { remark: '保留原账号的分发记录' })
    wrapper!.findComponent(ElTable).vm.$emit('selection-change', [revoked])
    await flushPromises()
    await clickButton(wrapper!, '导出所选 CSV (1)')
    expect(exportCodes).toHaveBeenCalledWith([revoked.id])
    expect(downloadCodes).toHaveBeenCalledWith([{ ...revoked, sn: '0000-1111-2222-3333' }])
  })

  it('does not display null as an account ID when the historical ID is unavailable', async () => {
    records = [{ ...revoked, original_user_id: null }]
    await render()
    expect(row('GONE').text()).toContain('账号已删除')
    expect(row('GONE').text()).not.toMatch(/null|原 ID|#null/)
  })
})
