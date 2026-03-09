import { useEffect, useMemo, useState } from "react"
import { campusBlueprint } from "../data/campusBlueprint"

const ROOM_TYPE_LABELS = {
  ALL: "All Types",
  CLASSROOM: "Classroom",
  LAB: "Lab",
  AUDITORIUM: "Auditorium",
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
        // Mocking API delay
        await new Promise(resolve => setTimeout(resolve, 600))
        if (ignore) return

        let allRooms = []
        campusBlueprint.forEach(building => {
          if (building.type === "academic" || building.type === "service") {
            // Add auditoriums explicitly as rooms
            if (building.capacity) {
              allRooms.push({
                id: building.id,
                name: building.name,
                building: building.name,
                type: "Auditorium",
                capacity: building.capacity,
                currentOccupancy: building.capacity ? Math.floor(Math.random() * building.capacity) : 0,
                floor: building.floors || 1
              })
            }

            // Check name for seminar halls
            if (building.name.toLowerCase().includes("seminar hall")) {
              const cap = 100
              allRooms.push({
                id: building.id,
                name: building.name,
                building: building.name,
                type: "Auditorium", // Map to auditorium so it fits a clear category
                capacity: cap,
                currentOccupancy: Math.floor(Math.random() * cap),
                floor: building.floors || 1
              })
            }

            // Create mock classrooms/labs for academic blocks
            if (building.type === "academic" && building.departments?.length > 0) {
              building.departments.forEach((dept, idx) => {
                const cap = 60
                allRooms.push({
                  id: `${building.id}_room_${idx}`,
                  name: `${dept} Classroom ${idx + 1}`,
                  building: building.name,
                  type: "Classroom",
                  capacity: cap,
                  currentOccupancy: Math.floor(Math.random() * cap),
                  floor: (idx % (building.floors || 1)) + 1
                })

                const labCap = 30
                allRooms.push({
                  id: `${building.id}_lab_${idx}`,
                  name: `${dept} Lab`,
                  building: building.name,
                  type: "Lab",
                  capacity: labCap,
                  currentOccupancy: Math.floor(Math.random() * labCap),
                  floor: (idx % (building.floors || 1)) + 1
                })
              })
            }
          }
        })

        let filteredRooms = allRooms
        if (selectedType !== "ALL") {
          filteredRooms = allRooms.filter(r => r.type.toUpperCase() === selectedType.toUpperCase())
        }

        const nextRooms = filteredRooms
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
  const isAvailable = Boolean(
    activeRoom?.is_available ??
    activeRoom?.available ??
    (capacity > 0 ? currentOccupancy < capacity : true)
  )
  const roomType = (activeRoom?.type || "").toString().toLowerCase()
  const roomFloor = activeRoom?.floor

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
              Type: <strong>{roomType || "unknown"}</strong>
            </p>
            <p>
              Floor: <strong>{roomFloor ?? "N/A"}</strong>
            </p>
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
