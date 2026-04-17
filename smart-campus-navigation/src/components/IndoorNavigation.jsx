// src/components/IndoorNavigation.jsx — Upgraded UI
import { useMemo, useState } from "react"
import { floor1 as n1, floor2 as n2, floor3 as n3 } from "../indoor/nirmithiGraph"
import { floor1 as s1, floor2 as s2, floor3 as s3 } from "../indoor/srujanGraph"
import { floor1 as p1, floor2 as p2, floor3 as p3 } from "../indoor/pragathiGraph"
import { astar } from "../indoor/astar"
import DestinationSearch from "./DestinationSearch"
import { useToast } from "../hooks/useToast"

const W = 680, H = 820
const RH = 85
const RIGHT_X = 560
const STAIR_X = 100
const WASH_ACCESS_X = 130
const WASH_ACCESS_Y = 620
const CORR = "100,695 100,620 160,620 260,620 560,620 560,143"

// ── Room type config ─────────────────────────────────────────────────────────
const ROOM_TYPE = {
  classroom: { color: "#1e3a5f", stroke: "#3b82f6", icon: "🎓", label: "Classroom" },
  lab: { color: "#1a2f1a", stroke: "#22c55e", icon: "🔬", label: "Lab" },
  office: { color: "#2d1f0e", stroke: "#f97316", icon: "🏢", label: "Office" },
  washroom: { color: "#0f2744", stroke: "#1d4ed8", icon: "🚻", label: "Washroom" },
  stairs: { color: "#1e3a5f", stroke: "#3b82f6", icon: "🪜", label: "Stairs" },
}

function getRoomType(id) {
  if (id.startsWith("class")) return "classroom"
  if (id.startsWith("lab")) return "lab"
  if (id.includes("hod") || id.includes("staff")) return "office"
  if (id.includes("washroom")) return "washroom"
  if (id === "stairs") return "stairs"
  return "classroom"
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function fill(id, pathSet, dest, occupiedSet) {
  if (id === dest) return "#f59e0b"
  if (occupiedSet.has(id)) return "#7f1d1d"
  if (pathSet.has(id)) return ROOM_TYPE[getRoomType(id)].color + "cc"
  return ROOM_TYPE[getRoomType(id)].color
}

function strokeColor(id, pathSet, dest, occupiedSet) {
  if (id === dest) return "#f59e0b"
  if (pathSet.has(id)) return ROOM_TYPE[getRoomType(id)].stroke
  if (occupiedSet.has(id)) return "#ef4444"
  return ROOM_TYPE[getRoomType(id)].stroke + "66"
}

// ── Floor blueprints generator ──────────────────────────────────────────────────
function buildLayout(fGraph, fId, bName, rooms) {
  const { slot1, slot2, slot3, slot4, slot5 } = rooms
  return {
    title: `${bName} · Floor ${fId}`,
    nodes: fGraph.nodes,
    edges: fGraph.edges,
    occupied: new Set([]),
    destinations: Object.values(rooms).filter(Boolean).map(r => ({ id: r.id, name: r.label })),
    layout: [
      { id: slot1.id, x: 20, y: 100, w: 480, h: RH, label: slot1.label },
      { id: slot2.id, x: 20, y: 235, w: 480, h: RH, label: slot2.label },
      { id: slot3.id, x: 20, y: 370, w: 480, h: RH, label: slot3.label },
      ...(slot4 ? [{ id: slot4.id, x: 20, y: 505, w: 220, h: RH, label: slot4.label }] : []),
      ...(slot5 ? [{ id: slot5.id, x: 250, y: 505, w: 250, h: RH, label: slot5.label }] : []),
      { id: "stairs", x: STAIR_X - 90, y: 660, w: 180, h: 70, label: "Stairs" },
    ],
    connectors: [
      { id: slot1.id, x1: 500, y1: 143, x2: RIGHT_X, y2: 143 },
      { id: slot2.id, x1: 500, y1: 278, x2: RIGHT_X, y2: 278 },
      { id: slot3.id, x1: 500, y1: 413, x2: RIGHT_X, y2: 413 },
      ...(slot4 ? [{ id: slot4.id, x1: WASH_ACCESS_X, y1: WASH_ACCESS_Y, x2: fGraph.nodes[slot4.id]?.x, y2: fGraph.nodes[slot4.id]?.y }] : []),
      ...(slot5 ? [{ id: slot5.id, x1: 500, y1: 548, x2: RIGHT_X, y2: 548 }] : []),
      { id: "stairs", x1: STAIR_X, y1: fGraph.nodes.stairs.y, x2: fGraph.nodes.stairs_landing.x, y2: fGraph.nodes.stairs_landing.y },
    ],
  }
}

const NIRMITHI_FLOORS = {
  3: buildLayout(n3, 3, "Nirmithi Block", { slot1: {id:"class_305", label:"Classroom 305"}, slot2: {id:"lab_304", label:"Lab 304"}, slot3: {id:"class_303", label:"Classroom 303"}, slot4: {id:"washroom", label:"Boys Washroom"}, slot5: {id:"hod_302", label:"HOD Office (302)"} }),
  2: buildLayout(n2, 2, "Nirmithi Block", { slot1: {id:"class_205", label:"Classroom 205"}, slot2: {id:"class_202", label:"Classroom 202"}, slot3: {id:"lab_2", label:"Lab"}, slot4: {id:"girls_washroom", label:"Girls Washroom"}, slot5: {id:"staff_room", label:"Staff Room"} }),
  1: buildLayout(n1, 1, "Nirmithi Block", { slot1: {id:"class_105", label:"Classroom 105"}, slot2: {id:"lab_102", label:"Lab 102"}, slot3: {id:"class_101", label:"Classroom 101"}, slot4: null, slot5: {id:"staff_room_f1", label:"Staff Room"} })
}
NIRMITHI_FLOORS[3].occupied = new Set(["class_303"]);

const SRUJAN_FLOORS = {
  3: buildLayout(s3, 3, "Srujan Block", { slot1: { id: "lab_301_cs", label: "CS Lab 301" }, slot2: { id: "lab_302_cs", label: "CS Lab 302" }, slot3: { id: "class_303", label: "Classroom 303" }, slot4: { id: "washroom_3", label: "Washroom" }, slot5: { id: "utility_304", label: "Utility Room" } }),
  2: buildLayout(s2, 2, "Srujan Block", { slot1: { id: "class_201", label: "Classroom 201" }, slot2: { id: "class_202", label: "Classroom 202" }, slot3: { id: "class_203", label: "Classroom 203" }, slot4: { id: "washroom_2", label: "Washroom" }, slot5: { id: "hod_it", label: "IT HOD Office" } }),
  1: buildLayout(s1, 1, "Srujan Block", { slot1: { id: "class_101", label: "Classroom 101" }, slot2: { id: "class_102", label: "Classroom 102" }, slot3: { id: "staff_room_s", label: "Staff Room" }, slot4: { id: "washroom_1", label: "Washroom" }, slot5: { id: "reception", label: "Reception" } })
}

const PRAGATHI_FLOORS = {
  3: buildLayout(p3, 3, "Pragathi Block", { slot1: { id: "class_301_p", label: "Classroom 301" }, slot2: { id: "class_302_p", label: "Classroom 302" }, slot3: { id: "comp_lab", label: "Computer Lab" }, slot4: { id: "washroom_3p", label: "Washroom" }, slot5: { id: "staff_3", label: "Staff Room" } }),
  2: buildLayout(p2, 2, "Pragathi Block", { slot1: { id: "class_201_p", label: "Classroom 201" }, slot2: { id: "class_202_p", label: "Classroom 202" }, slot3: { id: "class_203_p", label: "Classroom 203" }, slot4: { id: "washroom_2p", label: "Washroom" }, slot5: { id: "seminar_hall", label: "Seminar Hall" } }),
  1: buildLayout(p1, 1, "Pragathi Block", { slot1: { id: "class_101_p", label: "Classroom 101" }, slot2: { id: "class_102_p", label: "Classroom 102" }, slot3: { id: "accounts", label: "Accounts Dept" }, slot4: { id: "washroom_1p", label: "Washroom" }, slot5: { id: "admin_office", label: "Admin Office" } })
}

// ── FloorPlan SVG ─────────────────────────────────────────────────────────────
function FloorPlan({ blockId, floorId, path, destination, currentNode, animating }) {
  const block = BLOCKS[blockId]
  const floor = block.floors[floorId]
  const pathSet = new Set(path)
  const nodes = floor.nodes
  const youNode = nodes[currentNode] || nodes.stairs
  const routePts = path
    .filter(id => nodes[id])
    .map(id => `${nodes[id].x},${nodes[id].y}`)
    .join(" ")

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%", maxWidth: 500, height: "auto",
        background: "#0a0f1e",
        borderRadius: 16,
        border: "1px solid #1e293b",
        filter: animating ? "drop-shadow(0 0 12px #f59e0b44)" : "none",
        transition: "filter 0.4s ease",
      }}
    >
      {/* Glow defs */}
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="destGlow">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <style>{`
          @keyframes dashMove { to { stroke-dashoffset: -21 } }
          @keyframes pulse { 0%,100% { opacity:1; r:12 } 50% { opacity:0.7; r:15 } }
          @keyframes destPulse { 0%,100% { opacity:0.3 } 50% { opacity:0.7 } }
          @keyframes fadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
        `}</style>
      </defs>

      {/* Floor title */}
      <text x={W / 2} y={30} textAnchor="middle" fontSize={11}
        fill="#475569" fontWeight="700" letterSpacing="1">
        {floor.title.toUpperCase()}
      </text>

      {/* Corridor background */}
      <polyline points={CORR} stroke="#1e293b" strokeWidth={55} fill="none" strokeLinecap="square" />
      <polyline points={CORR} stroke="#334155" strokeWidth={1} fill="none" />
      <text fontSize={10} fill="#334155" fontWeight="600"
        transform={`translate(${RIGHT_X + 16},430) rotate(90)`}>CORRIDOR</text>

      {/* Connectors */}
      {floor.connectors.map(c => (
        <line key={c.id}
          x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
          stroke={pathSet.has(c.id) ? ROOM_TYPE[getRoomType(c.id)].stroke : "#2d3f55"}
          strokeWidth={pathSet.has(c.id) ? 2.5 : 1}
          strokeDasharray={pathSet.has(c.id) ? "none" : "5 3"}
          style={{ transition: "stroke 0.3s ease" }}
        />
      ))}

      {/* Animated route path */}
      {routePts && (
        <>
          {/* Glow layer */}
          <polyline points={routePts}
            stroke="#f59e0b" strokeWidth={10} fill="none"
            strokeLinecap="round" strokeLinejoin="round"
            opacity={0.15}
          />
          {/* Main animated line */}
          <polyline points={routePts}
            stroke="#f59e0b" strokeWidth={4} fill="none"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="14 7"
            style={{ animation: "dashMove 0.7s linear infinite" }}
            filter="url(#glow)"
          />
        </>
      )}

      {/* Room boxes */}
      {floor.layout.map(r => {
        const type = getRoomType(r.id)
        const isDest = r.id === destination
        const isOccupied = floor.occupied.has(r.id)
        const isOnPath = pathSet.has(r.id)
        const typeInfo = ROOM_TYPE[type]

        return (
          <g key={r.id} style={{ animation: "fadeIn 0.3s ease" }}>
            {/* Destination glow ring */}
            {isDest && (
              <rect
                x={r.x - 4} y={r.y - 4}
                width={r.w + 8} height={r.h + 8}
                rx={11} fill="none"
                stroke="#f59e0b" strokeWidth={2} opacity={0.4}
                style={{ animation: "destPulse 1.5s ease-in-out infinite" }}
              />
            )}

            {/* Room body */}
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8}
              fill={fill(r.id, pathSet, destination, floor.occupied)}
              stroke={strokeColor(r.id, pathSet, destination, floor.occupied)}
              strokeWidth={isDest ? 2.5 : isOnPath ? 2 : 1.5}
              style={{ transition: "fill 0.3s ease, stroke 0.3s ease" }}
            />

            {/* Room type color bar on left */}
            <rect x={r.x} y={r.y} width={5} height={r.h} rx={8}
              fill={isOccupied ? "#ef4444" : isDest ? "#f59e0b" : typeInfo.stroke}
              opacity={0.8}
            />

            {/* Icon */}
            <text
              x={r.x + 22} y={r.y + r.h / 2 + 6}
              textAnchor="middle" fontSize={18}
            >
              {isOccupied ? "🔴" : isDest ? "📍" : typeInfo.icon}
            </text>

            {/* Room label */}
            <text
              x={r.x + r.w / 2 + 10}
              y={r.y + r.h / 2 + (isOccupied ? -8 : 5)}
              textAnchor="middle"
              fontSize={r.w < 150 ? 10 : 13}
              fontWeight="600"
              fill={isDest ? "#fbbf24" : isOnPath ? "#e2e8f0" : "#94a3b8"}
              style={{ transition: "fill 0.3s ease" }}
            >
              {r.label}
            </text>

            {/* Occupied badge */}
            {isOccupied && (
              <text x={r.x + r.w / 2 + 10} y={r.y + r.h / 2 + 14}
                textAnchor="middle" fontSize={10} fill="#f87171" fontWeight="600">
                ● Occupied
              </text>
            )}

            {/* Destination badge */}
            {isDest && (
              <text x={r.x + r.w / 2 + 10} y={r.y + r.h / 2 + 20}
                textAnchor="middle" fontSize={9} fill="#fbbf24" fontWeight="700">
                ▼ DESTINATION
              </text>
            )}
          </g>
        )
      })}

      {/* YOU dot */}
      <circle cx={youNode.x} cy={youNode.y} r={12}
        fill="#22d3ee" stroke="#fff" strokeWidth={2.5}
        style={{ animation: "pulse 2s ease-in-out infinite" }}
        filter="url(#glow)"
      />
      <text x={youNode.x} y={youNode.y + 26}
        textAnchor="middle" fontSize={10} fill="#22d3ee" fontWeight="700">
        YOU
      </text>
    </svg>
  )
}

// ── Legend pill ───────────────────────────────────────────────────────────────
function LegendPill({ color, icon, label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "#1e293b", border: `1px solid ${color}44`,
      borderRadius: 20, padding: "4px 10px", fontSize: 12, color: "#94a3b8",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      {icon} {label}
    </span>
  )
}

// ── Step item ─────────────────────────────────────────────────────────────────
function StepItem({ num, text, isFirst, isLast }) {
  const isStairs = text.toLowerCase().includes("stair")
  return (
    <li style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "10px 0",
      borderBottom: isLast ? "none" : "1px solid #1e293b",
      animation: "fadeIn 0.3s ease both",
      animationDelay: `${num * 0.07}s`,
    }}>
      <span style={{
        minWidth: 26, height: 26, borderRadius: "50%",
        background: isFirst ? "#22d3ee22" : isStairs ? "#3b82f622" : "#f59e0b22",
        border: `1.5px solid ${isFirst ? "#22d3ee" : isStairs ? "#3b82f6" : "#f59e0b"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
        color: isFirst ? "#22d3ee" : isStairs ? "#3b82f6" : "#f59e0b",
      }}>
        {num}
      </span>
      <span style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5, paddingTop: 3 }}>
        {isFirst ? "🟢 " : isStairs ? "🪜 " : "➡️ "}{text}
      </span>
    </li>
  )
}

// ── Block data ────────────────────────────────────────────────────────────────
const BLOCKS = {
  nirmithi: { name: "Nirmithi Block", floors: NIRMITHI_FLOORS },
  srujan: { name: "Srujan Block", floors: SRUJAN_FLOORS },
  pragathi: { name: "Pragathi Block", floors: PRAGATHI_FLOORS },
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IndoorNavigation({ initialBlock }) {
  const defaultBlock = initialBlock && BLOCKS[initialBlock] ? initialBlock : "nirmithi";
  const [activeBlock, setActiveBlock] = useState(defaultBlock)
  const [activeFloor, setActiveFloor] = useState(3)
  const [dest, setDest] = useState("")
  const [path, setPath] = useState([])
  const [error, setError] = useState("")
  const [animating, setAnimating] = useState(false)
  
  const { showToast } = useToast()

  const blockData = BLOCKS[activeBlock]
  const floorConfig = blockData.floors[activeFloor]

  const destOptions = useMemo(() => {
    const opts = []
    Object.entries(BLOCKS).forEach(([bId, bData]) => {
      Object.entries(bData.floors).forEach(([fId, fData]) => {
        fData.destinations.forEach(d => {
          opts.push({ 
            id: d.id, 
            label: `${d.name} (${bData.name} · Floor ${fId})`, 
            blockId: bId,
            floorId: Number(fId) 
          })
        })
      })
    })
    return opts.sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  function handleDestChange(val) {
    setDest(val); setPath([]); setError("")
    if (val) {
      const found = destOptions.find(o => o.id === val)
      if (found) {
        setActiveBlock(found.blockId)
        setActiveFloor(found.floorId)
        showToast(`📍 Navigating to ${found.label.split(' (')[0]} on Floor ${found.floorId}`, "info")
      }
    }
  }

  function handleBlockChange(e) {
    setActiveBlock(e.target.value); setDest(""); setPath([]); setError("")
    const bData = BLOCKS[e.target.value]
    if (bData?.floors && Object.keys(bData.floors).length > 0) {
      setActiveFloor(Math.max(...Object.keys(bData.floors).map(Number)))
    }
  }

  function handleNavigate() {
    setError("")
    if (!dest) { setError("Select a destination."); return }
    if (!floorConfig) { setError("Floor layout not available yet."); return }
    const result = astar(floorConfig.nodes, floorConfig.edges, "stairs", dest)
    if (!result?.length) { setError("No route found on this floor."); return }
    setAnimating(true)
    setPath(result)
    setTimeout(() => setAnimating(false), 800)
  }

  function handleReset() { setPath([]); setDest(""); setError(""); setAnimating(false) }

  const steps = path && floorConfig?.nodes
    ? path.map(id => floorConfig.nodes[id]?.label).filter(Boolean).filter(l => !l.startsWith("Corridor"))
    : []

  if (path.length > 0 && activeFloor !== 1) {
    if (steps[0] === "Stairs") steps.splice(1, 0, `Take stairs to Floor ${activeFloor}`)
    else steps.unshift(`Take stairs to Floor ${activeFloor}`)
  }

  const destLabel = destOptions.find(d => d.id === dest)?.label.split(" (Floor")[0]

  return (
    <div className="indoor-container" style={{ fontFamily: "inherit" }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        .block-select { padding:.5rem .75rem; border-radius:10px; background:#1e293b; color:white; border:1px solid #334155; outline:none; cursor:pointer; font-weight:500; transition:border-color .2s; }
        .block-select:hover { border-color:#f59e0b88; }
        .nav-btn { padding:.55rem 1.2rem; border-radius:10px; font-weight:700; font-size:14px; cursor:pointer; border:none; transition:all .2s; }
        .nav-btn-primary { background:linear-gradient(135deg,#f59e0b,#ea580c); color:#000; }
        .nav-btn-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 16px #f59e0b44; }
        .nav-btn-primary:disabled { opacity:.4; cursor:not-allowed; }
        .nav-btn-secondary { background:#1e293b; color:#94a3b8; border:1px solid #334155; }
        .nav-btn-secondary:hover { border-color:#f59e0b44; color:#e2e8f0; }
        .floor-tab { padding:.35rem .9rem; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; border:1px solid transparent; transition:all .2s; color:#64748b; background:transparent; }
        .floor-tab.active { background:#f59e0b22; border-color:#f59e0b66; color:#f59e0b; }
        .floor-tab:hover:not(.active) { border-color:#334155; color:#94a3b8; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "#e2e8f0" }}>
            Indoor Navigation
          </h2>
          {dest && floorConfig && (
            <span style={{
              display: "inline-block", marginTop: 4,
              background: "#1d4ed822", color: "#60a5fa",
              border: "1px solid #1d4ed844",
              padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            }}>
              Floor {activeFloor}
            </span>
          )}
        </div>
        <select className="block-select" value={activeBlock} onChange={handleBlockChange}>
          {Object.entries(BLOCKS).map(([key, data]) => (
            <option key={key} value={key}>{data.name}</option>
          ))}
        </select>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <DestinationSearch
            label="Global Room Search"
            placeholder="Type a room name..."
            options={destOptions}
            value={dest}
            onChange={handleDestChange}
            emptyMessage="🔍 No rooms found across all blocks"
          />
        </div>
        <button className="nav-btn nav-btn-primary" onClick={handleNavigate} disabled={!dest || !floorConfig}>
          Navigate →
        </button>
        {path.length > 0 && (
          <button className="nav-btn nav-btn-secondary" onClick={handleReset}>
            ✕ Reset
          </button>
        )}
      </div>

      {error && (
        <p style={{
          color: "#f87171", fontSize: 13, margin: "0 0 .75rem",
          background: "#7f1d1d22", border: "1px solid #7f1d1d", borderRadius: 8, padding: "6px 12px"
        }}>
          ⚠️ {error}
        </p>
      )}

      {floorConfig ? (
        <>
          {/* Legend */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
            <LegendPill color="#22d3ee" icon="📍" label="You (Stairs)" />
            <LegendPill color="#f59e0b" icon="🎯" label="Destination" />
            <LegendPill color="#ef4444" icon="🔴" label="Occupied" />
            <LegendPill color="#3b82f6" icon="🎓" label="Classroom" />
            <LegendPill color="#22c55e" icon="🔬" label="Lab" />
            <LegendPill color="#f97316" icon="🏢" label="Office" />
          </div>

          {/* Floor tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: "1rem" }}>
            {Object.keys(blockData.floors).sort((a, b) => b - a).map(f => (
              <button key={f}
                className={`floor-tab ${activeFloor === Number(f) ? "active" : ""}`}
                onClick={() => setActiveFloor(Number(f))}>
                Floor {f}
              </button>
            ))}
          </div>

          {/* Map + Steps */}
          <div className="indoor-map-layout">
            <FloorPlan
              blockId={activeBlock}
              floorId={activeFloor}
              path={path}
              destination={dest}
              currentNode="stairs"
              animating={animating}
            />

            {path.length > 0 && (
              <div className="indoor-steps" style={{
                background: "#0f172a", borderRadius: 14,
                border: "1px solid #1e293b", padding: "1.25rem",
                animation: "fadeIn 0.4s ease",
              }}>
                <h3 style={{ margin: "0 0 .25rem", fontSize: "1rem", color: "#f59e0b", fontWeight: 800 }}>
                  Route to {destLabel}
                </h3>
                <p style={{ color: "#475569", fontSize: 12, margin: "0 0 1rem" }}>
                  {floorConfig.title}
                </p>
                <ol style={{ padding: 0, listStyle: "none", margin: 0 }}>
                  {steps.map((s, i) => (
                    <StepItem
                      key={i} num={i + 1} text={s}
                      isFirst={i === 0} isLast={i === steps.length - 1}
                    />
                  ))}
                </ol>
                <div style={{
                  marginTop: "1rem", padding: "8px 12px",
                  background: "#f59e0b11", borderRadius: 8,
                  border: "1px solid #f59e0b33",
                  fontSize: 12, color: "#f59e0b",
                }}>
                  🏁 {steps.length} steps · Est. {steps.length * 15}s walk
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{
          textAlign: "center", padding: "3rem", color: "#334155",
          background: "#0f172a", borderRadius: 14, border: "1px dashed #1e293b"
        }}>
          <p style={{ fontSize: "2rem", margin: "0 0 .5rem" }}>🏗️</p>
          <p style={{ margin: 0 }}>No indoor maps available for this block yet.</p>
        </div>
      )}
    </div>
  )
}
