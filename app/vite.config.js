import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const courseSource = resolve(rootDir, '../dist-courses/ic-packaging.pigeon')
const courseTarget = resolve(rootDir, 'dist/courses/ic-packaging.pigeon')
const docSources = [
  ['pigeon-format.md', resolve(rootDir, '../docs/pigeon-format.md')],
  ['ai-course-authoring-prompt.md', resolve(rootDir, '../docs/ai-course-authoring-prompt.md')],
]

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
      server.middlewares.use('/docs/', (req, res, next) => {
        const name = decodeURIComponent((req.url || '').replace(/^\//, ''))
        const doc = docSources.find(([file]) => file === name)
        if (!doc || !existsSync(doc[1])) {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(doc[1]).pipe(res)
      })
    },
    closeBundle() {
      if (existsSync(courseSource)) {
        mkdirSync(resolve(rootDir, 'dist/courses'), { recursive: true })
        copyFileSync(courseSource, courseTarget)
      }
      mkdirSync(resolve(rootDir, 'dist/docs'), { recursive: true })
      for (const [name, source] of docSources) {
        if (existsSync(source)) copyFileSync(source, resolve(rootDir, 'dist/docs', name))
      }
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
        home: 'index.html',
        learn: 'learn.html',
        admin: 'admin.html',
        profile: 'profile.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    open: '/index.html',
  },
})
