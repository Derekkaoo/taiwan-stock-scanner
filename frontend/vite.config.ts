import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),   // Tailwind v4 uses Vite plugin，不再需要 postcss.config.js
  ],
  // 靜態 JSON 模式：build 後直接讀取 /data/*.json
  // 無需後端 API，適合 Firebase Hosting 部署
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    // 開發時 proxy 後端 API
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
