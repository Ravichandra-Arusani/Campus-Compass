// public/sw.js - Service Worker for offline tile caching
const TILE_CACHE = 'vbit-tiles-v1'
const TILE_PATTERNS = [
  /cartocdn\.com/,
  /openstreetmap\.org/,
]

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', e => {
  const url = e.request.url
  const isTile = TILE_PATTERNS.some(p => p.test(url))
  if (!isTile) return

  e.respondWith(
    caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached
        return fetch(e.request).then(response => {
          if (response.ok) cache.put(e.request, response.clone())
          return response
        }).catch(() => cached || new Response('', { status: 503 }))
      })
    )
  )
})
