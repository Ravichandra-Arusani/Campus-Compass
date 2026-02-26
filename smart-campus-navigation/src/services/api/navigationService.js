import { getAccessToken } from "../authService"

const BASE_URL = import.meta.env.VITE_API_BASE || "/api"
const GRAPH_CACHE_STORAGE_KEY = "smart-campus-navigation:graph-cache:v1"

let cachedGraphData = null
let cachedGraphVersion = null
let hasHydratedLocalCache = false

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function hydrateLocalGraphCache() {
  if (hasHydratedLocalCache || !canUseLocalStorage()) {
    return
  }

  hasHydratedLocalCache = true

  try {
    const raw = window.localStorage.getItem(GRAPH_CACHE_STORAGE_KEY)
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw)
    const normalized = normalizeGraphPayload(parsed)
    cachedGraphData = normalized
    cachedGraphVersion = normalized.version
  } catch {
    window.localStorage.removeItem(GRAPH_CACHE_STORAGE_KEY)
  }
}

function persistLocalGraphCache(payload) {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.setItem(GRAPH_CACHE_STORAGE_KEY, JSON.stringify(payload))
}

function normalizeGraphPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid navigation graph payload.")
  }

  const nodes = payload.nodes ?? {}
  const campusGraph = payload.campusGraph ?? {}
  const edgeDetails = payload.edgeDetails ?? {}
  const availableFloors = Array.isArray(payload.availableFloors)
    ? payload.availableFloors
    : []
  const version = Number(payload.version)

  if (!Number.isFinite(version)) {
    throw new Error("Navigation graph version is missing or invalid.")
  }

  return {
    version,
    updatedAt: payload.updatedAt ?? null,
    nodes,
    campusGraph,
    edgeDetails,
    availableFloors,
  }
}

async function getGraphVersionFromServer() {
  const response = await fetch(`${BASE_URL}/navigation/graph/version/`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Navigation graph version API error: ${errorText}`)
  }

  const payload = await response.json()
  const version = Number(payload.version)

  if (!Number.isFinite(version)) {
    throw new Error("Navigation graph version response is invalid.")
  }

  return {
    version,
    updatedAt: payload.updatedAt ?? null,
  }
}

async function fetchNavigationGraphPayload() {
  const response = await fetch(`${BASE_URL}/navigation/graph/`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Navigation graph API error: ${errorText}`)
  }

  const payload = await response.json()
  return normalizeGraphPayload(payload)
}

export async function getNavigationGraph(options = {}) {
  hydrateLocalGraphCache()

  const forceRefresh = options.forceRefresh === true

  if (!forceRefresh && cachedGraphData && Number.isFinite(cachedGraphVersion)) {
    try {
      const versionPayload = await getGraphVersionFromServer()
      if (versionPayload.version === cachedGraphVersion) {
        return cachedGraphData
      }
    } catch {
      return cachedGraphData
    }
  }

  const payload = await fetchNavigationGraphPayload()
  cachedGraphData = payload
  cachedGraphVersion = payload.version
  persistLocalGraphCache(payload)
  return payload
}

export async function logNavigationSession(sessionPayload) {
  const accessToken = getAccessToken()
  const headers = {
    "Content-Type": "application/json",
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  const response = await fetch(`${BASE_URL}/navigation/session/`, {
    method: "POST",
    headers,
    body: JSON.stringify(sessionPayload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Navigation session API error: ${errorText}`)
  }

  return response.json()
}

export function clearNavigationGraphCache() {
  cachedGraphData = null
  cachedGraphVersion = null
  hasHydratedLocalCache = true

  if (canUseLocalStorage()) {
    window.localStorage.removeItem(GRAPH_CACHE_STORAGE_KEY)
  }
}
