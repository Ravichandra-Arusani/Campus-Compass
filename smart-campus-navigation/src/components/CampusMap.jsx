import { useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { campusBlueprint, campusBlueprintById } from "../data/campusBlueprint"
import { BUILDING_ENTRANCES } from "../data/buildingEntrances"
import {
  CAMPUS_GRAPH_ADJACENCY,
  CAMPUS_GRAPH_NODES,
  buildCampusGraphFromGeoJson,
  dijkstra as campusGraphDijkstra,
  snapToNearestNode,
} from "../outdoor/campusGraph"
import DestinationSearch from "./DestinationSearch"

const LANDMARK_BUILDINGS = {
  "Srujan Block": {
    image: "/images/buildings/srujan.jpg",
    subtitle: "CSE · IT · EEE · MBA — 80,000 sft"
  },
  "Avishkar Block": {
    image: "/images/buildings/avishkar.jpg",
    subtitle: "CSE(AI&ML) · CSE(DS) — 50,000 sft"
  },
  "Nirmithi Block": {
    image: "/images/buildings/nirmithi.jpg",
    subtitle: "Mechanical · CSBS — 25,000 sft"
  },
  "Prashasan Block": {
    image: "/images/buildings/prashasan.jpg",
    subtitle: "Admin · Library · Computer Centre"
  },
  "Aakash Block": {
    image: "/images/buildings/aakash.jpg",
    subtitle: "ECE · Civil · CSE(CS) — 60,000 sft"
  }
};

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
const GRAPH_SNAP_MAX_METERS = 40

const EDGE_BLOCK_SAMPLE_COUNT = 8

function isPointOnSegment(pointLng, pointLat, a, b) {
  const [aLng, aLat] = a
  const [bLng, bLat] = b
  const cross = (pointLat - aLat) * (bLng - aLng) - (pointLng - aLng) * (bLat - aLat)
  if (Math.abs(cross) > 1e-10) return false

  const minLng = Math.min(aLng, bLng) - 1e-10
  const maxLng = Math.max(aLng, bLng) + 1e-10
  const minLat = Math.min(aLat, bLat) - 1e-10
  const maxLat = Math.max(aLat, bLat) + 1e-10
  return pointLng >= minLng && pointLng <= maxLng && pointLat >= minLat && pointLat <= maxLat
}

function isPointInRing(pointLng, pointLat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lngI, latI] = ring[i]
    const [lngJ, latJ] = ring[j]
    const intersects = ((latI > pointLat) !== (latJ > pointLat))
      && (pointLng < ((lngJ - lngI) * (pointLat - latI)) / ((latJ - latI) || Number.EPSILON) + lngI)
    if (intersects) inside = !inside
  }
  return inside
}

function isPointOnRingBoundary(pointLng, pointLat, ring) {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (isPointOnSegment(pointLng, pointLat, a, b)) return true
  }
  return false
}

function isPointInsidePolygonInterior(pointLng, pointLat, polygonRings) {
  if (!Array.isArray(polygonRings) || polygonRings.length === 0) return false
  const outerRing = polygonRings[0]
  if (!Array.isArray(outerRing) || outerRing.length < 3) return false
  if (isPointOnRingBoundary(pointLng, pointLat, outerRing)) return false
  if (!isPointInRing(pointLng, pointLat, outerRing)) return false

  for (let i = 1; i < polygonRings.length; i += 1) {
    const holeRing = polygonRings[i]
    if (!Array.isArray(holeRing) || holeRing.length < 3) continue
    if (isPointOnRingBoundary(pointLng, pointLat, holeRing)) return false
    if (isPointInRing(pointLng, pointLat, holeRing)) return false
  }
  return true
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return []
  return ring
    .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    .map(([lng, lat]) => [Number(lng), Number(lat)])
}

function extractBlockedPolygons(footprintsGeojson) {
  const blockedPolygons = []
    ; (footprintsGeojson?.features || []).forEach((feature) => {
      const geometry = feature?.geometry
      if (!geometry) return

      if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
        const rings = geometry.coordinates.map((ring) => normalizeRing(ring)).filter((ring) => ring.length >= 3)
        if (rings.length > 0) blockedPolygons.push({ props: feature.properties, rings })
      }
    })
  return blockedPolygons
}

function segmentCrossesBlockedPolygon(a, b, blockedPolygons) {
  const deltaLat = b.lat - a.lat
  const deltaLng = b.lng - a.lng

  for (const poly of blockedPolygons) {
    const polygonRings = poly.rings
    let interiorPointsCount = 0
    // Use inner samples to avoid endpoints triggering false positives that just touch boundaries
    for (let i = 1; i < EDGE_BLOCK_SAMPLE_COUNT; i += 1) {
      const ratio = i / EDGE_BLOCK_SAMPLE_COUNT
      const sampleLat = a.lat + deltaLat * ratio
      const sampleLng = a.lng + deltaLng * ratio
      if (isPointInsidePolygonInterior(sampleLng, sampleLat, polygonRings)) {
        interiorPointsCount += 1
      }
    }
    // Block only if significant part of segment is inside polygon
    if (interiorPointsCount >= 2) {
      return true
    }
  }
  return false
}

function buildGraph(roadsGeojson, footprintsGeojson = null) {
  const nodes = {}
  const edges = {}
  const blockedPolygons = extractBlockedPolygons(footprintsGeojson)
  function key(lat, lng) { return `${lat.toFixed(5)}|${lng.toFixed(5)}` }
  function ensure(lat, lng) {
    const k = key(lat, lng)
    if (!nodes[k]) nodes[k] = { lat, lng }
    if (!edges[k]) edges[k] = []
    return k
  }
  console.log("Road features:", roadsGeojson.features.length)
  let removedEdges = 0
  let blockers = new Set()

  function addEdge(kA, kB) {
    if (kA === kB) return
    const a = nodes[kA]
    const b = nodes[kB]
    if (!a || !b) return
    const crossers = segmentCrossesBlockedPolygon(a, b, blockedPolygons)
    if (crossers.length > 0) {
      removedEdges++
      crossers.forEach(c => blockers.add(c))
      // return
    }
    const d = haversineM(a.lat, a.lng, b.lat, b.lng)
    if (!edges[kA].find((e) => e.to === kB)) edges[kA].push({ to: kB, dist: d })
    if (!edges[kB].find((e) => e.to === kA)) edges[kB].push({ to: kA, dist: d })
  }
  ; (roadsGeojson?.features || []).forEach((f) => {
    const coords = f.geometry.type === "LineString" ? f.geometry.coordinates : []
    let prev = null
    coords.forEach(([lng, lat]) => {
      const k = ensure(lat, lng)
      if (prev) addEdge(prev, k)
      prev = k
    })
  })
  console.log(`Removed ${removedEdges} edges. Blockers:`, Array.from(blockers))
  return { nodes, edges }
}
function snapToGraph(graph, lat, lng, maxSnapMeters = GRAPH_SNAP_MAX_METERS) {
  let bk = null
  let bd = Infinity
  Object.entries(graph.nodes).forEach(([k, n]) => {
    const d = haversineM(lat, lng, n.lat, n.lng)
    if (d < bd) {
      bd = d
      bk = k
    }
  })
  if (!bk || !Number.isFinite(bd) || bd > maxSnapMeters) return null
  return { key: bk, dist: bd }
}
function dijkstra(graph, startKey, endKey) {
  const dist = {}
  const prev = {}
  const visited = new Set()
  Object.keys(graph.nodes).forEach((k) => { dist[k] = Infinity })
  dist[startKey] = 0
  const queue = [[0, startKey]]
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0])
    const [d, u] = queue.shift()
    if (visited.has(u)) continue
    visited.add(u)
    if (u === endKey) break
    for (const { to: v, dist: w } of (graph.edges[u] || [])) {
      const nd = d + w
      if (nd < dist[v]) {
        dist[v] = nd
        prev[v] = u
        queue.push([nd, v])
      }
    }
  }
  if (dist[endKey] === Infinity) return null
  const path = []
  let cur = endKey
  while (cur) {
    const n = graph.nodes[cur]
    path.unshift([n.lat, n.lng])
    cur = prev[cur]
  }
  return path.length > 1 ? path : null
}

const VBIT_CENTER = [17.4938, 78.3908]
const CAMPUS_ENTRANCE_HINT = [17.470938, 78.723407]
const CAMPUS_BOUNDS = {
  minLat: 17.4696,
  maxLat: 17.4716,
  minLng: 78.7209,
  maxLng: 78.7238,
}
const CAMPUS_FOOTPRINTS_URL = "/data/Campus%20map.geojson"
const CAMPUS_ROADS_URL = "/data/Roads.geojson"
const CAMPUS_BASEMAP_URL = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
const FOOTPRINT_HOVER_FILL_OPACITY = 0.52
const EARTH_RADIUS_M = 6371000
const GEOJSON_CACHE_BUSTER = Date.now() + 10000
const GRAPH_CACHE_KEYS = [
  "smart-campus-navigation:graph-cache:v1",
  "cachedGraph",
  "graph",
  "nodes",
  "adjacency",
]

const OUTDOOR_DESTINATIONS = [
  { id: "nirmithi_block", name: "Nirmithi Block" },
  { id: "srujan_block", name: "Srujan Block" },
  { id: "aakash_block", name: "Aakash Block" },
  { id: "avishkar_block", name: "Avishkar Block" },
  { id: "pratham_block", name: "Pratham Block" },
  { id: "prathibha_block", name: "Prathibha Block" },
  { id: "new_block", name: "New Block" },
  { id: "library", name: "Library" },
  { id: "nalanda_hall", name: "Nalanda Auditorium" },
  { id: "boys_hostel", name: "Boys Hostel" },
  { id: "girls_hostel", name: "Girls Hostel" },
  { id: "vbit_parking", name: "VBIT Parking" },
  { id: "vbit_ground", name: "VBIT Ground" },
  { id: "canteen", name: "Canteen" },
]

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function toCampusId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

const LEGACY_ID_ALIASES = {
  aaskash: "aakash_block",
  avishkar: "avishkar_block",
  boy_s_hostel: "boys_hostel",
  girl_s_hostel: "girls_hostel",
  ground: "vbit_ground",
  library_administrative_block: "library",
  nalanda_block: "nalanda_hall",
  parking: "vbit_parking",
  prathibha: "prathibha_block",
  pratham: "pratham_block",
  srujun_block: "srujan_block",
}

const TYPE_TO_CATEGORY = {
  academic: "Academic",
  service: "Service",
  hostel: "Hostel",
  ground: "Ground",
  parking: "Parking",
}

const CATEGORY_TO_TYPE = {
  academic: "academic",
  service: "service",
  hostel: "hostel",
  ground: "ground",
  parking: "parking",
}

function toCanonicalCampusId(value) {
  const normalized = toCampusId(value)
  return LEGACY_ID_ALIASES[normalized] || normalized
}

function extractFeatureName(properties = {}) {
  const directName = String(properties?.name || "").trim()
  if (directName) {
    return directName
  }

  const ignoredKeys = new Set([
    "id",
    "type",
    "category",
    "floors",
    "area_sqft",
    "capacity",
    "departments",
    "entrance",
  ])

  const dynamicNameKey = Object.keys(properties).find((key) => !ignoredKeys.has(key))
  return String(dynamicNameKey || "").trim()
}

function resolveCategory(type, category) {
  const explicitCategory = String(category || "").trim()
  if (explicitCategory) {
    return explicitCategory
  }

  return TYPE_TO_CATEGORY[String(type || "").toLowerCase()] || "Academic"
}

function resolveCampusProperties(properties = {}) {
  const inferredName = extractFeatureName(properties)
  const featureId = toCanonicalCampusId(properties.id || inferredName || properties.name)
  const blueprintEntry = campusBlueprintById[featureId]
  const resolvedType =
    String(blueprintEntry?.type || properties.type || CATEGORY_TO_TYPE[toCampusId(properties.category)] || "")
      .toLowerCase() || "academic"
  const resolvedName =
    inferredName ||
    String(properties.name || "").trim() ||
    String(blueprintEntry?.name || "").trim() ||
    featureId

  return {
    ...properties,
    ...(blueprintEntry || {}),
    id: blueprintEntry?.id || featureId || properties.id || "",
    name: resolvedName,
    type: resolvedType,
    category: resolveCategory(resolvedType, properties.category),
  }
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
  if (type === "service") return "Service Block"
  if (type === "hostel") return "Hostel"
  if (type === "ground") return "Ground / Sports"
  if (type === "parking") return "Parking"
  return "Campus Block"
}

function getFootprintStyle(feature) {
  const type = feature?.properties?.type
  if (type === "hostel") return { color: "#3b82f6", weight: 2, fillColor: "#1d4ed8", fillOpacity: 0.3 }
  if (type === "parking") return { color: "#ff7a1a", weight: 2, dashArray: "4 4", fillColor: "#ff7a1a", fillOpacity: 0.1 }
  if (type === "ground") return { color: "#2ecc71", weight: 2, fillColor: "#2ecc71", fillOpacity: 0.17 }
  return { color: "#ff7a1a", weight: 2, fillColor: "#111111", fillOpacity: 0.17 }
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

function withCacheBuster(url) {
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}v=${GEOJSON_CACHE_BUSTER}`
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

function resolveDestinationCoordinate(destinationId) {
  const snapped = BUILDING_ENTRANCES[destinationId]
  if (Array.isArray(snapped) && Number.isFinite(snapped[0]) && Number.isFinite(snapped[1])) {
    return snapped
  }

  const blueprintEntrance = campusBlueprintById[destinationId]?.entrance
  if (
    Array.isArray(blueprintEntrance) &&
    Number.isFinite(blueprintEntrance[0]) &&
    Number.isFinite(blueprintEntrance[1])
  ) {
    return blueprintEntrance
  }

  return null
}

function CampusMap({ onHandoffToIndoor }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const userMarkerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const routeRequestRef = useRef(null)
  const destMarkerRef = useRef(null)
  const campusFootprintLayerRef = useRef(null)
  const hasCenteredOnUserRef = useRef(false)
  const hasGpsFixRef = useRef(false)
  const simpleGraphRef = useRef(null)

  const [userLocation, setUserLocation] = useState(null)
  const [userLocationLabel, setUserLocationLabel] = useState(
    typeof navigator !== "undefined" && navigator.geolocation
      ? "Locating..."
      : "GPS unavailable - enable location access to route from your position"
  )
  const [selectedDest, setSelectedDest] = useState("")
  const [outdoorPath, setOutdoorPath] = useState([])
  const [selectedBuilding, setSelectedBuilding] = useState(null)
  const [campusGraph, setCampusGraph] = useState({})
  const [error, setError] = useState("")

  const campusSummary = useMemo(() => {
    const counts = campusBlueprint.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1; return acc
    }, {})
    return [
      { id: "academic", label: "Academic", count: counts.academic || 0 },
      { id: "service", label: "Service", count: counts.service || 0 },
      { id: "hostel", label: "Hostel", count: counts.hostel || 0 },
      { id: "ground", label: "Ground", count: counts.ground || 0 },
      { id: "parking", label: "Parking", count: counts.parking || 0 },
    ].filter((e) => e.count > 0)
  }, [])

  const outdoorDestinationOptions = useMemo(
    () => OUTDOOR_DESTINATIONS
      .filter((d) => Boolean(campusGraph[d.id]))
      .map((d) => ({ id: d.id, label: d.name })),
    [campusGraph]
  )

  // Map initialization
  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined

    if (typeof window !== "undefined" && window.localStorage) {
      GRAPH_CACHE_KEYS.forEach((storageKey) => {
        window.localStorage.removeItem(storageKey)
      })
    }

    const map = L.map(mapNodeRef.current, {
      scrollWheelZoom: true,
      dragging: true,
      zoomControl: false,
    }).setView(VBIT_CENTER, 17)
    mapRef.current = map
    if (typeof window !== "undefined") {
      window._leafletMap = map
      console.log("Map initialized at:", map.getCenter(), "zoom:", map.getZoom())
      window._userLocation = null
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const userLatLng = [pos.coords.latitude, pos.coords.longitude]
          if (typeof window !== "undefined") {
            window._userLocation = userLatLng
          }
          console.log("User GPS:", userLatLng)
          setUserLocation(userLatLng)
          setUserLocationLabel("You are here")

          if (typeof window !== "undefined" && window._leafletMap) {
            if (!userMarkerRef.current) {
              userMarkerRef.current = L.circleMarker(userLatLng, {
                radius: 8, color: "#3b82f6", weight: 3,
                fillColor: "#93c5fd", fillOpacity: 1,
              }).addTo(window._leafletMap).bindPopup("You are here")
            } else {
              userMarkerRef.current.setLatLng(userLatLng)
              userMarkerRef.current.setPopupContent("You are here")
            }
          }
        },
        (err) => {
          console.warn("GPS unavailable:", err.message)
          if (typeof window !== "undefined") {
            window._userLocation = null
          }
        },
        { enableHighAccuracy: true }
      )
    }

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
      div.querySelector(".zoom-in").onclick = () => map.zoomIn()
      div.querySelector(".zoom-out").onclick = () => map.zoomOut()
      return div
    }
    zoomControl.addTo(map)

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

        campusFootprintLayerRef.current = L.geoJSON(data, {
          style: getFootprintStyle,
          onEachFeature: (feature, layer) => {
            const props = resolveCampusProperties(feature?.properties)
            const name = props?.name
            const baseStyle = getFootprintStyle({ properties: props })
            if (name) {
              if (LANDMARK_BUILDINGS[name]) {
                const info = LANDMARK_BUILDINGS[name];
                layer.bindTooltip(`
                  <div style="
                    width: 220px;
                    border-radius: 10px;
                    overflow: hidden;
                    font-family: Arial, sans-serif;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                    background: #fff;
                  ">
                    <img
                      src="${info.image}"
                      alt="${name}"
                      style="width:100%; height:120px; object-fit:cover; display:block;"
                      onerror="this.style.display='none'"
                    />
                    <div style="padding: 10px 12px 12px;">
                      <div style="font-weight:700; font-size:13px; color:#1A3C5E;">
                        ${name}
                      </div>
                      <div style="font-size:11px; color:#666; margin-top:4px;">
                        ${info.subtitle}
                      </div>
                    </div>
                  </div>
                `, {
                  direction: 'top',
                  offset: [0, -10],
                  opacity: 1,
                  className: 'building-photo-tooltip'
                });
              } else {
                layer.bindTooltip(name, {
                  permanent: false,
                  direction: "top",
                  className: "campus-footprint-label",
                  opacity: 0.92,
                })
              }
              layer.bindPopup(name)
            }
            layer.on("mouseover", () =>
              layer.setStyle({
                fillOpacity: FOOTPRINT_HOVER_FILL_OPACITY,
                weight: (baseStyle.weight || 2) + 2,
              })
            )
            layer.on("mouseout", () =>
              layer.setStyle({
                fillOpacity: baseStyle.fillOpacity,
                weight: baseStyle.weight || 2,
              })
            )
            layer.on("click", () => setSelectedBuilding(props))
          },
        }).addTo(map)

        const graph = buildCampusGraphFromGeoJson(data, roadData)
        setCampusGraph(graph)
        simpleGraphRef.current = roadData
          ? { nodes: CAMPUS_GRAPH_NODES, adjacency: CAMPUS_GRAPH_ADJACENCY }
          : null

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
      if (typeof window !== "undefined" && window._routeLayer) {
        window._routeLayer.remove()
        window._routeLayer = null
      }
      if (typeof window !== "undefined" && window._gpsConnectorLayer) {
        window._gpsConnectorLayer.remove()
        window._gpsConnectorLayer = null
      }
      if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }
      if (campusFootprintLayerRef.current) { campusFootprintLayerRef.current.remove(); campusFootprintLayerRef.current = null }
      simpleGraphRef.current = null
      map.remove()
      mapRef.current = null
      if (typeof window !== "undefined" && window._leafletMap === map) {
        window._leafletMap = null
        window._userLocation = null
      }
    }
  }, [])

  // GPS: watch user position
  useEffect(() => {
    if (!navigator.geolocation) {
      if (typeof window !== "undefined") {
        window._userLocation = null
      }
      if (!hasCenteredOnUserRef.current && mapRef.current) {
        mapRef.current.setView(VBIT_CENTER, 17)
        hasCenteredOnUserRef.current = true
      }
      return undefined
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const { latitude, longitude, accuracy } = coords
        const currentLocation = [latitude, longitude]
        if (typeof window !== "undefined") {
          window._userLocation = currentLocation
        }
        console.log("User GPS:", currentLocation)
        hasGpsFixRef.current = true
        setUserLocation(currentLocation)
        setUserLocationLabel(`Your location (+/-${Math.round(accuracy)}m)`)
        if (!hasCenteredOnUserRef.current && mapRef.current) {
          mapRef.current.setView([latitude, longitude], 18)
          hasCenteredOnUserRef.current = true
        }
      },
      (geoError) => {
        if (typeof window !== "undefined") {
          window._userLocation = null
        }
        const errorMessage = resolveGeolocationErrorMessage(geoError)
        if (hasGpsFixRef.current) {
          setUserLocationLabel(`${errorMessage} - using last known location`)
        } else {
          setUserLocationLabel(`${errorMessage} - enable location access to begin routing`)
        }
        if (!hasCenteredOnUserRef.current && mapRef.current && !hasGpsFixRef.current) {
          mapRef.current.setView(VBIT_CENTER, 17)
          hasCenteredOnUserRef.current = true
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  // Draw / update user marker
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

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("smart-nav:route-state", {
        detail: { active: outdoorPath.length > 0 },
      })
    )
  }, [outdoorPath])

  async function getHybridRoute(startLat, startLng, endLat, endLng, destinationId, abortSignal) {
    const graph = simpleGraphRef.current
    if (!graph) throw new Error("Campus path network is not available.")
    const directedEdgeCount = Object.values(graph.adjacency || {}).reduce(
      (total, neighbors) => total + (Array.isArray(neighbors) ? neighbors.length : 0),
      0
    )

    console.log("[Route Debug] Building route from Entrance to", destinationId)
    console.log("[Route Debug] Graph size: Nodes=", Object.keys(graph.nodes).length, "DirectedEdges=", directedEdgeCount)
    console.log("[Route Debug] Start coords:", startLat, startLng)
    console.log("[Route Debug] End coords (Dest):", endLat, endLng)

    const destSnap = snapToNearestNode(endLat, endLng, graph, GRAPH_SNAP_MAX_METERS)
    console.log("[Route Debug] Destination snap result:", destSnap)
    if (!destSnap?.key) throw new Error("Destination not reachable.")

    const inside = startLat >= CAMPUS_BOUNDS.minLat && startLat <= CAMPUS_BOUNDS.maxLat &&
      startLng >= CAMPUS_BOUNDS.minLng && startLng <= CAMPUS_BOUNDS.maxLng

    let connectorStart = [], graphPath = []

    if (!inside) {
      const eSnap = snapToNearestNode(
        CAMPUS_ENTRANCE_HINT[0],
        CAMPUS_ENTRANCE_HINT[1],
        graph,
        GRAPH_SNAP_MAX_METERS
      )
      console.log("[Route Debug] Entrance snap result:", eSnap)
      if (!eSnap?.key) throw new Error("Campus entrance is not connected to the road graph.")
      const eNode = graph.nodes[eSnap.key]
      try {
        const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${eNode.lng},${eNode.lat}?overview=full&geometries=geojson`
        const res = await fetch(url, { signal: abortSignal })
        const data = await res.json()
        const coords = data?.routes?.[0]?.geometry?.coordinates
        connectorStart = coords?.length ? coords.map(([lng, lat]) => [lat, lng]) : [[startLat, startLng], [eNode.lat, eNode.lng]]
      } catch (err) {
        if (err?.name === "AbortError") throw err
        connectorStart = [[startLat, startLng], [eNode.lat, eNode.lng]]
      }
      graphPath = campusGraphDijkstra(eSnap.key, destSnap.key, graph) || []
      console.log("Path length:", graphPath.length)
      console.log("First 3 coords:", graphPath.slice(0, 3))
      console.log("[Route Debug] Dijkstra path length:", graphPath.length)
      if (graphPath.length < 2) throw new Error("No campus path found from entrance to destination.")
    } else {
      const startSnap = snapToNearestNode(startLat, startLng, graph, 80)
      console.log("[Route Debug] Start snap result:", startSnap)
      const effectiveStartSnap = startSnap?.key
        ? startSnap
        : snapToNearestNode(
          startLat,
          startLng,
          graph,
          150
        )
      if (!effectiveStartSnap?.key) throw new Error("Current location is too far from the road graph.")
      graphPath = campusGraphDijkstra(effectiveStartSnap.key, destSnap.key, graph) || []
      console.log("Path length:", graphPath.length)
      console.log("First 3 coords:", graphPath.slice(0, 3))
      console.log("[Route Debug] Dijkstra path length:", graphPath.length)
      if (graphPath.length < 2) throw new Error("No campus path found to destination.")
    }

    // Append the actual destination coordinate as the final segment so the
    // route line always reaches the building entrance, not just the nearest
    // road node.
    const lastGraphCoord = graphPath[graphPath.length - 1]
    const destCoord = [endLat, endLng]
    const lastIsExact =
      Array.isArray(lastGraphCoord) &&
      Math.abs(lastGraphCoord[0] - endLat) < 0.000015 &&
      Math.abs(lastGraphCoord[1] - endLng) < 0.000015
    const tailSegment = lastIsExact ? [] : [destCoord]

    const fullPath = [...connectorStart, ...graphPath, ...tailSegment]
    console.log("Full path coords:", fullPath.map((c) => c))
    console.log("Full path coords JSON:", JSON.stringify(fullPath))
    return { fullPath, graphPath, connectorStart }
  }
  // Routing
  // Route from the campus main entrance to the selected destination.
  async function handleRoute() {
    setError("")
    if (!selectedDest) { setError("Select a destination."); return }
    if (!campusGraph[selectedDest]) { setError("Destination not in map."); return }

    const map = mapRef.current
    if (!map) { setError("Map is not ready yet."); return }

    const globalStart =
      typeof window !== "undefined" &&
        Array.isArray(window._userLocation) &&
        Number.isFinite(window._userLocation[0]) &&
        Number.isFinite(window._userLocation[1])
        ? window._userLocation
        : null
    const startCoords = globalStart || userLocation || CAMPUS_ENTRANCE_HINT
    console.log("Routing from:", startCoords)
    const [startLat, startLng] = startCoords
    const destNode = campusGraph[selectedDest]
    const destinationCoordinate =
      resolveDestinationCoordinate(selectedDest) ||
      (Number.isFinite(destNode?.x) && Number.isFinite(destNode?.y)
        ? [destNode.x, destNode.y]
        : null)
    if (!Array.isArray(destinationCoordinate)) {
      setError("Destination coordinates are unavailable.")
      return
    }
    const [endLat, endLng] = destinationCoordinate

    if (!Number.isFinite(endLat) || !Number.isFinite(endLng)) {
      setError("Destination coordinates are unavailable.")
      return
    }

    if (userLocation && distanceMeters(userLocation[0], userLocation[1], endLat, endLng) <= 8) {
      setError("You are already there!")
      return
    }

    if (routeRequestRef.current) {
      routeRequestRef.current.abort()
      routeRequestRef.current = null
    }
    const controller = new AbortController()
    routeRequestRef.current = controller

    if (routeLayerRef.current) { routeLayerRef.current.remove(); routeLayerRef.current = null }
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }
    if (typeof window !== "undefined" && window._gpsConnectorLayer) {
      window._gpsConnectorLayer.remove()
      window._gpsConnectorLayer = null
    }
    setOutdoorPath([])

    try {
      const routeSegments = await getHybridRoute(
        startLat,
        startLng,
        endLat,
        endLng,
        selectedDest,
        controller.signal
      )
      console.log(`Route successfully calculated to ${selectedDest}. Path length: ${routeSegments?.fullPath?.length} nodes.`, routeSegments)
      const routeLatLngs = routeSegments?.fullPath || []
      if (!routeLatLngs.length) {
        setError("No route found for this destination.")
        return
      }

      setOutdoorPath(routeLatLngs)
      console.log("Route state set with:", routeLatLngs.length, "points")
      if (typeof window !== "undefined" && window._routeLayer) {
        window._routeLayer.remove()
      }
      const fullPath = routeSegments.fullPath?.map((c) =>
        Array.isArray(c) ? c : [c.lat, c.lng]
      ) || []
      console.log("connectorStart:", JSON.stringify(routeSegments.connectorStart))
      console.log("graphPath:", JSON.stringify(routeSegments.graphPath))
      console.log("fullPath final:", JSON.stringify(fullPath))
      console.log("Drawing polyline with coords:", fullPath)
      const drawMap = (typeof window !== "undefined" && window._leafletMap) ? window._leafletMap : map
      const newRouteLayer = L.polyline(fullPath, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.85,
      }).addTo(drawMap)
      if (typeof window !== "undefined") {
        window._routeLayer = newRouteLayer
        if (newRouteLayer.getBounds().isValid()) {
          drawMap.fitBounds(newRouteLayer.getBounds(), { padding: [60, 60] })
          console.log("fitBounds called:", newRouteLayer.getBounds().toString())
        } else {
          console.log("Bounds invalid - polyline may be off screen")
        }
      }
      routeLayerRef.current = newRouteLayer

      if (
        typeof window !== "undefined" &&
        Array.isArray(window._userLocation) &&
        Array.isArray(routeSegments?.graphPath) &&
        routeSegments.graphPath.length > 0 &&
        (!Array.isArray(routeSegments.connectorStart) || routeSegments.connectorStart.length === 0)
      ) {
        const snappedStart = routeSegments.graphPath[0]
        if (
          Array.isArray(snappedStart) &&
          Number.isFinite(snappedStart[0]) &&
          Number.isFinite(snappedStart[1])
        ) {
          window._gpsConnectorLayer = L.polyline(
            [window._userLocation, snappedStart],
            { color: "#3b82f6", weight: 3, dashArray: "6,8", opacity: 0.7 }
          ).addTo(drawMap)
        }
      }

      destMarkerRef.current = L.circleMarker([endLat, endLng], {
        radius: 10, color: "#f59e0b", weight: 3,
        fillColor: "#fbbf24", fillOpacity: 1,
      }).addTo(drawMap).bindPopup(destNode.label || selectedDest)

      routeLayerRef.current.bringToFront()
      userMarkerRef.current?.bringToFront()
    } catch (routeError) {
      if (routeError?.name === "AbortError") {
        return
      }
      console.error("Routing failed:", routeError)
      setOutdoorPath([])
      setError(routeError?.message || "Routing failed. Please try again.")
    } finally {
      if (routeRequestRef.current === controller) {
        routeRequestRef.current = null
      }
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
            {selectedBuilding.capacity && <span>Capacity: {selectedBuilding.capacity}</span>}
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
