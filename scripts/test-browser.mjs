// Requires the host web workspace's Playwright installation and the plugin on :3018.
// Every API is intercepted; this check never reads or writes real account/SN data.
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const errors = [], operations = []
  page.on('pageerror', (error) => errors.push(error.message))
  let role = 'root', accessScope = 'root-only', snSession = false, failGenerate = false, configUnavailable = false
  const hasAccess = () => !snSession && ({ root: 4, admin: 3, manager: 2, user: 1 }[role] >= { 'root-only': 4, 'admin-only': 3, 'manager-only': 2, 'auth-only': 1 }[accessScope])
  let records = [
    { id: 1, sn_tail: 'A1B2', user_id: 9, username: 'classroom', nickname: '教室账号', enabled: true, status: 'pending', device_uuid: null, created_at: 1790424000, activated_at: null, last_login_at: null, remark: '第一批设备' },
    { id: 2, sn_tail: 'C3D4', user_id: 9, username: 'classroom', nickname: '教室账号', enabled: true, status: 'active', device_uuid: 'rokid-test-device-002', created_at: 1790424000, activated_at: 1790424100, last_login_at: 1790424200, remark: '已激活设备' },
  ]
  const events = [{ id: 1, event_type: 'device_sn', action: 'generate', user_id: 4, created_at: 1790424000, context: { count: 1 } }]
  await context.route('**/__sn_test_host*', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe src="http://127.0.0.1:3018/codes"></iframe><script>window.events=[];addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow)return;events.push(e.data);if(e.data.type==='PLUGIN_READY')e.source.postMessage({type:'INIT',id:'test-init',payload:{token:'fixture-token',config:{theme:'modern-blue',lang:'zh-CN'}}},'*')})</script>` })
  })
  await context.route('http://127.0.0.1:3018/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname
    assert.equal(request.headers().authorization, 'Bearer fixture-token')
    if (path.endsWith('/plugin/verify-token')) return route.fulfill({ json: { code: 0, data: { id: 4, roles: [role] } } })
    if (path.endsWith('/plugin-sn/access')) {
      if (configUnavailable) return route.fulfill({ status: 503, json: { error_code: 'PLUGIN_ACCESS_CONFIG_UNAVAILABLE', message: 'Plugin access configuration is unavailable.' } })
      return route.fulfill({ json: { success: true, data: { allowed: hasAccess(), access_scope: accessScope } } })
    }
    operations.push({ method, path, body: request.postDataJSON() })
    if (configUnavailable) return route.fulfill({ status: 503, json: { error_code: 'PLUGIN_ACCESS_CONFIG_UNAVAILABLE', message: 'Plugin access configuration is unavailable.' } })
    if (!hasAccess()) return route.fulfill({ status: 403, json: { message: 'SN management access denied' } })
    let data
    if (path.endsWith('/accounts')) data = { items: [{ id: 9, username: 'classroom', nickname: '教室账号' }], total: 1, page: 1, page_size: 30 }
    else if (path.endsWith('/generate')) {
      if (failGenerate) { failGenerate = false; return route.fulfill({ status: 503, json: { message: 'Temporary failure' } }) }
      const body = request.postDataJSON()
      data = { items: Array.from({ length: body.count }, (_, i) => ({ ...records[0], id: records.length + i + 1, sn_tail: `T${i}ST`, remark: body.remark, sn: `TEST-ONLY-GENERATED-${i}` })) }
      records = [...records, ...data.items.map(({ sn, ...row }) => row)]
    } else if (path.endsWith('/reveal')) data = { id: 1, sn: 'TEST-ONLY-REVEALED-SN' }
    else if (path.endsWith('/export')) data = { items: request.postDataJSON().ids.map((id) => ({ ...records.find((r) => r.id === id), sn: `TEST-EXPORT-${id}`, username: '=SUM(A1)', remark: 'comma,"quote"' })) }
    else if (/\/plugin-sn\/\d+$/.test(path)) {
      const row = records.find((r) => r.id === Number(path.split('/').at(-1)))
      if (method === 'PATCH') { Object.assign(row, request.postDataJSON()); row.status = !row.enabled ? 'disabled' : row.device_uuid ? 'active' : 'pending' }
      data = { ...row, events }
    } else if (path.endsWith('/plugin-sn')) {
      const status = url.searchParams.get('status')
      const items = records.filter((row) => !status || row.status === status)
      data = { items, total: items.length, page: 1, page_size: 20 }
    } else throw new Error(`Unexpected API ${method} ${path}`)
    await route.fulfill({ json: { success: true, data } })
  })
  const frame = () => page.frameLocator('iframe')
  const send = async (type, payload) => page.evaluate(({ type, payload }) => document.querySelector('iframe').contentWindow.postMessage({ type, id: 'test', payload }, '*'), { type, payload })
  const verifySession = (type, payload) => Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/plugin-sn/access')),
    send(type, payload),
  ])
  await page.goto('http://127.0.0.1:3018/__sn_test_host')
  await frame().getByRole('heading', { name: 'SN 分发管理' }).waitFor()
  await frame().getByText('A1B2', { exact: false }).waitFor()
  assert.equal(await page.evaluate(() => window.events.filter((e) => e.type === 'PLUGIN_READY').length), 1)

  await frame().getByRole('button', { name: '查看完整码', exact: true }).first().click()
  const secretDialog = frame().getByRole('dialog', { name: '完整 SN' })
  assert.equal(await secretDialog.getByRole('textbox').inputValue(), 'TEST-ONLY-REVEALED-SN')
  await secretDialog.getByRole('button', { name: '复制', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'TEST-ONLY-REVEALED-SN')
  await secretDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await secretDialog.waitFor({ state: 'hidden' })

  await frame().getByRole('button', { name: '生成 SN', exact: true }).click()
  const generateDialog = frame().getByRole('dialog', { name: '生成 SN' })
  await generateDialog.getByRole('button', { name: '生成 SN', exact: true }).click()
  await generateDialog.getByText('请选择账号并输入 1–100 的整数数量').waitFor()
  await generateDialog.getByRole('combobox').click()
  await frame().getByRole('option').filter({ hasText: 'classroom' }).click()
  await generateDialog.getByRole('spinbutton').fill('2')
  await generateDialog.getByRole('textbox').fill('验收测试')
  await generateDialog.getByRole('button', { name: '生成 SN', exact: true }).click()
  const batch = frame().getByRole('dialog', { name: '本批次生成成功' })
  await batch.waitFor()
  assert.equal((await batch.getByRole('textbox').inputValue()).split('\n').length, 2)
  const downloadPromise = page.waitForEvent('download')
  await batch.getByRole('button', { name: '导出本批次 CSV' }).click()
  const download = await downloadPromise
  const csv = await fs.readFile(await download.path(), 'utf8')
  assert.ok(csv.includes('"\'=SUM(A1)"'))
  assert.ok(csv.includes('"comma,""quote"""'))
  await batch.getByRole('button', { name: '关闭', exact: true }).click()
  await batch.waitFor({ state: 'hidden' })
  await frame().locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate((element) => { element.scrollLeft = 0 })
  await frame().locator('.el-table__header-wrapper .el-checkbox__inner').click()
  const selectedDownload = page.waitForEvent('download')
  await frame().getByRole('button', { name: /导出所选 CSV/ }).click()
  const selectedCsv = await fs.readFile(await (await selectedDownload).path(), 'utf8')
  assert.equal(selectedCsv.split('\r\n').length, 5)

  await frame().getByRole('button', { name: '停用', exact: true }).first().click()
  await frame().getByRole('button', { name: '确认', exact: true }).click()
  await frame().getByRole('button', { name: '恢复', exact: true }).waitFor()
  await frame().getByRole('button', { name: '恢复', exact: true }).click()
  await frame().getByRole('button', { name: '确认', exact: true }).click()
  await frame().getByRole('button', { name: '详情', exact: true }).first().click()
  const drawer = frame().getByRole('dialog', { name: '详情' })
  await drawer.getByRole('heading', { name: '操作记录' }).waitFor()
  await drawer.getByRole('textbox').fill('updated remark')
  await drawer.getByRole('button', { name: '保存备注', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('.remark-form textarea')?.value === 'updated remark')
  await drawer.locator('.el-drawer__close-btn').click()
  await drawer.waitFor({ state: 'hidden' })

  failGenerate = true
  await frame().getByRole('button', { name: '生成 SN', exact: true }).click()
  await generateDialog.getByRole('combobox').click()
  await frame().getByRole('option').filter({ hasText: 'classroom' }).click()
  await generateDialog.getByRole('textbox').fill('preserved draft')
  await generateDialog.getByRole('button', { name: '生成 SN', exact: true }).click()
  await generateDialog.getByText(/请先刷新列表核对结果/).waitFor()
  assert.equal(await generateDialog.getByRole('textbox').inputValue(), 'preserved draft')
  await generateDialog.getByRole('button', { name: '取消', exact: true }).click()
  await generateDialog.waitFor({ state: 'hidden' })

  await send('THEME_CHANGE', { theme: 'deep-space' })
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument.documentElement.classList.contains('dark'))
  await send('LANG_CHANGE', { lang: 'en-US' })
  await frame().getByRole('heading', { name: 'SN distribution' }).waitFor()
  await page.waitForTimeout(400)
  await page.setViewportSize({ width: 390, height: 844 })
  await frame().locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate((element) => { element.scrollLeft = 0 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/sn-management-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/sn-management-desktop.png', fullPage: true })

  role = 'admin'
  accessScope = 'admin-only'
  await verifySession('TOKEN_UPDATE', { token: 'fixture-token' })
  await frame().getByRole('heading', { name: 'SN distribution' }).waitFor()
  await frame().getByRole('button', { name: 'Reveal code', exact: true }).first().click()
  await frame().getByRole('dialog', { name: 'Full SN code' }).waitFor()
  accessScope = 'root-only'
  const requestCount = operations.length
  // Revoke without a token update: the next API call must close already revealed data.
  await page.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('.toolbar button').click())
  await frame().getByText('SN management access has changed', { exact: true }).waitFor()
  assert.equal(await frame().locator('.sn-page').count(), 0)
  assert.equal(await frame().getByRole('dialog', { name: 'Full SN code' }).count(), 0)
  assert.equal(operations.length, requestCount + 1)
  // A forged host config cannot grant access against the server's decision.
  await verifySession('INIT', { token: 'fixture-token', config: { accessScope: 'admin-only', lang: 'en-US' } })
  await frame().getByText('This account does not have SN management access', { exact: true }).waitFor()
  assert.equal(await frame().locator('.sn-page').count(), 0)
  assert.equal(operations.length, requestCount + 1)
  // Even auth-only cannot grant a device SN session management capabilities.
  role = 'user'
  accessScope = 'auth-only'
  snSession = true
  await verifySession('TOKEN_UPDATE', { token: 'fixture-token' })
  await frame().getByText('This account does not have SN management access', { exact: true }).waitFor()
  assert.equal(await frame().locator('.sn-page').count(), 0)
  role = 'root'
  accessScope = 'root-only'
  snSession = false
  await verifySession('TOKEN_UPDATE', { token: 'fixture-token' })
  await frame().getByRole('heading', { name: 'SN distribution' }).waitFor()
  await frame().getByRole('button', { name: 'Reveal code', exact: true }).first().click()
  await frame().getByRole('dialog', { name: 'Full SN code' }).waitFor()
  configUnavailable = true
  const policyFailureCount = operations.length
  await page.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('.toolbar button').click())
  await frame().getByText('SN management access cannot be verified. Please try again later.', { exact: true }).waitFor()
  assert.equal(await frame().locator('.sn-page').count(), 0)
  assert.equal(await frame().getByRole('dialog', { name: 'Full SN code' }).count(), 0)
  assert.equal(operations.length, policyFailureCount + 1)
  configUnavailable = false
  await verifySession('TOKEN_UPDATE', { token: 'fixture-token' })
  await frame().getByRole('heading', { name: 'SN distribution' }).waitFor()
  await send('DESTROY', {})
  await frame().getByText('Verifying SN management access…').waitFor()
  assert.equal(await frame().locator('.sn-page').count(), 0)
  await page.goto('http://127.0.0.1:3018/codes')
  await page.getByText('请从主系统的 SN 分发管理插件进入。').waitFor()
  assert.deepEqual(errors, [])
  assert.equal(operations.filter((op) => op.path.endsWith('/generate')).length, 2)
  assert.ok(operations.some((op) => op.method === 'PATCH' && op.body.remark === 'updated remark'))
  console.log('Passed: handshake, dynamic access, reveal/copy, generation validation, batch generation/export, CSV safety, disable/restore, remark/audit, business-503 draft preservation, theme/language, mobile, admin grant/revocation, forged INIT denial, SN-session denial, policy-503 teardown, destroy, standalone gate.')
} finally {
  await browser.close()
}
