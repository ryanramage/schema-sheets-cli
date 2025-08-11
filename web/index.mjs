import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export class WebFormServer {
  constructor() {
    this.server = null
    this.port = null
    this.sessions = new Map() // Store session data
    this.resolvers = new Map() // Store promise resolvers for each session
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleRequest.bind(this))
      
      // Find available port starting from 3000
      this.server.listen(0, 'localhost', () => {
        this.port = this.server.address().port
        console.log(`Web form server started on http://localhost:${this.port}`)
        resolve(this.port)
      })
      
      this.server.on('error', reject)
    })
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve)
        this.server = null
        this.port = null
      })
    }
  }

  async handleRequest(req, res) {
    const parsedUrl = parse(req.url, true)
    const { pathname, query } = parsedUrl

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    try {
      if (pathname === '/') {
        await this.serveFile(res, 'assets/index.html', 'text/html')
      } else if (pathname === '/app.js') {
        await this.serveFile(res, 'assets/app.js', 'application/javascript')
      } else if (pathname === '/styles.css') {
        await this.serveFile(res, 'assets/styles.css', 'text/css')
      } else if (pathname === '/favicon.ico') {
        // Return empty favicon to prevent 404
        res.writeHead(204)
        res.end()
      } else if (pathname.startsWith('/api/schema/')) {
        const schemaId = pathname.split('/')[3]
        await this.handleSchemaRequest(res, schemaId, query.session)
      } else if (pathname === '/api/submit') {
        await this.handleSubmit(req, res)
      } else if (pathname === '/api/close') {
        await this.handleClose(req, res)
      } else {
        res.writeHead(404)
        res.end('Not Found')
      }
    } catch (error) {
      console.error('Server error:', error)
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  }

  async serveFile(res, filePath, contentType) {
    try {
      const fullPath = join(__dirname, filePath)
      const content = await readFile(fullPath, 'utf8')
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch (error) {
      res.writeHead(404)
      res.end('File not found')
    }
  }

  async handleSchemaRequest(res, schemaId, sessionId) {
    const sessionData = this.sessions.get(sessionId)
    if (!sessionData) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    if (sessionData.schemaId !== schemaId) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Schema not found for session' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(sessionData.schema))
  }

  async handleSubmit(req, res) {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const { sessionId, formData } = data

        const resolver = this.resolvers.get(sessionId)
        if (resolver) {
          resolver.resolve({ success: true, data: formData })
          this.resolvers.delete(sessionId)
          this.sessions.delete(sessionId)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
  }

  async handleClose(req, res) {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const { sessionId } = data

        const resolver = this.resolvers.get(sessionId)
        if (resolver) {
          resolver.resolve({ success: false, cancelled: true })
          this.resolvers.delete(sessionId)
          this.sessions.delete(sessionId)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
  }

  // Method to create a session and wait for form completion
  async createFormSession(schemaId, schema) {
    const sessionId = crypto.randomUUID()
    
    this.sessions.set(sessionId, {
      schemaId,
      schema,
      createdAt: Date.now()
    })

    // Create a promise that will be resolved when form is submitted
    const promise = new Promise((resolve, reject) => {
      this.resolvers.set(sessionId, { resolve, reject })
      
      // Set timeout for 10 minutes
      setTimeout(() => {
        if (this.resolvers.has(sessionId)) {
          this.resolvers.delete(sessionId)
          this.sessions.delete(sessionId)
          reject(new Error('Form session timed out'))
        }
      }, 10 * 60 * 1000)
    })

    return { sessionId, promise }
  }
}
