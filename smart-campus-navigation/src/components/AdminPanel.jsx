import { useEffect, useRef, useState } from "react"
import apiClient from "../services/apiClient"

/**
 * AdminPanel — JWT login + room status update for admin users.
 *
 * - If no token: show login form → POST /api/auth/token/
 * - If logged in: room ID + status dropdown → POST /api/availability/update/
 */
export default function AdminPanel() {
  const [loggedIn, setLoggedIn] = useState(
    () => Boolean(localStorage.getItem("access_token"))
  )
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loginError, setLoginError] = useState("")
  const [loginLoading, setLoginLoading] = useState(false)

  const [roomId, setRoomId] = useState("")
  const [newStatus, setNewStatus] = useState("available")
  const [updateMsg, setUpdateMsg] = useState("")
  const [updateError, setUpdateError] = useState("")
  const [updateLoading, setUpdateLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoginError("")
    setLoginLoading(true)
    try {
      const res = await apiClient.post("/auth/token/", { username, password })
      localStorage.setItem("access_token", res.data.access)
      localStorage.setItem("refresh_token", res.data.refresh)
      setLoggedIn(true)
      setUsername("")
      setPassword("")
    } catch (err) {
      setLoginError(
        err.response?.data?.detail || "Login failed. Check credentials."
      )
    } finally {
      setLoginLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    setLoggedIn(false)
    setUpdateMsg("")
    setUpdateError("")
  }

  async function handleUpdate(e) {
    e.preventDefault()
    setUpdateMsg("")
    setUpdateError("")
    if (!roomId.trim()) {
      setUpdateError("Please enter a room ID.")
      return
    }
    setUpdateLoading(true)
    try {
      const token = localStorage.getItem("access_token")
      const res = await apiClient.post(
        "/availability/update/",
        { room_id: roomId.trim(), status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setUpdateMsg(
        res.data?.message || `Room ${roomId} updated to ${newStatus}.`
      )
      setRoomId("")
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        "Update failed."
      setUpdateError(msg)
    } finally {
      setUpdateLoading(false)
    }
  }

  if (!loggedIn) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Admin Login</h2>
          <p>Sign in with your staff credentials to manage room status.</p>
        </div>

        <form onSubmit={handleLogin} className="admin-form" id="admin-login-form">
          <label className="admin-label">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="admin-input"
              id="admin-username"
              autoComplete="username"
              required
            />
          </label>
          <label className="admin-label">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="admin-input"
              id="admin-password"
              autoComplete="current-password"
              required
            />
          </label>
          {loginError && <p className="network-banner">{loginError}</p>}
          <button
            type="submit"
            className="nav-panel-btn"
            disabled={loginLoading}
            id="admin-login-btn"
          >
            {loginLoading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head admin-panel-head">
        <div>
          <h2>Admin Panel</h2>
          <p>Update classroom availability status in real time.</p>
        </div>
        <button
          onClick={handleLogout}
          className="admin-logout-btn"
          id="admin-logout-btn"
        >
          Logout
        </button>
      </div>

      <form onSubmit={handleUpdate} className="admin-form" id="admin-update-form">
        <label className="admin-label">
          <span>Room ID</span>
          <input
            type="text"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="e.g. N302"
            className="admin-input"
            id="admin-room-id"
          />
        </label>
        <label className="admin-label">
          <span>Status</span>
          <select
            value={newStatus}
            onChange={e => setNewStatus(e.target.value)}
            className="nav-panel-select"
            id="admin-status-select"
          >
            <option value="available">Available</option>
            <option value="occupied">Occupied</option>
          </select>
        </label>

        {updateMsg && (
          <p className="network-banner" style={{ color: "#4ade80", borderColor: "#4ade80" }}>
            ✅ {updateMsg}
          </p>
        )}
        {updateError && <p className="network-banner">{updateError}</p>}

        <button
          type="submit"
          className="nav-panel-btn"
          disabled={updateLoading}
          id="admin-update-btn"
        >
          {updateLoading ? "Updating…" : "Update Status"}
        </button>
      </form>
    </section>
  )
}
