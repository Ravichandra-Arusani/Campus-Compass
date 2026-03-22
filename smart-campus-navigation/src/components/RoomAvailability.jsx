import { useEffect, useMemo, useState } from "react"
import apiClient from "../services/apiClient"

/**
 * RoomAvailability  — polls GET /api/availability/all/ every 10s.
 * Also allows per-room lookup via GET /api/availability/?room_id=X.
 * When a room is occupied and an alternate_room is returned, shows a green card.
 */
export default function RoomAvailability() {
  // Full list polled from /api/availability/all/
  const [allRooms, setAllRooms] = useState([])
  const [loadingAll, setLoadingAll] = useState(true)
  const [errorAll, setErrorAll] = useState("")

  // Per-room lookup
  const [lookupId, setLookupId] = useState("")
  const [lookupResult, setLookupResult] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState("")

  // Fetch all rooms and set up 10-second poll
  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      try {
        const res = await apiClient.get("/availability/all/")
        if (!cancelled) {
          setAllRooms(res.data || [])
          setErrorAll("")
        }
      } catch {
        if (!cancelled) setErrorAll("Could not load room data from backend.")
      } finally {
        if (!cancelled) setLoadingAll(false)
      }
    }

    fetchAll()
    const timer = setInterval(fetchAll, 10000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  async function handleLookup() {
    if (!lookupId.trim()) return
    setLookupError("")
    setLookupResult(null)
    setLookupLoading(true)
    try {
      const res = await apiClient.get("/availability/", {
        params: { room_id: lookupId.trim() },
      })
      setLookupResult(res.data)
    } catch (err) {
      setLookupError(err.response?.data?.error || "Room not found.")
    } finally {
      setLookupLoading(false)
    }
  }

  // Group rooms by building name
  const grouped = useMemo(() => {
    const map = {}
    for (const room of allRooms) {
      const b = room.building || "Unknown Building"
      if (!map[b]) map[b] = []
      map[b].push(room)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [allRooms])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Room Availability</h2>
        <p>Live status for all classrooms — auto-refreshes every 10 seconds.</p>
      </div>

      {/* Per-room lookup */}
      <div className="availability-lookup-bar">
        <input
          type="text"
          className="admin-input"
          placeholder="Enter room ID, e.g. N302"
          value={lookupId}
          onChange={e => setLookupId(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLookup()}
          id="room-lookup-input"
        />
        <button
          className="nav-panel-btn"
          onClick={handleLookup}
          disabled={lookupLoading}
          id="room-lookup-btn"
        >
          {lookupLoading ? "Searching…" : "Look Up"}
        </button>
      </div>

      {lookupError && <p className="network-banner">{lookupError}</p>}

      {lookupResult && (
        <div className="lookup-result-card">
          <div className="lookup-result-head">
            <div>
              <h3>{lookupResult.name}</h3>
              <p>{lookupResult.building} · Floor {lookupResult.floor}</p>
            </div>
            <span className={`status-badge ${lookupResult.status}`}>
              {lookupResult.status === "available" ? "Available" : "Occupied"}
            </span>
          </div>
          <p className="lookup-capacity">Capacity: {lookupResult.capacity}</p>

          {lookupResult.status === "occupied" && lookupResult.alternate_room && (
            <div className="alternate-room-card">
              <p className="alternate-room-label">🟢 Nearest Available Room:</p>
              <strong>{lookupResult.alternate_room.name}</strong>
              <span> — Floor {lookupResult.alternate_room.floor}, capacity {lookupResult.alternate_room.capacity}</span>
            </div>
          )}
          {lookupResult.status === "occupied" && !lookupResult.alternate_room && (
            <p className="alternate-room-none">No available rooms found on the same floor.</p>
          )}
        </div>
      )}

      {/* Full room list grouped by building */}
      {errorAll && <p className="network-banner">{errorAll}</p>}
      {loadingAll && <p style={{ color: "var(--text-muted)", textAlign: "center" }}>Loading rooms…</p>}

      {grouped.map(([building, rooms]) => (
        <div key={building} className="availability-building-group">
          <h3 className="availability-building-name">{building}</h3>
          <div className="availability-room-grid">
            {rooms.map(room => (
              <div key={room.room_id} className="availability-room-card">
                <div className="availability-room-head">
                  <div>
                    <strong>{room.room_id}</strong>
                    <span className="availability-room-name">{room.name}</span>
                  </div>
                  <span className={`status-badge ${room.status}`}>
                    {room.status === "available" ? "✓ Available" : "✗ Occupied"}
                  </span>
                </div>
                <div className="availability-room-meta">
                  <span>Floor {room.floor}</span>
                  <span>Cap. {room.capacity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!loadingAll && allRooms.length === 0 && !errorAll && (
        <p className="network-banner warning">
          No room data found — run <code>python manage.py seed_campus</code> to populate the database.
        </p>
      )}
    </section>
  )
}
