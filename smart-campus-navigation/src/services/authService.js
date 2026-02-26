const BASE_URL = import.meta.env.VITE_API_BASE || "/api"
const REFRESH_TOKEN_STORAGE_KEY = "smart-campus-navigation:refresh-token"

let accessToken = ""
let currentUser = null
let bootstrapPromise = null
const subscribers = new Set()

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function getStoredRefreshToken() {
  if (!canUseLocalStorage()) {
    return ""
  }
  return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) || ""
}

function setStoredRefreshToken(token) {
  if (!canUseLocalStorage()) {
    return
  }

  if (token) {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token)
    return
  }

  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
}

function setAccessToken(token) {
  accessToken = token || ""
}

function setCurrentUser(user) {
  currentUser = user || null
}

function notifySubscribers() {
  const snapshot = getAuthSnapshot()
  subscribers.forEach((callback) => {
    callback(snapshot)
  })
}

function parseJsonSafely(responseText) {
  try {
    return JSON.parse(responseText)
  } catch {
    return {}
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const responseText = await response.text()
  const data = parseJsonSafely(responseText)

  if (!response.ok) {
    const detail =
      data?.detail ||
      data?.error ||
      (responseText && responseText.trim()) ||
      `Request failed with ${response.status}`
    throw new Error(detail)
  }

  return data
}

export function getAccessToken() {
  return accessToken
}

export function getAuthSnapshot() {
  const user = currentUser
  const isAuthenticated = Boolean(accessToken)
  const isStaff = Boolean(user && (user.isStaff || user.isSuperuser))

  return {
    isAuthenticated,
    isStaff,
    user,
  }
}

export function subscribeAuthState(callback) {
  subscribers.add(callback)
  callback(getAuthSnapshot())

  return () => {
    subscribers.delete(callback)
  }
}

export async function fetchCurrentUserProfile() {
  if (!accessToken) {
    setCurrentUser(null)
    notifySubscribers()
    return null
  }

  const payload = await requestJson(`${BASE_URL}/auth/me/`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const user = {
    id: payload.id,
    username: payload.username,
    isStaff: Boolean(payload.isStaff),
    isSuperuser: Boolean(payload.isSuperuser),
  }
  setCurrentUser(user)
  notifySubscribers()
  return user
}

export async function refreshAccessToken() {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) {
    throw new Error("No refresh token found.")
  }

  const payload = await requestJson(`${BASE_URL}/auth/token/refresh/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh: refreshToken }),
  })

  if (!payload.access) {
    throw new Error("Refresh response did not include access token.")
  }

  setAccessToken(payload.access)
  notifySubscribers()
  return payload.access
}

export async function login(username, password) {
  if (!username || !password) {
    throw new Error("Username and password are required.")
  }

  const payload = await requestJson(`${BASE_URL}/auth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  })

  if (!payload.access || !payload.refresh) {
    throw new Error("Authentication response is incomplete.")
  }

  setAccessToken(payload.access)
  setStoredRefreshToken(payload.refresh)
  await fetchCurrentUserProfile()
  notifySubscribers()
  return getAuthSnapshot()
}

export function clearAuthSession() {
  setAccessToken("")
  setCurrentUser(null)
  setStoredRefreshToken("")
  notifySubscribers()
}

export function logout() {
  clearAuthSession()
}

export async function bootstrapAuth() {
  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = (async () => {
    const refreshToken = getStoredRefreshToken()
    if (!refreshToken) {
      clearAuthSession()
      return getAuthSnapshot()
    }

    try {
      await refreshAccessToken()
      await fetchCurrentUserProfile()
    } catch {
      clearAuthSession()
    }

    return getAuthSnapshot()
  })()

  try {
    return await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}
