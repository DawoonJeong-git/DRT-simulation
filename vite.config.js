// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,

    // ✅ IP로 들어오는 Host도 허용 (Vite host check/차단 케이스 대응)
    allowedHosts: 'all',

    // ✅ IP로 접속할 때 HMR(WebSocket) 꼬임 방지
    hmr: {
      host: '143.248.121.61',
      clientPort: 5173,
    },

    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5055',
        changeOrigin: true,
      },
    },
  },
})