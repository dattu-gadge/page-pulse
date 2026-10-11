import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    server: {
      proxy: { '/api': { target: env.VITE_DEV_API_URL || 'http://localhost:5000', changeOrigin: true } },
    },
  }
})
