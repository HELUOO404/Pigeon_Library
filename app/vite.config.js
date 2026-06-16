import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const courseSource = resolve(rootDir, '../dist-courses/ic-packaging.pigeon')
const courseTarget = resolve(rootDir, 'dist/courses/ic-packaging.pigeon')

function serveBuiltinCourse() {
  return {
    name: 'serve-builtin-course',
    configureServer(server) {
      server.middlewares.use('/courses/ic-packaging.pigeon', (req, res) => {
        if (!existsSync(courseSource)) {
          res.statusCode = 404
          res.end('course package not found')
          return
        }
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(courseSource).pipe(res)
      })
    },
    closeBundle() {
      if (!existsSync(courseSource)) return
      mkdirSync(resolve(rootDir, 'dist/courses'), { recursive: true })
      copyFileSync(courseSource, courseTarget)
    },
  }
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [serveBuiltinCourse()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        learn: 'learn.html',
      },
    },
  },
  server: {
    port: 5173,
    open: '/learn.html?course=ic-packaging',
  },
})
