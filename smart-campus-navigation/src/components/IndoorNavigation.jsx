// src/components/IndoorNavigation.jsx
// Nirmithi Block - 3rd Floor (CSBS Dept)
// Matches hand-drawn plan: rooms left, corridor right, NO entrance node

import { useEffect, useMemo, useState } from "react"
import { nodes, edges } from "../indoor/nirmithiGraph"
import { astar } from "../indoor/astar"
import DestinationSearch from "./DestinationSearch"

const DESTINATIONS = [
  { id: "washroom",  name: "Boys Washroom"    },
  { id: "hod_302",   name: "HOD Office (302)" },
  { id: "class_303", name: "Classroom 303"    },
  { id: "lab_304",   name: "Lab 304"          },
  { id: "class_305", name: "Classroom 305"    },
]

const OCCUPIED = new Set(["class_303"])
const W = 680, H = 820
const RH = 85
const RIGHT_X = nodes.right_vertical_corridor.x
const STAIR_X = nodes.stairs.x

// Rooms layout matching drawing exactly
// Full-width rooms top section, split bottom row
const LAYOUT = [
  { id:"class_305", x:20,  y:100, w:480, h:RH,  label:"Classroom 305" },
  { id:"lab_304",   x:20,  y:235, w:480, h:RH,  label:"Lab 304"       },
  { id:"class_303", x:20,  y:370, w:480, h:RH,  label:"Classroom 303" },
  // Bottom split row: washroom left | HOD right
  { id:"washroom",  x:20,  y:505, w:220, h:RH,  label:"Boys Washroom" },
  { id:"hod_302",   x:250, y:505, w:250, h:RH,  label:"HOD Office 302"},
  // Stairs at bottom-left
  { id:"stairs",    x:STAIR_X - 90, y:660, w:180, h:70,  label:"Stairs"        },
]

// Corridor geometry (stairs -> landing -> connector -> bottom corridor -> right vertical spine)
const CORR = [
  `${STAIR_X},760`,
  `${nodes.stairs_landing.x},${nodes.stairs_landing.y}`,
  `${nodes.left_connector_corridor.x},${nodes.left_connector_corridor.y}`,
  `${nodes.bottom_corridor.x},${nodes.bottom_corridor.y}`,
  `${nodes.right_vertical_corridor.x},${nodes.right_vertical_corridor.y}`,
  `${RIGHT_X},${nodes.corridor_d.y}`,
].join(" ")

// Connectors from room edge to corridor
const CONNECTORS = [
  { id:"class_305", x1:500, y1:143, x2:RIGHT_X, y2:143 },
  { id:"lab_304",   x1:500, y1:278, x2:RIGHT_X, y2:278 },
  { id:"class_303", x1:500, y1:413, x2:RIGHT_X, y2:413 },
  { id:"hod_302",   x1:nodes.hod_access.x,  y1:nodes.hod_access.y,  x2:nodes.hod_302.x,  y2:nodes.hod_302.y },
  { id:"washroom",  x1:nodes.wash_access.x, y1:nodes.wash_access.y, x2:nodes.washroom.x, y2:nodes.washroom.y },
  { id:"stairs",    x1:STAIR_X, y1:nodes.stairs.y, x2:nodes.stairs_landing.x, y2:nodes.stairs_landing.y },
]

function fill(id, pathSet, dest) {
  if (id === dest)        return "#f59e0b"
  if (id === "stairs")    return "#1e3a5f"
  if (id === "washroom" && !pathSet.has(id)) return "#0f2744"
  if (pathSet.has(id))    return "#f59e0b22"
  if (OCCUPIED.has(id))   return "#7f1d1d"
  return "#1e293b"
}
function stroke(id, pathSet, dest) {
  if (id === dest)        return "#f59e0b"
  if (pathSet.has(id))    return "#f59e0b"
  if (OCCUPIED.has(id))   return "#ef4444"
  if (id === "stairs")    return "#3b82f6"
  if (id === "washroom")  return "#1d4ed8"
  return "#334155"
}

function FloorPlan({ path, destination, currentNode }) {
  const pathSet = new Set(path)
  const youNode = nodes[currentNode] || nodes.stairs
  const routePts = path
    .filter(id => nodes[id])
    .map(id => `${nodes[id].x},${nodes[id].y}`)
    .join(" ")

  return (
    <svg viewBox={`0 0 ${W} ${H}`}
      style={{width:"100%",maxWidth:500,height:"auto",background:"#0f172a",borderRadius:14,border:"1px solid #1e293b"}}>

      <text x={W/2} y={30} textAnchor="middle" fontSize={12} fill="#475569" fontWeight="700">
        NIRMITHI BLOCK - 3rd Floor - CSBS
      </text>

      {/* Corridor */}
      <polyline points={CORR} stroke="#1e293b" strokeWidth={55} fill="none" strokeLinecap="square"/>
      <polyline points={CORR} stroke="#334155" strokeWidth={1} fill="none"/>
      <text fontSize={10} fill="#334155" fontWeight="600"
        transform={`translate(${RIGHT_X+16},430) rotate(90)`}>CORRIDOR</text>

      {/* Connectors */}
      {CONNECTORS.map(c => (
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
          style={{animation:"dashMove 0.7s linear infinite"}}
        />
      )}

      {/* Room boxes */}
      {LAYOUT.map(r => (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={7}
            fill={fill(r.id, pathSet, destination)}
            stroke={stroke(r.id, pathSet, destination)}
            strokeWidth={r.id === destination ? 2.5 : 1.5}
          />
          <text x={r.x+r.w/2} y={r.y+r.h/2+(OCCUPIED.has(r.id)?-8:5)}
            textAnchor="middle" fontSize={r.w<150?10:13} fontWeight="600"
            fill={r.id===destination?"#000":"#e2e8f0"}>
            {r.label}
          </text>
          {OCCUPIED.has(r.id) && (
            <text x={r.x+r.w/2} y={r.y+r.h/2+14}
              textAnchor="middle" fontSize={10} fill="#f87171">Occupied</text>
          )}
          {r.id===destination && (
            <text x={r.x+r.w/2} y={r.y+r.h/2+18}
              textAnchor="middle" fontSize={9} fill="#000" fontWeight="700">Destination</text>
          )}
        </g>
      ))}

      {/* YOU dot at stairs */}
      <circle cx={youNode.x} cy={youNode.y} r={12} fill="#22d3ee" stroke="#fff" strokeWidth={2.5}/>
      <text x={youNode.x} y={youNode.y + 25} textAnchor="middle" fontSize={10} fill="#22d3ee" fontWeight="700">YOU</text>

      <defs><style>{`@keyframes dashMove{to{stroke-dashoffset:-21}}`}</style></defs>
    </svg>
  )
}

export default function IndoorNavigation({ startNode }) {
  const FLOOR_ENTRY_NODE = "stairs"
  const [currentNode, setCurrentNode] = useState(FLOOR_ENTRY_NODE)
  const [dest,  setDest]  = useState("")
  const [path,  setPath]  = useState([])
  const [error, setError] = useState("")

  const destOptions = useMemo(
    () => DESTINATIONS.map(d => ({ id: d.id, label: d.name })), []
  )

  useEffect(() => {
    // Always start indoor floor navigation from stairs.
    setCurrentNode(FLOOR_ENTRY_NODE)
    setDest("")
    setPath([])
    setError("")
  }, [startNode])

  function handleNavigate() {
    setError("")
    if (!dest) { setError("Select a destination."); return }
    const result = astar(nodes, edges, currentNode, dest)
    if (!result || !result.length) { setError("No route found."); return }
    setPath(result)
  }

  function handleReset() { setPath([]); setDest(""); setError("") }

  const steps = path
    .map(id => nodes[id]?.label)
    .filter(Boolean)
    .filter(l => !l.startsWith("Corridor"))

  return (
    <div className="indoor-container">
      <div className="indoor-header">
        <h2>Indoor Navigation</h2>
        <p>Nirmithi Block - 3rd Floor - CSBS Department</p>
      </div>

      <div className="indoor-controls">
        <DestinationSearch
          label="Destination" placeholder="Search room or lab..."
          options={destOptions} value={dest} onChange={setDest}
          emptyMessage="Room not found."
        />
        <button className="route-cta" onClick={handleNavigate} disabled={!dest}>Navigate</button>
        {path.length > 0 && (
          <button className="route-button secondary" onClick={handleReset}>Reset</button>
        )}
        {error && <span className="campus-map-error">{error}</span>}
      </div>

      <div style={{display:"flex",gap:"1rem",fontSize:"0.8rem",marginBottom:"1rem",flexWrap:"wrap"}}>
        <span style={{color:"#22d3ee"}}>You (Stairs)</span>
        <span style={{color:"#f59e0b"}}>Destination</span>
        <span style={{color:"#ef4444"}}>Occupied</span>
      </div>

      <div className="indoor-map-layout">
        <FloorPlan path={path} destination={dest} currentNode={currentNode} />
        {path.length > 0 && (
          <div className="indoor-steps">
            <h3>Route to {DESTINATIONS.find(d=>d.id===dest)?.name}</h3>
            <p style={{color:"#64748b",fontSize:"0.8rem",margin:"0 0 0.75rem"}}>
              3rd Floor - CSBS
            </p>
            <ol style={{padding:0,listStyle:"none",margin:0}}>
              {steps.map((s,i) => (
                <li key={i} className="indoor-step">
                  <span className="step-num">{i+1}</span>{s}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

