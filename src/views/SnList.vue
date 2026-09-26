<template>
  <section class="sn-page">
    <header class="page-header"><div><h1>{{ t('title') }}</h1><p>{{ t('subtitle') }}</p></div><el-button type="primary" @click="openGenerate">{{ t('generate') }}</el-button></header>
    <div class="toolbar">
      <el-input v-model="query" :placeholder="t('search')" clearable @keyup.enter="filterList" @clear="filterList" />
      <el-select v-model="status" :placeholder="t('allStatus')" clearable @change="filterList"><el-option v-for="s in statuses" :key="s" :value="s" :label="t(`status.${s}`)" /></el-select>
      <el-select v-model="filterAccount" :placeholder="t('allAccounts')" clearable filterable remote :remote-method="findAccounts" :loading="accountsLoading" @visible-change="(open: boolean) => open && findAccounts('')" @change="filterList"><el-option v-for="a in accounts" :key="a.id" :value="a.id" :label="accountLabel(a)" /><template #footer><el-button v-if="accounts.length < accountTotal" text @click="moreAccounts">{{ t('moreAccounts') }}</el-button></template></el-select>
      <el-button :loading="loading" @click="filterList">{{ t('refresh') }}</el-button>
      <el-button :disabled="!selected.length" :loading="exporting" @click="exportSelected">{{ t('export') }}<span v-if="selected.length"> ({{ selected.length }})</span></el-button>
    </div>
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false" class="error-alert" />
    <div class="table-card">
      <el-table v-loading="loading" :data="items" row-key="id" :empty-text="t('noData')" @selection-change="(rows: SnItem[]) => selected = rows">
        <el-table-column type="selection" width="44" />
        <el-table-column :label="t('code')" min-width="155"><template #default="{ row }"><code>••••-{{ row.sn_tail }}</code></template></el-table-column>
        <el-table-column :label="t('account')" min-width="165"><template #default="{ row }"><strong>{{ row.username }}</strong><span class="secondary block">{{ row.nickname || `#${row.user_id}` }}</span></template></el-table-column>
        <el-table-column :label="t('statusLabel')" width="115"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ t(`status.${row.status}`) }}</el-tag></template></el-table-column>
        <el-table-column :label="t('device')" min-width="210" show-overflow-tooltip><template #default="{ row }"><code>{{ row.device_uuid || t('notBound') }}</code></template></el-table-column>
        <el-table-column :label="t('created')" min-width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column :label="t('activated')" min-width="170"><template #default="{ row }">{{ formatTime(row.activated_at) }}</template></el-table-column>
        <el-table-column :label="t('lastLogin')" min-width="170"><template #default="{ row }">{{ formatTime(row.last_login_at) }}</template></el-table-column>
        <el-table-column prop="remark" :label="t('remark')" min-width="160" show-overflow-tooltip />
        <el-table-column :label="t('actions')" :fixed="narrow ? false : 'right'" width="242"><template #default="{ row }"><el-button link type="primary" @click="showDetail(row.id)">{{ t('detail') }}</el-button><el-button link type="primary" :disabled="busyId === row.id" @click="reveal(row)">{{ t('reveal') }}</el-button><el-button link :type="row.enabled ? 'danger' : 'success'" :disabled="busyId !== null" @click="toggle(row)">{{ t(row.enabled ? 'disable' : 'enable') }}</el-button></template></el-table-column>
      </el-table>
      <div class="pagination"><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="filterList" /></div>
    </div>
    <p class="secondary audit-note">{{ t('auditNote') }}</p>

    <el-dialog v-model="generateOpen" :title="t('generate')" width="min(540px, 94vw)" :close-on-click-modal="!generating" :close-on-press-escape="!generating" :show-close="!generating">
      <el-form label-position="top" @submit.prevent="generate">
        <el-form-item :label="t('account')" required><el-select v-model="draft.user_id" :placeholder="t('selectAccount')" filterable remote :remote-method="findAccounts" :loading="accountsLoading" class="full"><el-option v-for="a in accounts" :key="a.id" :value="a.id" :label="accountLabel(a)" /><template #footer><el-button v-if="accounts.length < accountTotal" text @click="moreAccounts">{{ t('moreAccounts') }}</el-button></template></el-select><span class="form-hint">{{ t('accountHint') }}</span></el-form-item>
        <el-form-item :label="t('count')" required><el-input-number v-model="draft.count" :min="1" :max="100" :precision="0" /><span class="count-hint">{{ t('countHint') }}</span></el-form-item>
        <el-form-item :label="t('remark')"><el-input v-model="draft.remark" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
        <el-alert v-if="generateError" :title="generateError" type="error" :closable="false" show-icon />
      </el-form>
      <template #footer><el-button :disabled="generating" @click="generateOpen = false">{{ t('cancel') }}</el-button><el-button type="primary" :loading="generating" @click="generate">{{ t('generate') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="batchOpen" :title="t('generated')" width="min(680px, 94vw)" @closed="generated = []"><p class="dialog-note">{{ t('generatedHint') }}</p><el-input :model-value="generated.map((row) => row.sn).join('\n')" type="textarea" readonly :rows="Math.min(12, Math.max(3, generated.length))" class="secret-text" /><template #footer><el-button @click="copy(generated.map((row) => row.sn).join('\n'))">{{ t('copyAll') }}</el-button><el-button :loading="exporting" @click="exportBatch">{{ t('exportBatch') }}</el-button><el-button type="primary" @click="batchOpen = false">{{ t('close') }}</el-button></template></el-dialog>
    <el-dialog v-model="revealOpen" :title="t('revealTitle')" width="min(540px, 94vw)" @closed="revealed = ''"><p class="dialog-note">{{ t('secretHint') }}</p><el-input :model-value="revealed" readonly class="secret-text" /><template #footer><el-button @click="revealOpen = false">{{ t('close') }}</el-button><el-button type="primary" @click="copy(revealed)">{{ t('copy') }}</el-button></template></el-dialog>

    <el-drawer v-model="detailOpen" :title="t('detail')" size="min(640px, 100vw)" @closed="detail = null">
      <div v-loading="detailLoading">
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false" />
        <template v-if="detail"><el-descriptions :column="1" border>
          <el-descriptions-item :label="t('code')"><code>••••-{{ detail.sn_tail }}</code></el-descriptions-item>
          <el-descriptions-item :label="t('account')">{{ detail.username }} (#{{ detail.user_id }})</el-descriptions-item>
          <el-descriptions-item :label="t('statusLabel')">{{ t(`status.${detail.status}`) }}</el-descriptions-item>
          <el-descriptions-item :label="t('device')"><code class="break">{{ detail.device_uuid || t('notBound') }}</code></el-descriptions-item>
          <el-descriptions-item :label="t('created')">{{ formatTime(detail.created_at) }}</el-descriptions-item>
          <el-descriptions-item :label="t('activated')">{{ formatTime(detail.activated_at) }}</el-descriptions-item>
          <el-descriptions-item :label="t('lastLogin')">{{ formatTime(detail.last_login_at) }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-position="top" class="remark-form"><el-form-item :label="t('remark')"><el-input v-model="editRemark" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item><el-button type="primary" :loading="savingRemark" @click="saveRemark">{{ t('save') }}</el-button></el-form>
        <h2>{{ t('audit') }}</h2><el-empty v-if="!detail.events.length" :description="t('noEvents')" /><el-timeline v-else class="audit-timeline"><el-timeline-item v-for="event in detail.events" :key="event.id" :timestamp="formatTime(event.created_at)"><strong>{{ eventName(event) }}</strong><p class="secondary">{{ t('operator') }}: {{ event.user_id ?? '—' }}</p><pre v-if="event.context" class="audit-context">{{ formatContext(event.context) }}</pre></el-timeline-item></el-timeline>
        </template>
      </div>
    </el-drawer>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { type Account, type AuditEvent, type SnDetail, type SnItem, type SnStatus, errorMessage, exportCodes, generateCodes, getCode, listCodes, revealCode, searchAccounts, updateCode } from '../api'
import { downloadCodes } from '../utils/csv'
const { t, te, locale } = useI18n()
const viewport = window.matchMedia('(max-width: 600px)')
const narrow = ref(viewport.matches)
const resize = () => { narrow.value = viewport.matches }
const statuses: SnStatus[] = ['pending', 'active', 'disabled']
const query = ref(''), status = ref(''), filterAccount = ref<number>(), page = ref(1), pageSize = ref(20), total = ref(0)
const items = ref<SnItem[]>([]), selected = ref<SnItem[]>([]), loading = ref(false), loadError = ref('')
const accounts = ref<Account[]>([]), accountsLoading = ref(false), accountTotal = ref(0)
let accountQuery = '', accountPage = 1, accountRun = 0, listRun = 0, detailRun = 0, alive = true
const generateOpen = ref(false), generating = ref(false), generateError = ref(''), batchOpen = ref(false)
const draft = reactive({ user_id: undefined as number | undefined, count: 1, remark: '' })
const generated = ref<(SnItem & { sn: string })[]>([]), exporting = ref(false), busyId = ref<number | null>(null)
const revealOpen = ref(false), revealed = ref(''), detailOpen = ref(false), detailLoading = ref(false), detailError = ref('')
const detail = ref<SnDetail | null>(null), editRemark = ref(''), savingRemark = ref(false)
watch(detailOpen, (open) => { if (!open) detailRun++ })
const accountLabel = (a: Account) => `${a.username}${a.nickname ? ` · ${a.nickname}` : ''} (#${a.id})`
const statusType = (value: SnStatus) => value === 'active' ? 'success' : value === 'disabled' ? 'danger' : 'info'
function formatTime(value: number | string | null) {
  if (value == null || value === '') return '—'
  const numeric = typeof value === 'number' || /^\d+$/.test(value) ? Number(value) : null
  const date = new Date(numeric == null ? value : numeric < 1e12 ? numeric * 1000 : numeric)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale.value, { hour12: false })
}
const formatContext = (value: AuditEvent['context']) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const eventName = (event: AuditEvent) => te(`events.${event.action || event.event_type}`) ? t(`events.${event.action || event.event_type}`) : event.action || event.event_type
async function load() {
  const run = ++listRun; loading.value = true; loadError.value = ''; selected.value = []
  try {
    const result = await listCodes({ q: query.value.trim() || undefined, status: status.value || undefined, user_id: filterAccount.value, page: page.value, page_size: pageSize.value })
    if (!alive || run !== listRun) return
    items.value = result.items; total.value = result.total
  } catch (error) { if (alive && run === listRun) { items.value = []; total.value = 0; loadError.value = errorMessage(error) } }
  finally { if (alive && run === listRun) loading.value = false }
}
function filterList() { const changed = page.value !== 1; page.value = 1; if (!changed) void load() }
async function findAccounts(q: string, append = false) {
  const run = ++accountRun; accountsLoading.value = true
  if (!append) { accountQuery = q; accountPage = 1; accounts.value = [] }
  try {
    const result = await searchAccounts(accountQuery, accountPage)
    if (!alive || run !== accountRun) return
    accounts.value = append ? [...accounts.value, ...result.items] : result.items; accountTotal.value = result.total
  } catch (error) { if (alive && run === accountRun) ElMessage.error(errorMessage(error)) }
  finally { if (alive && run === accountRun) accountsLoading.value = false }
}
function moreAccounts() { if (!accountsLoading.value) { accountPage++; void findAccounts(accountQuery, true) } }
function openGenerate() { generateError.value = ''; generateOpen.value = true; void findAccounts('') }
async function generate() {
  if (generating.value) return
  if (!draft.user_id || !Number.isInteger(draft.count) || draft.count < 1 || draft.count > 100) { generateError.value = t('invalidGenerate'); return }
  generating.value = true; generateError.value = ''
  try {
    const result = await generateCodes({ user_id: draft.user_id, count: draft.count, remark: draft.remark })
    if (!alive) return
    generated.value = result.items; generateOpen.value = false; batchOpen.value = true
    draft.user_id = undefined; draft.count = 1; draft.remark = ''; await load()
  } catch (error) { if (alive) generateError.value = `${errorMessage(error)} ${t('generateFailed')}` }
  finally { if (alive) generating.value = false }
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); if (alive) ElMessage.success(t('copied')) }
  catch { if (alive) ElMessage.warning(t('copyFailed')) }
}
async function exportIds(ids: number[]) {
  if (exporting.value || !ids.length) return
  exporting.value = true
  try { const result = await exportCodes(ids); if (alive) downloadCodes(result.items) }
  catch (error) { if (alive) ElMessage.error(errorMessage(error)) }
  finally { if (alive) exporting.value = false }
}
function exportSelected() { return exportIds(selected.value.map((row) => row.id)) }
function exportBatch() { return exportIds(generated.value.map((row) => row.id)) }
async function reveal(row: SnItem) {
  if (busyId.value !== null) return
  busyId.value = row.id
  try { const result = await revealCode(row.id); if (alive) { revealed.value = result.sn; revealOpen.value = true } }
  catch (error) { if (alive) ElMessage.error(errorMessage(error)) }
  finally { if (alive) busyId.value = null }
}
async function toggle(row: SnItem) {
  if (busyId.value !== null) return
  busyId.value = row.id
  try {
    await ElMessageBox.confirm(t(row.enabled ? 'confirmDisable' : 'confirmEnable'), t(row.enabled ? 'disable' : 'enable'), { type: 'warning', confirmButtonText: t('confirm'), cancelButtonText: t('cancel') })
    if (!alive) return
    await updateCode(row.id, { enabled: !row.enabled })
    if (!alive) return
    ElMessage.success(t('updated')); await load()
    if (detail.value?.id === row.id) await showDetail(row.id)
  } catch (error) { if (alive && error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error)) }
  finally { if (alive) busyId.value = null }
}
async function showDetail(id: number) {
  const run = ++detailRun; detailOpen.value = true; detailLoading.value = true; detailError.value = ''; detail.value = null
  try { const result = await getCode(id); if (alive && run === detailRun) { detail.value = result; editRemark.value = result.remark || '' } }
  catch (error) { if (alive && run === detailRun) detailError.value = errorMessage(error) }
  finally { if (alive && run === detailRun) detailLoading.value = false }
}
async function saveRemark() {
  if (!detail.value || savingRemark.value) return
  const id = detail.value.id, remark = editRemark.value
  savingRemark.value = true
  try {
    await updateCode(id, { remark })
    if (alive) {
      ElMessage.success(t('updated'))
      if (detailOpen.value && detail.value?.id === id) await showDetail(id)
      await load()
    }
  }
  catch (error) { if (alive) ElMessage.error(errorMessage(error)) }
  finally { if (alive) savingRemark.value = false }
}
onMounted(() => { viewport.addEventListener('change', resize); void load() })
onBeforeUnmount(() => { viewport.removeEventListener('change', resize); alive = false; listRun++; detailRun++; accountRun++; generated.value = []; revealed.value = '' })
</script>

<style scoped>
.sn-page { padding: 28px; max-width: 1800px; margin: auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 24px; }
h1 { font-size: 26px; margin-bottom: 8px; } h2 { font-size: 18px; margin: 24px 0; }
.page-header p,.secondary,.form-hint,.dialog-note { color: var(--text-secondary); line-height: 1.6; }
.toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 140px minmax(160px, 230px) auto auto; gap: 12px; margin-bottom: 16px; }
.toolbar .el-button + .el-button { margin-left: 0; }
.table-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; }
.table-card :deep(.el-table) { --el-table-bg-color: var(--bg-card); --el-table-tr-bg-color: var(--bg-card); --el-table-header-bg-color: var(--bg-card); --el-table-row-hover-bg-color: var(--bg-hover); }
.table-card :deep(.el-table__body td.el-table__cell) { background-color: var(--el-table-tr-bg-color); }
.table-card :deep(.el-table__body tr:hover > td.el-table__cell) { background-color: var(--el-table-row-hover-bg-color); }
.pagination { display: flex; justify-content: flex-end; padding: 18px; overflow: auto; }
.block { display: block; font-size: 12px; }.error-alert { margin-bottom: 16px; }.audit-note { margin-top: 14px; font-size: 12px; }
.full { width: 100%; }.form-hint { font-size: 12px; margin-top: 6px; }.count-hint { margin-left: 12px; color: var(--text-secondary); }
.dialog-note { margin-bottom: 16px; }.secret-text :deep(input),.secret-text :deep(textarea),code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.remark-form { margin-top: 24px; }.audit-timeline { margin-top: 16px; padding-left: 6px; }.audit-context { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; padding: 8px; margin-top: 8px; background: var(--bg-hover); }.break { overflow-wrap: anywhere; }
@media(max-width: 1000px) { .toolbar { grid-template-columns: 1fr 1fr; }.toolbar > :first-child { grid-column: 1 / -1; } }
@media(max-width: 600px) { .sn-page { padding: 16px; }.page-header { align-items: flex-start; flex-direction: column; gap: 12px; }h1 { font-size: 23px; }.pagination { justify-content: flex-start; padding: 12px; }.toolbar { grid-template-columns: 1fr; }.page-header p { font-size: 13px; } }
</style>
