import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { extname, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const courseSource = resolve(rootDir, '../dist-courses/ic-packaging.pigeon')
const courseTarget = resolve(rootDir, 'dist/courses/ic-packaging.pigeon')
const courseCoverSource = resolve(rootDir, '../courses/ic-packaging/cover.png')
const courseCoverTarget = resolve(rootDir, 'dist/courses/ic-packaging-cover.png')
const deliverySource = resolve(rootDir, '../dist-courses')
const docSources = [
  ['pigeon-format.md', resolve(rootDir, '../docs/pigeon-format.md')],
  ['ai-course-authoring-prompt.md', resolve(rootDir, '../docs/ai-course-authoring-prompt.md')],
]

function deliveryFile(url) {
  const relative = decodeURIComponent((url || '').split('?')[0]).replace(/^\/+/, '')
  const target = resolve(deliverySource, relative)
  if (!relative || target === deliverySource || !target.startsWith(`${deliverySource}${sep}`)) return null
  return target
}

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.vtt': 'text/vtt; charset=utf-8',
    '.pigeon': 'application/octet-stream',
  })[extname(file).toLowerCase()] || 'application/octet-stream'
}

function serveFile(req, res, file, type = contentType(file)) {
  const size = statSync(file).size
  const range = req.headers.range
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/)
    let start = match?.[1] ? Number(match[1]) : null
    let end = match?.[2] ? Number(match[2]) : null
    if (match && start === null && end !== null) {
      start = Math.max(0, size - end)
      end = size - 1
    } else {
      start ??= 0
      end ??= size - 1
    }
    if (!match || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    end = Math.min(end, size - 1)
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    if (req.method === 'HEAD') res.end()
    else createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', String(size))
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
}

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
        serveFile(req, res, courseSource, 'application/octet-stream')
      })
      server.middlewares.use('/courses/ic-packaging-cover.png', (req, res) => {
        if (!existsSync(courseCoverSource)) {
          res.statusCode = 404
          res.end('course cover not found')
          return
        }
        serveFile(req, res, courseCoverSource, 'image/png')
      })
      server.middlewares.use('/courses/', (req, res, next) => {
        const file = deliveryFile(req.url)
        if (!file || !existsSync(file)) {
          next()
          return
        }
        serveFile(req, res, file)
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
      if (existsSync(courseCoverSource)) {
        mkdirSync(resolve(rootDir, 'dist/courses'), { recursive: true })
        copyFileSync(courseCoverSource, courseCoverTarget)
      }
      if (existsSync(deliverySource)) {
        for (const entry of readdirSync(deliverySource, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          cpSync(resolve(deliverySource, entry.name), resolve(rootDir, 'dist/courses', entry.name), { recursive: true })
        }
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
