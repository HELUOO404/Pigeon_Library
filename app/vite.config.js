import { resolve } from 'path'
import { defineConfig } from 'vite'

// 双入口:首页(index.html) + 学习页(learn.html)。
// 产出纯静态文件,可直接部署到云服务器(nginx 等)。
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        learn: resolve(__dirname, 'learn.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: '/index.html',
  },
})
