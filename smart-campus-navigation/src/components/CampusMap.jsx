import { useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { campusBlueprint, campusBlueprintById } from "../data/campusBlueprint"
import { buildCampusGraphFromGeoJson } from "../outdoor/campusGraph"
import {
  astarRoadPath,
  buildRoadPathGraph,
  findNearestRoadProjection,
  injectProjectionNode,
} from "../outdoor/roadPathGraph"
import DestinationSearch from "./DestinationSearch"

const VBIT_CENTER = [17.4706, 78.7216]
const CAMPUS_FOOTPRINTS_URL = "/data/campus.geojson"
const CAMPUS_ROADS_URL = "/data/campus-roads.geojson"
const CAMPUS_BASEMAP_URL = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
const FOOTPRINT_HOVER_FILL_OPACITY = 0.52
const EARTH_RADIUS_M = 6371000
const CAMPUS_ENTRANCE_HINT = [17.470938, 78.723407]
const CAMPUS_BOUNDS_PADDING_DEGREES = 0.0002
const ENABLE_SNAP_DEBUG = false
const ENABLE_PATH_EDGE_DEBUG = false
const SHOW_FOOTPATH_LAYER = false
const GEOJSON_CACHE_BUSTER = Date.now()
const SNAP_CONNECTOR_MIN_RENDER_METERS = 3
const CAMPUS_SNAP_MAX_METERS = 30
const DESTINATION_SNAP_MAX_METERS = 75
const ENTRANCE_HINT_SNAP_MAX_METERS = 90
const ENABLE_GEOLOCATION_DEBUG = false
const ROAD_POINT_PRECISION = 6
const MIN_ROAD_EDGE_METERS = 0.5
const INTERSECTION_EPSILON = 1e-9

const OUTDOOR_DESTINATIONS = [
  { id: "nirmithi_block",   name: "Nirmithi Block" },
  { id: "srujan_block",     name: "Srujan Block" },
  { id: "aakash_block",     name: "Aakash Block" },
  { id: "avishkar_block",   name: "Avishkar Block" },
  { id: "pratham_block",    name: "Pratham Block" },
  { id: "prathibha_block",  name: "Prathibha Block" },
  { id: "new_block",        name: "New Block" },
  { id: "library",          name: "Library" },
  { id: "nalanda_hall",     name: "Nalanda Auditorium" },
  { id: "boys_hostel",      name: "Boys Hostel" },
  { id: "girls_hostel",     name: "Girls Hostel" },
  { id: "vbit_parking",     name: "VBIT Parking" },
  { id: "vbit_ground",      name: "VBIT Ground" },
  { id: "canteen",          name: "Canteen" },
]

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function toCampusId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function resolveCampusProperties(properties = {}) {
  const featureId = toCampusId(properties.id || properties.name)
  const blueprintEntry = campusBlueprintById[featureId]
  if (!blueprintEntry) return { ...properties, id: featureId || properties.id || "" }
  return { ...properties, ...blueprintEntry, id: blueprintEntry.id, name: blueprintEntry.name, type: blueprintEntry.type }
}

function enrichGeoJsonWithCampusMetadata(payload) {
  if (!payload || !Array.isArray(payload.features)) return payload
  return {
    ...payload,
    features: payload.features.map((feature) => ({
      ...feature,
      properties: resolveCampusProperties(feature.properties),
    })),
  }
}

function getTypeLabel(type) {
  if (type === "academic") return "Academic Block"
  if (type === "service")  return "Service Block"
  if (type === "hostel")   return "Hostel"
  if (type === "ground")   return "Ground / Sports"
  if (type === "parking")  return "Parking"
  return "Campus Block"
}

function getFootprintStyle(feature) {
  const type = feature?.properties?.type
  if (type === "hostel")  return { color: "#3b82f6", weight: 2, fillColor: "#1d4ed8", fillOpacity: 0.3 }
  if (type === "parking") return { color: "#ff7a1a", weight: 2, dashArray: "4 4", fillColor: "#ff7a1a", fillOpacity: 0.1 }
  if (type === "ground")  return { color: "#2ecc71", weight: 2, fillColor: "#2ecc71", fillOpacity: 0.17 }
  return { color: "#ff7a1a", weight: 2, fillColor: "#111111", fillOpacity: 0.17 }
}

function getFootpathStyle() {
  return {
    color: "#00f5d4",
    weight: 3,
    opacity: 0.7,
    lineCap: "round",
    lineJoin: "round",
  }
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const lat1 = toRadians(aLat)
  const lat2 = toRadians(bLat)
  const dLat = toRadians(bLat - aLat)
  const dLng = toRadians(bLng - aLng)
  const haversineValue =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const arc = 2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))
  return EARTH_RADIUS_M * arc
}

function toRoadNodeKey(lat, lng) {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

function getRoadLineCoordinateSets(roadGeoJsonPayload) {
  const features = Array.isArray(roadGeoJsonPayload?.features) ? roadGeoJsonPayload.features : []
  const lineCoordinateSets = []

  features.forEach((feature) => {
    const geometry = feature?.geometry
    if (!geometry) {
      return
    }

    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
      lineCoordinateSets.push(geometry.coordinates)
      return
    }

    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((lineCoordinates) => {
        if (Array.isArray(lineCoordinates)) {
          lineCoordinateSets.push(lineCoordinates)
        }
      })
    }
  })

  return lineCoordinateSets
}

function densifySegmentCoordinates(startCoordinatePair, endCoordinatePair, stepMeters = 2) {
  const [startLng, startLat] = Array.isArray(startCoordinatePair) ? startCoordinatePair : []
  const [endLng, endLat] = Array.isArray(endCoordinatePair) ? endCoordinatePair : []

  if (
    !Number.isFinite(startLat) ||
    !Number.isFinite(startLng) ||
    !Number.isFinite(endLat) ||
    !Number.isFinite(endLng)
  ) {
    return [startCoordinatePair, endCoordinatePair].filter(Boolean)
  }

  const totalDistance = distanceMeters(startLat, startLng, endLat, endLng)
  if (!Number.isFinite(totalDistance) || totalDistance <= stepMeters) {
    return [
      [startLng, startLat],
      [endLng, endLat],
    ]
  }

  const steps = Math.floor(totalDistance / stepMeters)
  if (steps <= 1) {
    return [
      [startLng, startLat],
      [endLng, endLat],
    ]
  }

  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const lat = startLat + (endLat - startLat) * t
    const lng = startLng + (endLng - startLng) * t
    points.push([lng, lat])
  }

  return points
}

function withCacheBuster(url) {
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}v=${GEOJSON_CACHE_BUSTER}`
}

function buildCampusPathGraph(roadGeoJsonPayload) {
  const lineCoordinateSets = getRoadLineCoordinateSets(roadGeoJsonPayload)
  const graph = {}
  const adjacency = {}

  function ensureNode(coordinatePair) {
    const [lng, lat] = Array.isArray(coordinatePair) ? coordinatePair : []
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null
    }

    const nodeKey = toRoadNodeKey(lat, lng)
    if (!graph[nodeKey]) {
      graph[nodeKey] = {
        coord: [lat, lng],
        neighbors: [],
      }
    }
    adjacency[nodeKey] = adjacency[nodeKey] || new Map()
    return nodeKey
  }

  function connectNodes(a, b) {
    if (!a || !b || a === b) {
      return
    }

    const [aLat, aLng] = graph[a].coord
    const [bLat, bLng] = graph[b].coord
    const segmentDistance = distanceMeters(aLat, aLng, bLat, bLng)
    const existingWeight = adjacency[a].get(b)

    if (existingWeight === undefined || segmentDistance < existingWeight) {
      adjacency[a].set(b, segmentDistance)
      adjacency[b].set(a, segmentDistance)
    }
  }

  lineCoordinateSets.forEach((lineCoordinates) => {
    let previousNodeKey = null
    let previousCoordinatePair = null

    lineCoordinates.forEach((coordinatePair) => {
      if (!previousCoordinatePair) {
        // Seed the first node for this line
        previousNodeKey = ensureNode(coordinatePair)
        previousCoordinatePair = coordinatePair
        return
      }

      const densified = densifySegmentCoordinates(previousCoordinatePair, coordinatePair)
      // We already created a node for the first point in this segment,
      // so we start from index 1 to avoid duplicating it.
      let localPrevKey = previousNodeKey

      densified.forEach((point, index) => {
        if (index === 0) {
          return
        }

        const nodeKey = ensureNode(point)
        if (!nodeKey) {
          return
        }

        if (localPrevKey) {
          connectNodes(localPrevKey, nodeKey)
        }

        localPrevKey = nodeKey
        previousNodeKey = nodeKey
      })

      previousCoordinatePair = coordinatePair
    })
  })

  function syncNeighborsFromAdjacency() {
    Object.keys(graph).forEach((nodeKey) => {
      graph[nodeKey].neighbors = [...(adjacency[nodeKey] || new Map()).entries()].map(
        ([neighborKey, weight]) => ({ key: neighborKey, dist: weight })
      )
    })
  }

  function listConnectedComponents() {
    const unseenNodeKeys = new Set(Object.keys(graph))
    const components = []

    while (unseenNodeKeys.size > 0) {
      const seedNodeKey = unseenNodeKeys.values().next().value
      const stack = [seedNodeKey]
      unseenNodeKeys.delete(seedNodeKey)
      const component = []

      while (stack.length > 0) {
        const currentNodeKey = stack.pop()
        component.push(currentNodeKey)

        const neighbors = graph[currentNodeKey]?.neighbors || []
        neighbors.forEach(({ key: neighborNodeKey }) => {
          if (!unseenNodeKeys.has(neighborNodeKey)) {
            return
          }
          unseenNodeKeys.delete(neighborNodeKey)
          stack.push(neighborNodeKey)
        })
      }

      components.push(component)
    }

    return components.sort((first, second) => second.length - first.length)
  }

  syncNeighborsFromAdjacency()
  const components = listConnectedComponents()

  if (components.length > 1) {
    console.warn(
      `Campus path graph has ${components.length} disconnected segments. ` +
      "Only explicit GeoJSON road segments are used for routing edges."
    )
  }

  return graph
}

function findNearestCampusPathNode(graph, [targetLat, targetLng]) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
    return null
  }

  let nearestKey = null
  let nearestDistance = Number.POSITIVE_INFINITY

  Object.entries(graph || {}).forEach(([nodeKey, node]) => {
    const [nodeLat, nodeLng] = node.coord || []
    if (!Number.isFinite(nodeLat) || !Number.isFinite(nodeLng)) {
      return
    }

    const candidateDistance = distanceMeters(targetLat, targetLng, nodeLat, nodeLng)
    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance
      nearestKey = nodeKey
    }
  })

  if (!nearestKey) {
    return null
  }

  return {
    key: nearestKey,
    distance: nearestDistance,
  }
}

function snapToCampusPathNode(graph, targetCoordinate) {
  return findNearestCampusPathNode(graph, targetCoordinate)?.key || null
}

function resolveGeolocationErrorMessage(error) {
  if (!error || typeof error.code !== "number") {
    return "Unable to determine your location"
  }

  if (error.code === 1) {
    return "Location permission denied"
  }
  if (error.code === 2) {
    return "Location unavailable"
  }
  if (error.code === 3) {
    return "Location request timed out"
  }

  return "Unable to determine your location"
}

function projectPointToSegment(targetLat, targetLng, aLat, aLng, bLat, bLng) {
  if (
    !Number.isFinite(targetLat) ||
    !Number.isFinite(targetLng) ||
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLng) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLng)
  ) {
    return null
  }

  const ax = aLng
  const ay = aLat
  const bx = bLng
  const by = bLat
  const px = targetLng
  const py = targetLat

  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const abLenSq = abx * abx + aby * aby
  if (!Number.isFinite(abLenSq) || abLenSq === 0) {
    return { lat: aLat, lng: aLng, t: 0 }
  }

  let t = (apx * abx + apy * aby) / abLenSq
  if (!Number.isFinite(t)) {
    t = 0
  }
  if (t < 0) t = 0
  else if (t > 1) t = 1

  const projX = ax + abx * t
  const projY = ay + aby * t

  return { lat: projY, lng: projX, t }
}

function findNearestCampusPathProjection(graph, [targetLat, targetLng]) {
  let nearestDistance = Number.POSITIVE_INFINITY
  let best = null
  const seenEdges = new Set()

  Object.entries(graph || {}).forEach(([nodeKey, node]) => {
    const [aLat, aLng] = node.coord || []
    if (!Number.isFinite(aLat) || !Number.isFinite(aLng)) {
      return
    }

    ;(node.neighbors || []).forEach(({ key: neighborKey }) => {
      const neighbor = graph[neighborKey]
      if (!neighbor) {
        return
      }

      const edgeId = [nodeKey, neighborKey].sort().join("|")
      if (seenEdges.has(edgeId)) {
        return
      }
      seenEdges.add(edgeId)

      const [bLat, bLng] = neighbor.coord || []
      const projection = projectPointToSegment(targetLat, targetLng, aLat, aLng, bLat, bLng)
      if (!projection) {
        return
      }

      const d = distanceMeters(targetLat, targetLng, projection.lat, projection.lng)
      if (d < nearestDistance) {
        nearestDistance = d
        best = {
          edgeStartKey: nodeKey,
          edgeEndKey: neighborKey,
          point: [projection.lat, projection.lng],
          distance: d,
        }
      }
    })
  })

  return best
}

function cloneGraphWithProjectedNode(baseGraph, projection, tempKey) {
  const workingGraph = {}

  Object.entries(baseGraph || {}).forEach(([nodeKey, node]) => {
    workingGraph[nodeKey] = {
      coord: Array.isArray(node.coord) ? [...node.coord] : node.coord,
      neighbors: Array.isArray(node.neighbors)
        ? node.neighbors.map(({ key, dist }) => ({ key, dist }))
        : [],
    }
  })

  if (!projection || !Array.isArray(projection.point)) {
    return workingGraph
  }

  const [projLat, projLng] = projection.point
  const { edgeStartKey, edgeEndKey } = projection
  const startNode = workingGraph[edgeStartKey]
  const endNode = workingGraph[edgeEndKey]
  if (!startNode || !endNode) {
    return workingGraph
  }

  workingGraph[tempKey] = {
    coord: [projLat, projLng],
    neighbors: [],
  }

  const distToStart = distanceMeters(projLat, projLng, startNode.coord[0], startNode.coord[1])
  const distToEnd = distanceMeters(projLat, projLng, endNode.coord[0], endNode.coord[1])

  workingGraph[tempKey].neighbors.push(
    { key: edgeStartKey, dist: distToStart },
    { key: edgeEndKey, dist: distToEnd }
  )
  startNode.neighbors.push({ key: tempKey, dist: distToStart })
  endNode.neighbors.push({ key: tempKey, dist: distToEnd })

  return workingGraph
}

function dijkstraCampusPath(graph, startKey, endKey) {
  if (!graph?.[startKey] || !graph?.[endKey]) {
    return null
  }

  const distances = {}
  const previous = {}
  const visited = new Set()
  const queue = [[0, startKey]]

  Object.keys(graph).forEach((nodeKey) => {
    distances[nodeKey] = Number.POSITIVE_INFINITY
  })
  distances[startKey] = 0

  while (queue.length > 0) {
    queue.sort((a, b) => a[0] - b[0])
    const [distanceSoFar, currentKey] = queue.shift()

    if (visited.has(currentKey)) {
      continue
    }
    visited.add(currentKey)

    if (currentKey === endKey) {
      break
    }

    const neighbors = graph[currentKey]?.neighbors || []
    neighbors.forEach(({ key: neighborKey, dist }) => {
      if (!graph[neighborKey]) {
        return
      }

      const nextDistance = distanceSoFar + dist
      if (nextDistance < distances[neighborKey]) {
        distances[neighborKey] = nextDistance
        previous[neighborKey] = currentKey
        queue.push([nextDistance, neighborKey])
      }
    })
  }

  if (startKey !== endKey && previous[endKey] === undefined) {
    return null
  }

  const pathKeys = []
  let cursor = endKey

  while (cursor !== undefined) {
    pathKeys.unshift(cursor)
    if (cursor === startKey) {
      break
    }
    cursor = previous[cursor]
  }

  if (pathKeys[0] !== startKey) {
    return null
  }

  return pathKeys.map((nodeKey) => graph[nodeKey].coord)
}

function getCampusPathBounds(graph) {
  const nodeCoordinates = Object.values(graph || {}).map((node) => node.coord).filter(Boolean)
  if (nodeCoordinates.length === 0) {
    return null
  }

  const lats = nodeCoordinates.map(([lat]) => lat)
  const lngs = nodeCoordinates.map(([, lng]) => lng)

  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  }
}

function isInsideCampusBounds(bounds, lat, lng) {
  if (!bounds || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false
  }

  return (
    lat >= bounds.minLat - CAMPUS_BOUNDS_PADDING_DEGREES &&
    lat <= bounds.maxLat + CAMPUS_BOUNDS_PADDING_DEGREES &&
    lng >= bounds.minLng - CAMPUS_BOUNDS_PADDING_DEGREES &&
    lng <= bounds.maxLng + CAMPUS_BOUNDS_PADDING_DEGREES
  )
}

function appendRouteSegment(targetPath, segment) {
  if (!Array.isArray(segment) || segment.length === 0) {
    return
  }

  if (targetPath.length === 0) {
    targetPath.push(...segment)
    return
  }

  const [lastLat, lastLng] = targetPath[targetPath.length - 1]
  const [firstLat, firstLng] = segment[0]

  if (distanceMeters(lastLat, lastLng, firstLat, firstLng) <= 1) {
    targetPath.push(...segment.slice(1))
    return
  }

  targetPath.push(...segment)
}

function buildStraightConnector(startCoord, endCoord) {
  const [startLat, startLng] = Array.isArray(startCoord) ? startCoord : []
  const [endLat, endLng] = Array.isArray(endCoord) ? endCoord : []
  if (
    !Number.isFinite(startLat) ||
    !Number.isFinite(startLng) ||
    !Number.isFinite(endLat) ||
    !Number.isFinite(endLng)
  ) {
    return []
  }

  const connectorDistance = distanceMeters(startLat, startLng, endLat, endLng)
  if (connectorDistance < SNAP_CONNECTOR_MIN_RENDER_METERS) {
    return []
  }

  return [
    [startLat, startLng],
    [endLat, endLng],
  ]
}

function resolveDestinationCoordinate(destinationId, destinationNode) {
  const entranceCoordinate = campusBlueprintById[destinationId]?.entrance
  if (
    Array.isArray(entranceCoordinate) &&
    Number.isFinite(entranceCoordinate[0]) &&
    Number.isFinite(entranceCoordinate[1])
  ) {
    return entranceCoordinate
  }
  return [destinationNode?.x, destinationNode?.y]
}

function CampusMap({ onHandoffToIndoor }) {
  const mapNodeRef   = useRef(null)
  const mapRef       = useRef(null)
  const userMarkerRef    = useRef(null)
  const routeLayerRef    = useRef(null)
  const destMarkerRef    = useRef(null)
  const campusRoadDataRef = useRef(null)
  const campusFootpathLayerRef = useRef(null)
  const campusFootprintLayerRef = useRef(null)
  const hasCenteredOnUserRef = useRef(false)
  const hasGpsFixRef = useRef(false)
  const routeRequestRef = useRef(null)
  const campusPathGraphRef = useRef(null)
  const campusPathBoundsRef = useRef(null)
  const pathEdgeDebugLayerRef = useRef(null)
  const pathEdgeDebugTimeoutRef = useRef(null)

  const [userLocation,      setUserLocation]      = useState(null)
  const [userLocationLabel, setUserLocationLabel] = useState("Locating...")
  const [selectedDest,      setSelectedDest]      = useState("")
  const [outdoorPath,       setOutdoorPath]       = useState([])
  const [selectedBuilding,  setSelectedBuilding]  = useState(null)
  const [campusGraph,       setCampusGraph]       = useState({})
  const [error,             setError]             = useState("")

  const campusSummary = useMemo(() => {
    const counts = campusBlueprint.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1; return acc
    }, {})
    return [
      { id: "academic", label: "Academic", count: counts.academic || 0 },
      { id: "service",  label: "Service",  count: counts.service  || 0 },
      { id: "hostel",   label: "Hostel",   count: counts.hostel   || 0 },
      { id: "ground",   label: "Ground",   count: counts.ground   || 0 },
      { id: "parking",  label: "Parking",  count: counts.parking  || 0 },
    ].filter((e) => e.count > 0)
  }, [])

  const outdoorDestinationOptions = useMemo(
    () => OUTDOOR_DESTINATIONS
      .filter((d) => Boolean(campusGraph[d.id]))
      .map((d) => ({ id: d.id, label: d.name })),
    [campusGraph]
  )

  const syncFootpathLayerVisibility = (mapInstance = mapRef.current, hasActiveRoute = outdoorPath.length > 0) => {
    if (!mapInstance) {
      return
    }

    if (campusFootpathLayerRef.current) {
      campusFootpathLayerRef.current.remove()
      campusFootpathLayerRef.current = null
    }

    if (!SHOW_FOOTPATH_LAYER || hasActiveRoute || !campusRoadDataRef.current) {
      return
    }

    campusFootpathLayerRef.current = L.geoJSON(campusRoadDataRef.current, {
      style: getFootpathStyle,
      interactive: false,
    }).addTo(mapInstance)
  }

  // â”€â”€ Map init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined

    const map = L.map(mapNodeRef.current, {
      scrollWheelZoom: false,
      dragging: true,
      zoomControl: false,
    }).setView(VBIT_CENTER, 18)
    mapRef.current = map

    L.tileLayer(CAMPUS_BASEMAP_URL, {
      attribution: "&copy; OpenStreetMap & Carto",
      maxZoom: 20,
    }).addTo(map)

    // Custom zoom buttons
    const zoomControl = L.control({ position: "topleft" })
    zoomControl.onAdd = () => {
      const div = L.DomUtil.create("div", "custom-zoom-control")
      div.innerHTML = `<button class="zoom-btn zoom-in" type="button">+</button><button class="zoom-btn zoom-out" type="button">−</button>`
      L.DomEvent.disableClickPropagation(div)
      div.querySelector(".zoom-in").onclick  = () => map.zoomIn()
      div.querySelector(".zoom-out").onclick = () => map.zoomOut()
      return div
    }
    zoomControl.addTo(map)

    // Right-click coordinate probe for road node calibration
    const probe = L.control({ position: "bottomleft" })
    probe.onAdd = () => {
      const div = L.DomUtil.create("div", "coord-probe")
      div.style.cssText = "background:#0f172a;color:#f59e0b;padding:6px 10px;border-radius:6px;font-size:11px;font-family:monospace;border:1px solid #334155;display:none;"
      div.innerHTML = "Right-click map to get coords"
      return div
    }
    probe.addTo(map)

    map.on("contextmenu", (e) => {
      const lat = e.latlng.lat.toFixed(7)
      const lng = e.latlng.lng.toFixed(7)
      const text = `${lat}, ${lng}`
      const div = document.querySelector(".coord-probe")
      if (div) {
        div.style.display = "block"
        div.innerHTML = `<b>Copied:</b> ${text}`
      }
      navigator.clipboard?.writeText(text).catch(() => {})
    })

    // Temporary helper for entrance calibration.
    const handleSnapDebugClick = (e) => {
      const pathGraph = campusPathGraphRef.current
      const clickedCoord = [e.latlng.lat, e.latlng.lng]
      const snappedNodeKey = snapToCampusPathNode(pathGraph, clickedCoord)
      if (!snappedNodeKey || !pathGraph?.[snappedNodeKey]) {
        console.log("Clicked:", e.latlng, "-> Snapped to: none")
        return
      }

      const snappedNode = pathGraph[snappedNodeKey]
      const snappedCoord = snappedNode.coord
      const snappedDistance = distanceMeters(
        clickedCoord[0],
        clickedCoord[1],
        snappedCoord[0],
        snappedCoord[1]
      ).toFixed(1)
      console.log(
        "Clicked:",
        e.latlng,
        "-> Snapped to:",
        snappedCoord,
        "Key:",
        snappedNodeKey,
        "Distance(m):",
        snappedDistance
      )
    }
    if (ENABLE_SNAP_DEBUG) {
      map.on("click", handleSnapDebugClick)
    }

    // Load GeoJSON footprints
    const ac = new AbortController()
    async function loadFootprints() {
      try {
        const [footprintsResponse, roadsResponse] = await Promise.all([
          fetch(withCacheBuster(CAMPUS_FOOTPRINTS_URL), { signal: ac.signal }),
          fetch(withCacheBuster(CAMPUS_ROADS_URL), { signal: ac.signal }).catch(() => null),
        ])
        const raw = await footprintsResponse.json()
        if (ac.signal.aborted || !mapRef.current) return

        const data = enrichGeoJsonWithCampusMetadata(raw)
        let roadData = null
        if (roadsResponse?.ok) {
          roadData = await roadsResponse.json()
        }

        campusRoadDataRef.current = roadData
        syncFootpathLayerVisibility(map, outdoorPath.length > 0)

        campusFootprintLayerRef.current = L.geoJSON(data, {
          style: getFootprintStyle,
          onEachFeature: (feature, layer) => {
            const props    = resolveCampusProperties(feature?.properties)
            const name     = props?.name
            const baseStyle = getFootprintStyle({ properties: props })
            if (name) {
              layer.bindTooltip(name, { direction: "center", className: "campus-footprint-label", opacity: 0.92 })
              layer.bindPopup(name)
            }
            layer.on("mouseover", () => layer.setStyle({ fillOpacity: FOOTPRINT_HOVER_FILL_OPACITY }))
            layer.on("mouseout",  () => layer.setStyle({ fillOpacity: baseStyle.fillOpacity }))
            layer.on("click",     () => setSelectedBuilding(props))
          },
        }).addTo(map)

        const graph = buildCampusGraphFromGeoJson(data, roadData)
        setCampusGraph(graph)
        campusPathGraphRef.current = buildRoadPathGraph(roadData, data)
        campusPathBoundsRef.current = getCampusPathBounds(campusPathGraphRef.current)
        if (ENABLE_PATH_EDGE_DEBUG) {
          pathEdgeDebugLayerRef.current?.remove()
          pathEdgeDebugLayerRef.current = null
          if (pathEdgeDebugTimeoutRef.current) {
            clearTimeout(pathEdgeDebugTimeoutRef.current)
            pathEdgeDebugTimeoutRef.current = null
          }

          console.log("Graph node count:", Object.keys(campusPathGraphRef.current || {}).length)

          pathEdgeDebugTimeoutRef.current = setTimeout(() => {
            const graphNodes = campusPathGraphRef.current
            const mapInstance = mapRef.current
            if (!graphNodes || !mapInstance) {
              console.log("Cyan edges drawn:", 0)
              pathEdgeDebugTimeoutRef.current = null
              return
            }

            const seen = new Set()
            const debugLayer = L.layerGroup().addTo(mapInstance)

            Object.entries(graphNodes).forEach(([nodeKey, node]) => {
              const coord = node?.coord
              if (!Array.isArray(coord) || coord.length < 2) {
                return
              }

              ;(node?.neighbors || []).forEach(({ key: neighborKey }) => {
                const neighborCoord = graphNodes[neighborKey]?.coord
                if (!Array.isArray(neighborCoord) || neighborCoord.length < 2) {
                  return
                }

                const edgeId = [nodeKey, neighborKey].sort().join("|")
                if (seen.has(edgeId)) {
                  return
                }
                seen.add(edgeId)

                L.polyline([coord, neighborCoord], {
                  color: "#00ffff",
                  weight: 3,
                  opacity: 1,
                  interactive: false,
                }).addTo(debugLayer)
              })
            })

            pathEdgeDebugLayerRef.current?.remove()
            pathEdgeDebugLayerRef.current = debugLayer
            pathEdgeDebugTimeoutRef.current = null
            console.log("Cyan edges drawn:", seen.size)
          }, 1000)
        }

        const bounds = campusFootprintLayerRef.current.getBounds()
        if (bounds.isValid() && !hasCenteredOnUserRef.current) {
          map.fitBounds(bounds, { padding: [20, 20] })
        }
      } catch (e) {
        if (e.name !== "AbortError") console.error("Footprint load error:", e)
      }
    }
    loadFootprints()

    return () => {
      ac.abort()
      if (routeRequestRef.current) {
        routeRequestRef.current.abort()
        routeRequestRef.current = null
      }
      if (routeLayerRef.current) { routeLayerRef.current.remove(); routeLayerRef.current = null }
      if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }
      if (campusFootpathLayerRef.current) { campusFootpathLayerRef.current.remove(); campusFootpathLayerRef.current = null }
      if (campusFootprintLayerRef.current) { campusFootprintLayerRef.current.remove(); campusFootprintLayerRef.current = null }
      if (pathEdgeDebugTimeoutRef.current) {
        clearTimeout(pathEdgeDebugTimeoutRef.current)
        pathEdgeDebugTimeoutRef.current = null
      }
      if (pathEdgeDebugLayerRef.current) {
        pathEdgeDebugLayerRef.current.remove()
        pathEdgeDebugLayerRef.current = null
      }
      if (ENABLE_SNAP_DEBUG) {
        map.off("click", handleSnapDebugClick)
      }
      campusRoadDataRef.current = null
      campusPathGraphRef.current = null
      campusPathBoundsRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    syncFootpathLayerVisibility(mapRef.current, outdoorPath.length > 0)
  }, [outdoorPath.length])

  // GPS: watch user position
  useEffect(() => {
    if (!navigator.geolocation) {
      setUserLocation(null)
      setUserLocationLabel("GPS unavailable - enable location access to route from your position")
      if (!hasCenteredOnUserRef.current && mapRef.current) {
        mapRef.current.setView(VBIT_CENTER, 18)
        hasCenteredOnUserRef.current = true
      }
      return undefined
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const { latitude, longitude, accuracy } = coords
        hasGpsFixRef.current = true
        setUserLocation([latitude, longitude])
        setUserLocationLabel(`Your location (+/-${Math.round(accuracy)}m)`)
        if (ENABLE_GEOLOCATION_DEBUG) {
          console.log("REAL GPS:", latitude, longitude, "accuracy(m):", Math.round(accuracy))
        }
        if (!hasCenteredOnUserRef.current && mapRef.current) {
          mapRef.current.setView([latitude, longitude], 18)
          hasCenteredOnUserRef.current = true
        }
      },
      (geoError) => {
        const errorMessage = resolveGeolocationErrorMessage(geoError)
        if (hasGpsFixRef.current) {
          setUserLocationLabel(`${errorMessage} - using last known location`)
        } else {
          setUserLocationLabel(`${errorMessage} - enable location access to begin routing`)
        }
        if (ENABLE_GEOLOCATION_DEBUG) {
          console.warn("Geolocation error:", geoError)
        }
        if (!hasCenteredOnUserRef.current && mapRef.current && !hasGpsFixRef.current) {
          mapRef.current.setView(VBIT_CENTER, 18)
          hasCenteredOnUserRef.current = true
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  // â”€â”€ Draw / update blue dot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const map = mapRef.current
    if (!map || !userLocation) return

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.circleMarker(userLocation, {
        radius: 9, color: "#fff", weight: 2,
        fillColor: "#3b82f6", fillOpacity: 1,
      }).addTo(map).bindPopup(userLocationLabel)
    } else {
      userMarkerRef.current.setLatLng(userLocation)
      userMarkerRef.current.setPopupContent(userLocationLabel)
    }
    userMarkerRef.current.bringToFront()
  }, [userLocation, userLocationLabel])

async function getHybridRoute(startLat, startLng, endLat, endLng) {
  const pathGraph = campusPathGraphRef.current
  const graphNodeCount = Object.keys(pathGraph || {}).length
  if (graphNodeCount === 0) {
    throw new Error("Campus path network is not available.")
  }

  const connectorStart = []
  const connectorEnd = []
  let graphPath = []
  const campusBounds = campusPathBoundsRef.current
  const startsInsideCampus = isInsideCampusBounds(campusBounds, startLat, startLng)
  const destinationProjectionKey = "__destination_projection__"
  let routeStartKey = "__start_projection__"
  let routingGraph = pathGraph
  let routingComponentId = null

  if (!startsInsideCampus) {
    routeStartKey = "__entrance_projection__"
    const entranceProjection = findNearestRoadProjection(pathGraph, CAMPUS_ENTRANCE_HINT)
    if (!entranceProjection || !Array.isArray(entranceProjection.point)) {
      throw new Error("Campus entrance is not connected to mapped campus paths.")
    }
    if (
      !Number.isFinite(entranceProjection.distance) ||
      entranceProjection.distance > ENTRANCE_HINT_SNAP_MAX_METERS
    ) {
      throw new Error("Campus entrance hint is not aligned with mapped paths.")
    }

    routingGraph = injectProjectionNode(pathGraph, entranceProjection, routeStartKey)
    routingComponentId = entranceProjection.componentId

    if (ENABLE_GEOLOCATION_DEBUG) {
      console.log("Entrance projection:", {
        entranceHint: CAMPUS_ENTRANCE_HINT,
        projectionPoint: entranceProjection.point,
        edgeStartKey: entranceProjection.edgeStartKey,
        edgeEndKey: entranceProjection.edgeEndKey,
        distanceMeters: Math.round(entranceProjection.distance),
      })
    }

    const [entranceLat, entranceLng] = entranceProjection.point
    const osrmUrl =
      "https://router.project-osrm.org/route/v1/foot/" +
      `${startLng},${startLat};${entranceLng},${entranceLat}` +
      "?overview=full&geometries=geojson"

    const controller = new AbortController()
    routeRequestRef.current = controller

    try {
      const response = await fetch(osrmUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Routing service returned ${response.status}`)
      }

      const payload = await response.json()
      const coordinates = payload?.routes?.[0]?.geometry?.coordinates
      if (Array.isArray(coordinates) && coordinates.length > 0) {
        const osrmPoints = coordinates.map(([lng, lat]) => [lat, lng])
        connectorStart.push(...osrmPoints)
      } else {
        connectorStart.push(
          ...buildStraightConnector([startLat, startLng], [entranceLat, entranceLng])
        )
      }
    } catch (connectorError) {
      if (connectorError?.name === "AbortError") {
        throw connectorError
      }
      connectorStart.push(
        ...buildStraightConnector([startLat, startLng], [entranceLat, entranceLng])
      )
    } finally {
      if (routeRequestRef.current === controller) {
        routeRequestRef.current = null
      }
    }
  } else {
    const startProjection = findNearestRoadProjection(pathGraph, [startLat, startLng])
    if (!startProjection || !Array.isArray(startProjection.point)) {
      throw new Error("Current location is not connected to mapped campus paths.")
    }

    if (
      !Number.isFinite(startProjection.distance) ||
      startProjection.distance > CAMPUS_SNAP_MAX_METERS
    ) {
      throw new Error("You are outside the mapped campus walking network.")
    }

    routingGraph = injectProjectionNode(pathGraph, startProjection, routeStartKey)
    routingComponentId = startProjection.componentId

    if (ENABLE_GEOLOCATION_DEBUG) {
      console.log("Start projection:", {
        gps: [startLat, startLng],
        projectedPoint: startProjection.point,
        edgeStartKey: startProjection.edgeStartKey,
        edgeEndKey: startProjection.edgeEndKey,
        distanceMeters: Math.round(startProjection.distance),
      })
    }

    connectorStart.push(...buildStraightConnector([startLat, startLng], startProjection.point))
  }

  const destinationProjection = findNearestRoadProjection(pathGraph, [endLat, endLng], {
    allowedComponentIds:
      Number.isInteger(routingComponentId) ? new Set([routingComponentId]) : undefined,
  })
  if (!destinationProjection || !Array.isArray(destinationProjection.point)) {
    throw new Error("Destination is not connected to mapped campus paths.")
  }
  if (
    !Number.isFinite(destinationProjection.distance) ||
    destinationProjection.distance > DESTINATION_SNAP_MAX_METERS
  ) {
    throw new Error("Destination is too far from mapped campus paths.")
  }
  if (ENABLE_GEOLOCATION_DEBUG) {
    console.log("Destination projection:", {
      requested: [endLat, endLng],
      projectedPoint: destinationProjection.point,
      edgeStartKey: destinationProjection.edgeStartKey,
      edgeEndKey: destinationProjection.edgeEndKey,
      distanceMeters: Math.round(destinationProjection.distance),
    })
  }

  routingGraph = injectProjectionNode(
    routingGraph,
    destinationProjection,
    destinationProjectionKey
  )

  graphPath = astarRoadPath(routingGraph, routeStartKey, destinationProjectionKey) || []
  if (graphPath.length < 2) {
    throw new Error("No on-campus walking path found to destination.")
  }

  connectorEnd.push(
    ...buildStraightConnector(graphPath[graphPath.length - 1], [endLat, endLng])
  )

  const fullPath = []
  appendRouteSegment(fullPath, connectorStart)
  appendRouteSegment(fullPath, graphPath)
  appendRouteSegment(fullPath, connectorEnd)

  return {
    fullPath,
    connectorStart,
    graphPath,
    connectorEnd,
  }
}

  // â”€â”€ Routing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Uses campus path routing with a direct connector when the start point is outside campus bounds.
  async function handleRoute() {
    setError("")
    if (!selectedDest) { setError("Select a destination."); return }
    if (!userLocation) { setError("Waiting for location..."); return }
    if (!campusGraph[selectedDest]) { setError("Destination not in map."); return }

    const map = mapRef.current
    if (!map) { setError("Map is not ready yet."); return }

    const [startLat, startLng] = userLocation
    const destNode = campusGraph[selectedDest]
    const [endLat, endLng] = resolveDestinationCoordinate(selectedDest, destNode)

    if (!Number.isFinite(endLat) || !Number.isFinite(endLng)) {
      setError("Destination coordinates are unavailable.")
      return
    }

    if (distanceMeters(startLat, startLng, endLat, endLng) <= 8) {
      setError("You are already there!")
      return
    }

    if (routeRequestRef.current) {
      routeRequestRef.current.abort()
      routeRequestRef.current = null
    }
    if (routeLayerRef.current) { routeLayerRef.current.remove(); routeLayerRef.current = null }
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }
    setOutdoorPath([])

    try {
      const routeSegments = await getHybridRoute(startLat, startLng, endLat, endLng)
      const routeLatLngs = routeSegments?.fullPath || []
      if (!routeLatLngs.length) {
        setError("No route found for this destination.")
        return
      }

      setOutdoorPath(routeLatLngs)
      const routeGroup = L.featureGroup().addTo(map)

      if (Array.isArray(routeSegments.connectorStart) && routeSegments.connectorStart.length >= 2) {
        L.polyline(routeSegments.connectorStart, {
          color: "#f59e0b",
          weight: 3,
          opacity: 0.5,
          dashArray: "6,6",
          lineCap: "round",
          lineJoin: "round",
          className: "campus-route-connector",
        }).addTo(routeGroup)
      }

      if (Array.isArray(routeSegments.graphPath) && routeSegments.graphPath.length >= 2) {
        L.polyline(routeSegments.graphPath, {
          color: "#f59e0b",
          weight: 6,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          className: "campus-active-route",
        }).addTo(routeGroup)
      }

      if (Array.isArray(routeSegments.connectorEnd) && routeSegments.connectorEnd.length >= 2) {
        L.polyline(routeSegments.connectorEnd, {
          color: "#f59e0b",
          weight: 3,
          opacity: 0.5,
          dashArray: "6,6",
          lineCap: "round",
          lineJoin: "round",
          className: "campus-route-connector",
        }).addTo(routeGroup)
      }
      routeLayerRef.current = routeGroup

      destMarkerRef.current = L.circleMarker([endLat, endLng], {
        radius: 10, color: "#f59e0b", weight: 3,
        fillColor: "#fbbf24", fillOpacity: 1,
      }).addTo(map).bindPopup(destNode.label || selectedDest)

      routeGroup.bringToFront()
      userMarkerRef.current?.bringToFront()
      const routeBounds = routeGroup.getBounds()
      if (routeBounds?.isValid?.()) {
        map.fitBounds(routeBounds, { padding: [40, 40], maxZoom: 18 })
      }
    } catch (routeError) {
      if (routeError?.name === "AbortError") {
        return
      }
      console.error("Routing failed:", routeError)
      setOutdoorPath([])
      setError(routeError?.message || "Routing failed. Please try again.")
    }
  }


  function handleHandoff() {
    if (!outdoorPath.length) return
    onHandoffToIndoor?.({ building: "nirmithi", entranceNode: "entrance" })
  }

  return (
    <div className="campus-map-wrapper">
      <div className="campus-map-toolbar">
        <DestinationSearch
          className="campus-map-destination-search"
          label="Destination"
          placeholder="Search destination..."
          options={outdoorDestinationOptions}
          value={selectedDest}
          onChange={(id) => { setSelectedDest(id); setError("") }}
          emptyMessage="No destination found."
        />
        <button type="button" className="route-cta" onClick={handleRoute} disabled={!selectedDest}>
          <svg xmlns="http://www.w3.org/2000/svg" className="route-cta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <span>Start Route</span>
        </button>
        <button type="button" className="route-button secondary" onClick={handleHandoff} disabled={!outdoorPath.length}>
          Continue Indoors
        </button>
        {error && <span className="campus-map-error">{error}</span>}
      </div>

      <div className="campus-overview-row">
        {campusSummary.map((s) => (
          <span key={s.id} className="campus-overview-chip">{s.label}: {s.count}</span>
        ))}
      </div>

      {selectedBuilding && (
        <article className="campus-info-card">
          <div className="campus-info-head">
            <h3>{selectedBuilding.name}</h3>
            <button type="button" className="campus-info-close" onClick={() => setSelectedBuilding(null)}>x</button>
          </div>
          <p className="campus-info-type">{getTypeLabel(selectedBuilding.type)}</p>
          <div className="campus-info-meta">
            {typeof selectedBuilding.floors === "number" && selectedBuilding.floors > 0 && <span>Floors: {selectedBuilding.floors}</span>}
            {selectedBuilding.capacity  && <span>Capacity: {selectedBuilding.capacity}</span>}
            {selectedBuilding.area_sqft && <span>Area: {selectedBuilding.area_sqft} sqft</span>}
          </div>
          {Array.isArray(selectedBuilding.departments) && selectedBuilding.departments.length > 0 && (
            <p className="campus-info-departments">Departments: {selectedBuilding.departments.join(", ")}</p>
          )}
        </article>
      )}

      <div ref={mapNodeRef} className="campus-map-canvas" />
    </div>
  )
}

export default CampusMap



