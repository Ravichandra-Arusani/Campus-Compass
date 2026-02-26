import { useState } from "react"

function StaffAccessPanel({
  authState,
  authBooting,
  authSubmitting,
  authError,
  onLogin,
  onLogout,
  onOpenAnalytics,
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const isAuthenticated = authState?.isAuthenticated
  const isStaff = authState?.isStaff
  const currentUser = authState?.user

  if (authBooting) {
    return (
      <section className="staff-auth-panel">
        <p>Checking staff session...</p>
      </section>
    )
  }

  if (isAuthenticated && isStaff) {
    return (
      <section className="staff-auth-panel">
        <div className="staff-auth-row">
          <div>
            <p className="staff-auth-title">Staff Access Active</p>
            <p className="staff-auth-subtitle">
              Signed in as <strong>{currentUser?.username}</strong>
            </p>
          </div>
          <div className="staff-auth-actions">
            <button type="button" className="route-button secondary" onClick={onOpenAnalytics}>
              Open Analytics
            </button>
            <button type="button" className="route-button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (isAuthenticated && !isStaff) {
    return (
      <section className="staff-auth-panel">
        <div className="staff-auth-row">
          <div>
            <p className="staff-auth-title">Signed in without staff privileges</p>
            <p className="staff-auth-subtitle">
              Analytics is restricted to staff/admin accounts.
            </p>
          </div>
          <button type="button" className="route-button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="staff-auth-panel">
      <form
        className="staff-auth-form"
        onSubmit={async (event) => {
          event.preventDefault()
          await onLogin(username.trim(), password)
          setPassword("")
        }}
      >
        <p className="staff-auth-title">Staff Analytics Login</p>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" className="route-button" disabled={authSubmitting}>
          {authSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </form>
      {authError ? <p className="staff-auth-error">{authError}</p> : null}
    </section>
  )
}

export default StaffAccessPanel
