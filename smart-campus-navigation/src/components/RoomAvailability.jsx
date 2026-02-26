import { useEffect, useMemo, useState } from "react"

const TIMELINE_SLOTS = ["09:00", "11:00", "13:00", "15:00", "17:00"]

const ROOM_TYPE_LABELS = {
  ALL: "All Types",
  CLASSROOM: "Classroom",
  LAB: "Lab",
  AUDITORIUM: "Auditorium",
}

function projectedOccupancy(baseOccupancy, slotIndex) {
  const swing = [0, 0.12, -0.08, 0.18, -0.05][slotIndex] ?? 0
  return Math.max(0, Math.round(baseOccupancy * (1 + swing)))
}

function makeRoomKey(room) {
  if (!room) return ""
  if (room.id) return String(room.id)
  const building = room.building || "Campus"
  return `${building}::${room.name || ""}`
}

export default function RoomAvailability() {
  const [rooms, setRooms] = useState([])
  const [selectedType, setSelectedType] = useState("ALL")
  const [selectedRoomKey, setSelectedRoomKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let ignore = false

    async function loadRooms() {
      setLoading(true)
      setError("")

      try {
        const query = selectedType === "ALL" ? "" : `?type=${encodeURIComponent(selectedType)}`
        const response = await fetch(`/api/rooms/available/${query}`)
        if (!response.ok) {
          throw new Error("Failed to load room availability.")
        }
        const payload = await response.json()
        if (ignore) return

        const nextRooms = Array.isArray(payload) ? payload : []
        setRooms(nextRooms)

        if (nextRooms.length > 0) {
          setSelectedRoomKey((previousKey) => {
            if (!previousKey) {
              return makeRoomKey(nextRooms[0])
            }
            const stillExists = nextRooms.some((room) => makeRoomKey(room) === previousKey)
            return stillExists ? previousKey : makeRoomKey(nextRooms[0])
          })
        } else {
          setSelectedRoomKey("")
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message || "Failed to load room availability.")
          setRooms([])
          setSelectedRoomKey("")
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadRooms()

    return () => {
      ignore = true
    }
  }, [selectedType])

  const filteredRooms = useMemo(() => rooms, [rooms])

  const activeRoom =
    filteredRooms.find((room) => makeRoomKey(room) === selectedRoomKey) ??
    filteredRooms[0] ??
    null
  const activeRoomKey = activeRoom ? makeRoomKey(activeRoom) : ""
  const currentOccupancy =
    activeRoom && typeof activeRoom.currentOccupancy === "number"
      ? activeRoom.currentOccupancy
      : activeRoom?.current_occupancy ?? 0
  const capacity =
    activeRoom && typeof activeRoom.capacity === "number" ? activeRoom.capacity : 0
  const occupancyRatio = capacity > 0 ? currentOccupancy / capacity : 0
  const isAvailable = occupancyRatio < 0.8

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Room Availability</h2>
        <p>Live availability for classrooms, labs, and auditoriums with quick filtering.</p>
      </div>

      <div className="classroom-availability-toolbar">
        <label>
          Room type
          <select
            value={selectedType}
            onChange={(event) => {
              const nextType = event.target.value
              setSelectedType(nextType)
            }}
          >
            {Object.entries(ROOM_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Room
          <select
            value={activeRoomKey}
            onChange={(event) => setSelectedRoomKey(event.target.value)}
            disabled={filteredRooms.length === 0}
          >
            {filteredRooms.map((room) => (
              <option key={makeRoomKey(room)} value={makeRoomKey(room)}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeRoom ? (
        <article className="classroom-availability-card">
          <header className="classroom-availability-head">
            <div>
              <h3>{activeRoom.name}</h3>
              <p>{activeRoom.building}</p>
            </div>
            <span className={isAvailable ? "signal-dot available" : "signal-dot busy"} />
          </header>

          <div className="classroom-availability-metrics">
            <p>
              Current occupancy: <strong>{currentOccupancy}</strong>
            </p>
            <p>
              Capacity: <strong>{capacity}</strong>
            </p>
            <p>
              Status: <strong>{isAvailable ? "Available" : "Occupied"}</strong>
            </p>
          </div>

          <div className="signal-bar-track" role="presentation">
            <div
              className={isAvailable ? "signal-bar-fill available" : "signal-bar-fill busy"}
              style={{ width: `${Math.min(occupancyRatio * 100, 100)}%` }}
            />
          </div>

          <div className="classroom-timeline">
            <h4>Projected Occupancy Timeline</h4>
            <ul>
              {TIMELINE_SLOTS.map((slot, index) => (
                <li key={slot}>
                  <span>{slot}</span>
                  <strong>{projectedOccupancy(currentOccupancy, index)} seats</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ) : (
        <p className="network-banner warning">
          {loading ? "Loading room data..." : "No room data available for the selected filters."}
        </p>
      )}
      {error && <p className="network-banner">{error}</p>}
    </section>
  )
}
