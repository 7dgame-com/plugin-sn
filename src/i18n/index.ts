import { createI18n } from 'vue-i18n'

const zh = {
  title: 'SN 分发管理', subtitle: '生成账号专属 SN，分发给 Rokid 设备完成激活。每个 SN 绑定一台设备。',
  connecting: '正在验证 SN 管理权限…', accessDenied: '当前账号没有 SN 管理权限', accessRevoked: 'SN 管理权限已变更',
  accessDeniedHint: '请联系 root 管理员检查插件访问范围，权限调整后可重新验证。', recheckAccess: '重新验证权限', fromHost: '请从主系统的 SN 分发管理插件进入。',
  sessionFailed: '会话验证失败', retry: '重试', search: '搜索账号、SN 尾号或设备 UUID', allStatus: '全部状态',
  status: { pending: '未激活', active: '已激活', disabled: '已停用' }, statusLabel: '状态', allAccounts: '全部账号',
  generate: '生成 SN', export: '导出所选 CSV', refresh: '刷新', account: '绑定账号', code: 'SN 码', device: '设备 UUID',
  created: '生成时间', activated: '激活时间', lastLogin: '最近登录', remark: '备注', actions: '操作', detail: '详情', reveal: '查看完整码',
  disable: '停用', enable: '恢复', cancel: '取消', confirm: '确认', save: '保存备注', count: '生成数量',
  selectAccount: '搜索普通账号', accountHint: '只显示可绑定的普通账号；同一账号可生成多个 SN。', countHint: '每次 1–100 个',
  generated: '本批次生成成功', generatedHint: '可复制或下载后分发。关闭后可从列表重新查看完整码。',
  copy: '复制', copyAll: '复制全部', copied: '已复制', copyFailed: '复制失败，请选中文本手动复制', exportBatch: '导出本批次 CSV',
  revealTitle: '完整 SN', secretHint: '完整 SN 是设备登录凭证，请仅分发给目标设备使用者。',
  confirmDisable: '停用后，将立即禁止此 SN 的新登录和令牌刷新。已签发的访问令牌会在自然到期后失效，剩余有效期最长 3 小时。确认停用？',
  confirmEnable: '恢复后，原绑定设备可继续使用此 SN 登录。确认恢复？', updated: '已保存',
  audit: '操作记录', event: '事件', operator: '操作账号 ID', time: '时间', context: '详情', noEvents: '暂无操作记录',
  noData: '暂无 SN', emptySelection: '请先选择要导出的 SN', invalidGenerate: '请选择账号并输入 1–100 的整数数量',
  generateFailed: '生成请求未成功确认。请先刷新列表核对结果，再决定是否重新生成。', moreAccounts: '加载更多账号',
  notBound: '未绑定', auditNote: '查看完整码与导出会记录在操作日志中。', close: '关闭', loadFailed: '加载失败',
  events: { generate: '生成', activate: '激活', login: '登录', reveal: '查看完整码', export: '导出', disable: '停用', enable: '恢复', update: '更新' },
}
const en = {
  title: 'SN distribution', subtitle: 'Generate account-bound SN codes for Rokid activation. Each SN binds to one device.',
  connecting: 'Verifying SN management access…', accessDenied: 'This account does not have SN management access', accessRevoked: 'SN management access has changed',
  accessDeniedHint: 'Ask a root administrator to check the plugin access scope, then verify access again.', recheckAccess: 'Verify access again', fromHost: 'Open SN distribution from the main application.',
  sessionFailed: 'Session verification failed', retry: 'Retry', search: 'Search account, SN suffix or device UUID', allStatus: 'All statuses',
  status: { pending: 'Pending', active: 'Active', disabled: 'Disabled' }, statusLabel: 'Status', allAccounts: 'All accounts',
  generate: 'Generate SN', export: 'Export selected CSV', refresh: 'Refresh', account: 'Account', code: 'SN code', device: 'Device UUID',
  created: 'Created', activated: 'Activated', lastLogin: 'Last login', remark: 'Remark', actions: 'Actions', detail: 'Details', reveal: 'Reveal code',
  disable: 'Disable', enable: 'Restore', cancel: 'Cancel', confirm: 'Confirm', save: 'Save remark', count: 'Quantity',
  selectAccount: 'Search regular accounts', accountHint: 'Only eligible regular accounts are listed. Multiple SN codes can share an account.', countHint: '1–100 per batch',
  generated: 'SN codes generated', generatedHint: 'Copy or download these codes for distribution. You can reveal them later from the list.',
  copy: 'Copy', copyAll: 'Copy all', copied: 'Copied', copyFailed: 'Copy failed. Select and copy the text manually.', exportBatch: 'Export batch CSV',
  revealTitle: 'Full SN code', secretHint: 'The full SN is a device login credential. Share it only with the intended device user.',
  confirmDisable: 'Disabling this SN immediately blocks new logins and token refreshes. Existing access tokens remain valid until they expire, for up to 3 hours. Disable it?',
  confirmEnable: 'The originally bound device will be able to log in again. Restore this SN?', updated: 'Saved',
  audit: 'Audit trail', event: 'Event', operator: 'Actor account ID', time: 'Time', context: 'Details', noEvents: 'No events yet',
  noData: 'No SN codes', emptySelection: 'Select SN codes to export', invalidGenerate: 'Select an account and an integer quantity from 1 to 100',
  generateFailed: 'Generation was not confirmed. Refresh the list and check the result before generating again.', moreAccounts: 'Load more accounts',
  notBound: 'Not bound', auditNote: 'Reveals and exports are recorded in the audit trail.', close: 'Close', loadFailed: 'Loading failed',
  events: { generate: 'Generated', activate: 'Activated', login: 'Login', reveal: 'Revealed', export: 'Exported', disable: 'Disabled', enable: 'Restored', update: 'Updated' },
}
export const supportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH'] as const
const queryLocale = new URLSearchParams(window.location.search).get('lang') || 'zh-CN'
const i18n = createI18n({
  legacy: false,
  locale: supportedLocales.includes(queryLocale as typeof supportedLocales[number]) ? queryLocale : 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zh, 'zh-TW': zh, 'en-US': en, 'ja-JP': en, 'th-TH': en },
})
export function setLanguage(lang: unknown) {
  if (typeof lang === 'string' && supportedLocales.includes(lang as typeof supportedLocales[number])) i18n.global.locale.value = lang as typeof supportedLocales[number]
}
window.addEventListener('message', (event) => {
  if (event.source === window.parent && event.data?.type === 'LANG_CHANGE') setLanguage(event.data.payload?.lang)
})
export default i18n
