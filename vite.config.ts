import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue()],
    server: {
      port: 3018,
      strictPort: true,
      proxy: { '/api/': {
        target: env.APP_API_URL || 'http://localhost:8081',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      } },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
