<template>
  <el-config-provider :locale="elementLocale">
    <main class="plugin-shell">
      <router-view v-if="authorized" :key="userId!" />
      <div v-if="state !== 'ready'" class="session-state" role="status">
        <template v-if="!inIframe"><h1>{{ t('title') }}</h1><p>{{ t('fromHost') }}</p></template>
        <el-result v-else-if="state === 'denied' || state === 'revoked'" icon="warning" :title="t(state === 'revoked' ? 'accessRevoked' : 'accessDenied')" :sub-title="t('accessDeniedHint')">
          <template #extra><el-button @click="retry">{{ t('recheckAccess') }}</el-button></template>
        </el-result>
        <el-result v-else-if="state === 'error' || state === 'unavailable'" icon="error" :title="t(state === 'unavailable' ? 'accessUnavailable' : 'sessionFailed')">
          <template #extra><el-button @click="retry">{{ t('retry') }}</el-button></template>
        </el-result>
        <p v-else>{{ t('connecting') }}</p>
      </div>
    </main>
  </el-config-provider>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import ja from 'element-plus/es/locale/lang/ja'
import th from 'element-plus/es/locale/lang/th'
import { isInIframe } from './utils/token'
import { useSession } from './composables/useSession'
import { usePluginMessageBridge } from './composables/usePluginMessageBridge'
import { setThemeFromConfig } from './composables/useTheme'
import { notifyHostPluginUrlChanged } from './utils/hostEvents'
import { setLanguage } from './i18n'
const { t, locale } = useI18n()
const elementLocale = computed(() => ({ 'zh-CN': zhCn, 'zh-TW': zhTw, 'en-US': en, 'ja-JP': ja, 'th-TH': th })[locale.value] || en)
const route = useRoute()
const inIframe = isInIframe()
const { state, authorized, userId, verify, reset, revoke, unavailable, expire, retry } = useSession()
usePluginMessageBridge({
  onInit: ({ token, config }) => {
    if (!inIframe) return
    setThemeFromConfig(config)
    setLanguage(config.lang || config.language)
    void verify(token)
    notifyHostPluginUrlChanged(route.fullPath)
  },
  onTokenUpdate: (token) => { if (inIframe) void verify(token) },
  onDestroy: reset,
})
window.addEventListener('sn-session-expired', expire)
window.addEventListener('sn-access-revoked', revoke)
window.addEventListener('sn-access-unavailable', unavailable)
onBeforeUnmount(() => {
  window.removeEventListener('sn-session-expired', expire)
  window.removeEventListener('sn-access-revoked', revoke)
  window.removeEventListener('sn-access-unavailable', unavailable)
  reset()
})
</script>
<style scoped>
.plugin-shell { min-height: 100vh; }
.session-state { position: fixed; inset: 0; z-index: 5000; display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center; padding: 24px; background: var(--bg-page); text-align: center; }
</style>
