/**
 * In-process SSE + anonymous counters for the LFG hub.
 */
/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set()

const metrics = {
  listingsCreated: 0,
  joins: 0,
  leaves: 0,
  reports: 0,
  discordPosts: 0,
  peakListings: 0,
  startedAt: new Date().toISOString(),
}

/**
 * @param {number} n
 */
export function noteListingCount(n) {
  if (n > metrics.peakListings) metrics.peakListings = n
}

/**
 * @param {'listingsCreated' | 'joins' | 'leaves' | 'reports' | 'discordPosts'} key
 * @param {number} [by]
 */
export function bumpMetric(key, by = 1) {
  metrics[key] = (metrics[key] || 0) + by
}

export function getHubMetrics() {
  return {
    ...metrics,
    sseClients: sseClients.size,
  }
}

/**
 * @param {string} event
 * @param {object} [data]
 */
export function broadcastLfgEvent(event, data = {}) {
  if (!sseClients.size) return
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, at: new Date().toISOString() })}\n\n`
  for (const res of [...sseClients]) {
    try {
      res.write(payload)
    } catch {
      sseClients.delete(res)
    }
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} origin
 */
export function attachSseClient(req, res, origin) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': origin || '*',
    'X-Accel-Buffering': 'no',
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: new Date().toISOString() })}\n\n`)
  sseClients.add(res)
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`)
    } catch {
      clearInterval(heartbeat)
      sseClients.delete(res)
    }
  }, 25_000)
  const cleanup = () => {
    clearInterval(heartbeat)
    sseClients.delete(res)
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}
