// src/components/IndoorNavigation.jsx
import { useMemo, useState } from "react"
import { floor1, floor2, floor3 } from "../indoor/nirmithiGraph"
import { astar } from "../indoor/astar"
import DestinationSearch from "./DestinationSearch"

const W = 680, H = 820
const RH = 85
const RIGHT_X = 560
const STAIR_X = 100
const WASH_ACCESS_X = 130
const WASH_ACCESS_Y = 620

const CORR = "100,695 100,620 160,620 260,620 560,620 560,143"

const FLOORS = {
  3: {
    title: "Nirmithi Block - 3rd Floor - CSBS Department",
    nodes: floor3.nodes,
    edges: floor3.edges,
    occupied: new Set(["class_303"]),
    destinations: [
      { id: "washroom", name: "Boys Washroom" },
      { id: "hod_302", name: "HOD Office (302)" },
      { id: "class_303", name: "Classroom 303" },
      { id: "lab_304", name: "Lab 304" },
      { id: "class_305", name: "Classroom 305" },
    ],
    layout: [
      { id: "class_305", x: 20, y: 100, w: 480, h: RH, label: "Classroom 305" },
      { id: "lab_304", x: 20, y: 235, w: 480, h: RH, label: "Lab 304" },
      { id: "class_303", x: 20, y: 370, w: 480, h: RH, label: "Classroom 303" },
      { id: "washroom", x: 20, y: 505, w: 220, h: RH, label: "Boys Washroom" },
      { id: "hod_302", x: 250, y: 505, w: 250, h: RH, label: "HOD Office 302" },
      { id: "stairs", x: STAIR_X - 90, y: 660, w: 180, h: 70, label: "Stairs" },
    ],
    connectors: [
      { id: "class_305", x1: 500, y1: 143, x2: RIGHT_X, y2: 143 },
      { id: "lab_304", x1: 500, y1: 278, x2: RIGHT_X, y2: 278 },
      { id: "class_303", x1: 500, y1: 413, x2: RIGHT_X, y2: 413 },
      { id: "hod_302", x1: 500, y1: 548, x2: RIGHT_X, y2: 548 },
      { id: "washroom", x1: WASH_ACCESS_X, y1: WASH_ACCESS_Y, x2: floor3.nodes.washroom.x, y2: floor3.nodes.washroom.y },
      { id: "stairs", x1: STAIR_X, y1: floor3.nodes.stairs.y, x2: floor3.nodes.stairs_landing.x, y2: floor3.nodes.stairs_landing.y },
    ],
  },
  2: {
    title: "Nirmithi Block - 2nd Floor",
    nodes: floor2.nodes,
    edges: floor2.edges,
    occupied: new Set([]),
    destinations: [
      { id: "girls_washroom", name: "Girls Washroom" },
      { id: "staff_room", name: "Staff Room" },
      { id: "lab_2", name: "Lab" },
      { id: "class_202", name: "Classroom 202" },
      { id: "class_205", name: "Classroom 205" },
    ],
    layout: [
      { id: "class_205", x: 20, y: 100, w: 480, h: RH, label: "Classroom 205" },
      { id: "class_202", x: 20, y: 235, w: 480, h: RH, label: "Classroom 202" },
      { id: "lab_2", x: 20, y: 370, w: 480, h: RH, label: "Lab" },
      { id: "girls_washroom", x: 20, y: 505, w: 220, h: RH, label: "Girls Washroom" },
      { id: "staff_room", x: 250, y: 505, w: 250, h: RH, label: "Staff Room" },
      { id: "stairs", x: STAIR_X - 90, y: 660, w: 180, h: 70, label: "Stairs" },
    ],
    connectors: [
      { id: "class_205", x1: 500, y1: 143, x2: RIGHT_X, y2: 143 },
      { id: "class_202", x1: 500, y1: 278, x2: RIGHT_X, y2: 278 },
      { id: "lab_2", x1: 500, y1: 413, x2: RIGHT_X, y2: 413 },
      { id: "staff_room", x1: 500, y1: 548, x2: RIGHT_X, y2: 548 },
      { id: "girls_washroom", x1: WASH_ACCESS_X, y1: WASH_ACCESS_Y, x2: floor2.nodes.girls_washroom.x, y2: floor2.nodes.girls_washroom.y },
      { id: "stairs", x1: STAIR_X, y1: floor2.nodes.stairs.y, x2: floor2.nodes.stairs_landing.x, y2: floor2.nodes.stairs_landing.y },
    ],
  },
  1: {
    title: "Nirmithi Block - 1st Floor",
    nodes: floor1.nodes,
    edges: floor1.edges,
    occupied: new Set([]),
    destinations: [
      { id: "staff_room_f1", name: "Staff Room" },
      { id: "class_101", name: "Classroom 101" },
      { id: "lab_102", name: "Lab 102" },
      { id: "class_105", name: "Classroom 105" },
    ],
    layout: [
      { id: "class_105", x: 20, y: 100, w: 480, h: RH, label: "Classroom 105" },
      { id: "lab_102", x: 20, y: 235, w: 480, h: RH, label: "Lab 102" },
      { id: "class_101", x: 20, y: 370, w: 480, h: RH, label: "Classroom 101" },
      { id: "staff_room_f1", x: 20, y: 505, w: 480, h: RH, label: "Staff Room" }, // Merged room
      { id: "stairs", x: STAIR_X - 90, y: 660, w: 180, h: 70, label: "Stairs" },
    ],
    connectors: [
      { id: "class_105", x1: 500, y1: 143, x2: RIGHT_X, y2: 143 },
      { id: "lab_102", x1: 500, y1: 278, x2: RIGHT_X, y2: 278 },
      { id: "class_101", x1: 500, y1: 413, x2: RIGHT_X, y2: 413 },
      { id: "staff_room_f1", x1: 500, y1: 548, x2: RIGHT_X, y2: 548 }, // Anchor point stays the same
      { id: "stairs", x1: STAIR_X, y1: floor1.nodes.stairs.y, x2: floor1.nodes.stairs_landing.x, y2: floor1.nodes.stairs_landing.y },
    ],
  }
}

function fill(id, pathSet, dest, occupiedSet) {
  if (id === dest) return "#f59e0b"
  if (id === "stairs") return "#1e3a5f"
  if (id === "washroom" || id === "girls_washroom") {
    if (!pathSet.has(id)) return "#0f2744"
  }
  if (pathSet.has(id)) return "#f59e0b22"
  if (occupiedSet.has(id)) return "#7f1d1d"
  return "#1e293b"
}
function stroke(id, pathSet, dest, occupiedSet) {
  if (id === dest) return "#f59e0b"
  if (pathSet.has(id)) return "#f59e0b"
  if (occupiedSet.has(id)) return "#ef4444"
  if (id === "stairs") return "#3b82f6"
  if (id === "washroom" || id === "girls_washroom") return "#1d4ed8"
  return "#334155"
}

function FloorPlan({ floorId, path, destination, currentNode }) {
  const floor = FLOORS[floorId]
  const pathSet = new Set(path)
  const nodes = floor.nodes
  const youNode = nodes[currentNode] || nodes.stairs
  const routePts = path
    .filter(id => nodes[id])
    .map(id => `${nodes[id].x},${nodes[id].y}`)
    .join(" ")

  return (
    <svg viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", maxWidth: 500, height: "auto", background: "#0f172a", borderRadius: 14, border: "1px solid #1e293b" }}>

      <text x={W / 2} y={30} textAnchor="middle" fontSize={12} fill="#475569" fontWeight="700">
        {floor.title.toUpperCase()}
      </text>

      {/* Corridor */}
      <polyline points={CORR} stroke="#1e293b" strokeWidth={55} fill="none" strokeLinecap="square" />
      <polyline points={CORR} stroke="#334155" strokeWidth={1} fill="none" />
      <text fontSize={10} fill="#334155" fontWeight="600"
        transform={`translate(${RIGHT_X + 16},430) rotate(90)`}>CORRIDOR</text>

      {/* Connectors */}
      {floor.connectors.map(c => (
        <line key={c.id}
          x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
          stroke={pathSet.has(c.id) ? "#f59e0b" : "#334155"}
          strokeWidth={pathSet.has(c.id) ? 2.5 : 1}
          strokeDasharray={pathSet.has(c.id) ? "none" : "5 3"}
        />
      ))}

      {/* Route */}
      {routePts && (
        <polyline points={routePts}
          stroke="#f59e0b" strokeWidth={5} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="14 7"
          style={{ animation: "dashMove 0.7s linear infinite" }}
        />
      )}

      {/* Room boxes */}
      {floor.layout.map(r => (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={7}
            fill={fill(r.id, pathSet, destination, floor.occupied)}
            stroke={stroke(r.id, pathSet, destination, floor.occupied)}
            strokeWidth={r.id === destination ? 2.5 : 1.5}
          />
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 + (floor.occupied.has(r.id) ? -8 : 5)}
            textAnchor="middle" fontSize={r.w < 150 ? 10 : 13} fontWeight="600"
            fill={r.id === destination ? "#000" : "#e2e8f0"}>
            {r.label}
          </text>
          {floor.occupied.has(r.id) && (
            <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 14}
              textAnchor="middle" fontSize={10} fill="#f87171">Occupied</text>
          )}
          {r.id === destination && (
            <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 18}
              textAnchor="middle" fontSize={9} fill="#000" fontWeight="700">Destination</text>
          )}
        </g>
      ))}

      {/* YOU dot at stairs */}
      <circle cx={youNode.x} cy={youNode.y} r={12} fill="#22d3ee" stroke="#fff" strokeWidth={2.5} />
      <text x={youNode.x} y={youNode.y + 25} textAnchor="middle" fontSize={10} fill="#22d3ee" fontWeight="700">YOU</text>

      <defs><style>{`@keyframes dashMove{to{stroke-dashoffset:-21}}`}</style></defs>
    </svg>
  )
}

const BLOCKS = {
  nirmithi: {
    name: "Nirmithi Block",
    floors: FLOORS // Uses the FLOORS map we defined above
  },
  srujan: {
    name: "Srujan Block",
    floors: {}
  },
  aakash: {
    name: "Aakash Block",
    floors: {}
  }
}

export default function IndoorNavigation() {
  const [activeBlock, setActiveBlock] = useState("nirmithi")
  const [activeFloor, setActiveFloor] = useState(3)
  const [dest, setDest] = useState("")
  const [path, setPath] = useState([])
  const [error, setError] = useState("")

  const blockData = BLOCKS[activeBlock]
  const floorConfig = blockData.floors[activeFloor]

  // Flatten all destinations across all known floors for the active block
  const destOptions = useMemo(() => {
    const opts = []
    if (blockData.floors) {
      Object.entries(blockData.floors).forEach(([fId, fData]) => {
        fData.destinations.forEach(d => {
          opts.push({ id: d.id, label: `${d.name} (Floor ${fId})`, floorId: Number(fId) })
        })
      })
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label))
  }, [activeBlock])

  function handleDestChange(val) {
    setDest(val)
    setPath([])
    setError("")
    if (val) {
      const found = destOptions.find(o => o.id === val)
      if (found) {
        setActiveFloor(found.floorId)
      }
    }
  }

  function handleBlockChange(e) {
    setActiveBlock(e.target.value)
    setDest("")
    setPath([])
    setError("")

    // Auto switch to top floor of new block if it exists
    const bData = BLOCKS[e.target.value]
    if (bData && bData.floors && Object.keys(bData.floors).length > 0) {
      const topFloor = Math.max(...Object.keys(bData.floors).map(Number))
      setActiveFloor(topFloor)
    }
  }

  function handleNavigate() {
    setError("")
    if (!dest) { setError("Select a destination."); return }
    if (!floorConfig) { setError("Floor layout not available yet."); return }

    const nodes = floorConfig.nodes
    const edges = floorConfig.edges
    const currentNode = "stairs" // fixed spawn

    const result = astar(nodes, edges, currentNode, dest)
    if (!result || !result.length) { setError("No route found on this floor."); return }
    setPath(result)
  }

  function handleReset() { setPath([]); setDest(""); setError("") }

  // Assume Entrance/Stairs is Ground Floor or Floor 1. We'll use 1 as default starting floor.
  const startingFloor = 1

  const steps = path && floorConfig?.nodes
    ? path
      .map(id => floorConfig.nodes[id]?.label)
      .filter(Boolean)
      .filter(l => !l.startsWith("Corridor"))
    : []

  // Feature 6: Inject floor transition instructions
  if (path.length > 0 && activeFloor !== startingFloor) {
    // Usually the first non-corridor step is "Stairs". We want to insert the transition after it.
    if (steps[0] === "Stairs") {
      steps.splice(1, 0, `Take stairs to Floor ${activeFloor}`)
    } else {
      // Fallback if "Stairs" isn't the first node for some reason
      steps.unshift(`Take stairs to Floor ${activeFloor}`)
    }
  }

  return (
    <div className="indoor-container">
      <div className="indoor-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Indoor Navigation</h2>
          {dest && floorConfig && (
            <p style={{ display: 'inline-block', background: '#3b82f6', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>
              Floor {activeFloor}
            </p>
          )}
        </div>
        <select className="floor-select" value={activeBlock} onChange={handleBlockChange} style={{ padding: '0.5rem', borderRadius: '8px', background: '#1e293b', color: 'white', border: '1px solid #334155', outline: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '500' }}>
          {Object.entries(BLOCKS).map(([key, data]) => (
            <option key={key} value={key}>{data.name}</option>
          ))}
        </select>
      </div>

      <div className="indoor-controls">
        <DestinationSearch
          label="Global Room Search" placeholder="Type a room name..."
          options={destOptions} value={dest} onChange={handleDestChange}
          emptyMessage="Room not found. Try another block."
        />
        <button className="route-cta" onClick={handleNavigate} disabled={!dest || !floorConfig}>Navigate</button>
        {path.length > 0 && (
          <button className="route-button secondary" onClick={handleReset}>Reset</button>
        )}
        {error && <span className="campus-map-error">{error}</span>}
      </div>

      {floorConfig ? (
        <>
          <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <span style={{ color: "#22d3ee" }}>You (Stairs)</span>
            <span style={{ color: "#f59e0b" }}>Destination</span>
            <span style={{ color: "#ef4444" }}>Occupied</span>
          </div>

          <div className="indoor-map-layout">
            <FloorPlan floorId={activeFloor} path={path} destination={dest} currentNode={"stairs"} />
            {path.length > 0 && (
              <div className="indoor-steps">
                <h3>Route to {destOptions.find(d => d.id === dest)?.label.split(" (Floor")[0]}</h3>
                <p style={{ color: "#64748b", fontSize: "0.8rem", margin: "0 0 0.75rem" }}>
                  {floorConfig.title}
                </p>
                <ol style={{ padding: 0, listStyle: "none", margin: 0 }}>
                  {steps.map((s, i) => (
                    <li key={i} className="indoor-step">
                      <span className="step-num">{i + 1}</span>{s}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="indoor-map-layout" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          <p>No indoor maps available for this block yet.</p>
        </div>
      )}
    </div>
  )
}

