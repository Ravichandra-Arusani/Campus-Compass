import axios from "axios"
import { clearAuthSession, getAccessToken, refreshAccessToken } from "./authService"

const BASE_URL = import.meta.env.VITE_API_BASE || "/api"

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
})

let refreshPromise = null

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const responseStatus = error.response?.status
    const originalRequest = error.config

    if (!originalRequest || responseStatus !== 401 || originalRequest._retry) {
      return Promise.reject(error)
    }

    if (
      originalRequest.url?.includes("/auth/token/") ||
      originalRequest.url?.includes("/auth/token/refresh/")
    ) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null
        })
      }

      const newToken = await refreshPromise
      originalRequest.headers.Authorization = `Bearer ${newToken}`
      return apiClient(originalRequest)
    } catch (refreshError) {
      clearAuthSession()
      return Promise.reject(refreshError)
    }
  }
)

export default apiClient
