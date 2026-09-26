import { createRouter, createWebHistory } from 'vue-router'
import { notifyHostPluginUrlChanged } from '../utils/hostEvents'

const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', redirect: '/codes' },
  { path: '/codes', component: () => import('../views/SnList.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/codes' },
] })
router.afterEach((to) => notifyHostPluginUrlChanged(to.fullPath))
export default router
