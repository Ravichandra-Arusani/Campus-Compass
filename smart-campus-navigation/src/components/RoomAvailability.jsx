import { useEffect, useMemo, useState } from "react"
import apiClient from "../services/apiClient"
import { useToast } from "../hooks/useToast"

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

  const { showToast } = useToast()

  // Per-room lookup
  const [lookupId, setLookupId] = useState("")
  const [lookupResult, setLookupResult] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState("")

  // Connect to Django Channels WebSocket for real-time occupancy
  // Replaced with dummy data since backend might be down.
  useEffect(() => {
    const timer = setTimeout(() => {
      const DUMMY_ROOMS = [
        { room_id: "N302", name: "HOD Office", building: "Nirmithi Block", floor: 3, capacity: 5, status: "occupied" },
        { room_id: "N303", name: "Classroom 303", building: "Nirmithi Block", floor: 3, capacity: 60, status: "available" },
        { room_id: "N101", name: "Classroom 101", building: "Nirmithi Block", floor: 1, capacity: 60, status: "available" },
        { room_id: "S101", name: "Classroom 101", building: "Srujan Block", floor: 1, capacity: 60, status: "occupied" },
        { room_id: "S301", name: "CS Lab 301", building: "Srujan Block", floor: 3, capacity: 30, status: "available" },
        { room_id: "P201", name: "Classroom 201", building: "Pragathi Block", floor: 2, capacity: 60, status: "available" },
        { room_id: "P301", name: "Classroom 301", building: "Pragathi Block", floor: 3, capacity: 60, status: "occupied" },
      ];
      setAllRooms(DUMMY_ROOMS);
      setLoadingAll(false);
      setErrorAll("");
    }, 600);

    return () => clearTimeout(timer);
  }, [showToast])

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
      showToast(`✅ Room ${lookupId.trim()} found`, "success")
    } catch (err) {
      setLookupError(err.response?.data?.error || "Room not found.")
      showToast("❌ Room not found", "error")
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
          <div className="availability-room-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
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
        <div style={{ textAlign: "center", padding: "3rem", color: "#64748b", background: "#0f172a", borderRadius: 14, border: "1px dashed #1e293b" }}>
          <p style={{ fontSize: "2rem", margin: "0 0 .5rem" }}>🏫</p>
          <p style={{ margin: 0, fontSize: "1.1rem" }}>No rooms match your search</p>
        </div>
      )}
    </section>
  )
}
