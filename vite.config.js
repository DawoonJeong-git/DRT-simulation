// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // ✅ 로컬에서 프론트는 항상 /api 로만 호출 → server.py 로 전달
      '/api': {
        target: 'http://127.0.0.1:5055',
        changeOrigin: true,
      },
    }
  }
})
