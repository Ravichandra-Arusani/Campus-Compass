import { useEffect, useMemo, useRef, useState } from "react"
import bezierSpline from "@turf/bezier-spline"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import booleanPointInPolygon from "@turf/boolean-point-in-polygon"
import { campusBlueprint, campusBlueprintById } from "../data/campusBlueprint"
import { BUILDING_ENTRANCES } from "../data/buildingEntrances"
import {
  buildSimpleGraph,
  buildCampusGraphFromGeoJson,
  dijkstra as campusGraphDijkstra,
  snapToNearestNode,
} from "../outdoor/campusGraph"
import DestinationSearch from "./DestinationSearch"
import apiClient from "../services/apiClient"

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

const GRAPH_SNAP_MAX_METERS = 150

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

// Removed Leaflet Icons

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

/**
 * Returns the canonical campus ID of the building polygon that contains the
 * given GPS point, or null if the point is not inside any polygon.
 */
function detectBuildingContainingPoint(lat, lng, geoJsonFeatures) {
  if (!Array.isArray(geoJsonFeatures) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }
  const pt = { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] } }
  for (const feature of geoJsonFeatures) {
    const geomType = feature?.geometry?.type
    if (geomType !== "Polygon" && geomType !== "MultiPolygon") continue
    try {
      if (booleanPointInPolygon(pt, feature)) {
        const rawId = feature?.properties?.id || feature?.properties?.name || ""
        return String(rawId).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
      }
    } catch {
      // skip malformed polygons
    }
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
  const campusGeoJsonFeaturesRef = useRef([])

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
  // { buildingId, buildingName } when awaiting user confirmation, null otherwise
  const [buildingConfirm, setBuildingConfirm] = useState(null)
  const pendingRouteRef = useRef(null)

  // NEW UPGRADE STATES
  const [is3dMode, setIs3dMode] = useState(false)
  const [activeBuildingRooms, setActiveBuildingRooms] = useState(null)
  const [allRooms, setAllRooms] = useState([])
  const [campusNodes, setCampusNodes] = useState([])
  const [routeSteps, setRouteSteps] = useState([])
  const allRoomsRef = useRef([])

  // Fetch rooms and nodes on mount for the classroom-aware routing
  useEffect(() => {
    apiClient.get("/availability/all/").then(res => {
      setAllRooms(res.data || [])
      allRoomsRef.current = res.data || []
    }).catch(console.error)
    apiClient.get("/nodes/").then(res => setCampusNodes(res.data || [])).catch(console.error)
  }, [])

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
      GRAPH_CACHE_KEYS.forEach((storageKey) => window.localStorage.removeItem(storageKey))
    }

    // DEV ONLY — simulate being on campus
    // Remove this before deploying to production
    if (import.meta.env.DEV) {
      window._userLocation = [17.470998, 78.723508]
    }

    let map = null;
    try {
      map = new maplibregl.Map({
        container: mapNodeRef.current,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [78.7237, 17.4709],
        zoom: 16,
        minZoom: 10,
        pitch: 30,
        bearing: -20,
        antialias: true  // ← enables smooth 3D building edges
      })
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enable();
      map.scrollZoom.enable();

      // Prevent map scroll from bleeding into the page
      if (mapNodeRef.current) {
        mapNodeRef.current.addEventListener('wheel', (e) => {
          e.stopPropagation();
          e.preventDefault();
        }, { passive: false });
      }

      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      map.touchPitch.enable(); // allows two-finger tilt on mobile
    } catch (err) {
      console.error('Map init failed:', err)
      return undefined
    }
    mapRef.current = map
    if (typeof window !== "undefined") {
      window._mapLibreMap = map
      window._userLocation = null
    }

    map.addControl(new maplibregl.NavigationControl(), 'top-left')

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const userLatLng = [pos.coords.latitude, pos.coords.longitude]
          if (typeof window !== "undefined") window._userLocation = userLatLng
          setUserLocation(userLatLng)
          setUserLocationLabel("You are here")
        },
        (err) => console.warn("GPS unavailable:", err.message),
        { enableHighAccuracy: true }
      )
    }

    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "campus-footprint-label",
      offset: [0, -10]
    })

    const ac = new AbortController()
    map.on('load', async () => {
      // Hide the basemap's built-in building layers to prevent clashing
      const style = map.getStyle();
      if (style && style.layers) {
        style.layers.forEach(layer => {
          if (
            layer.id.includes('building') ||
            layer.id.includes('3d') ||
            layer.type === 'fill-extrusion'
          ) {
            if (layer.id !== 'campus-extrusion') {
              map.setLayoutProperty(layer.id, 'visibility', 'none');
            }
          }
        });
      }


      try {
        const [footprintsResponse, roadsResponse] = await Promise.all([
          fetch(withCacheBuster(CAMPUS_FOOTPRINTS_URL), { signal: ac.signal }),
          fetch(withCacheBuster(CAMPUS_ROADS_URL), { signal: ac.signal }).catch(() => null),
        ])
        const raw = await footprintsResponse.json()
        if (ac.signal.aborted || !mapRef.current) return

        const data = enrichGeoJsonWithCampusMetadata(raw)
        let roadData = null
        if (roadsResponse?.ok) roadData = await roadsResponse.json()

        map.addSource('campus', { type: 'geojson', data })

        map.addLayer({
          id: 'campus-extrusion',
          source: 'campus',
          type: 'fill-extrusion',
          paint: {
            'fill-extrusion-color': [
              'match', ['get', 'type'],
              'academic', '#2563a8',   // blue for academic
              'service', '#0d9488',   // teal for service
              'hostel', '#d97706',   // amber for hostel
              'ground', '#16a34a',   // green for grounds/open areas
              'parking', '#7c3aed',   // purple for parking
              '#444444'                // fallback
            ],
            'fill-extrusion-height': [
              'match', ['get', 'type'],
              'academic', 20,   // tallest — multi-floor blocks
              'service', 16,
              'hostel', 18,
              'ground', 0.5,  // ← almost flat, just a surface
              'parking', 4,
              12                // default
            ],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.85
          }
        })

        const popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 15
        });

        map.on('mouseenter', 'campus-extrusion', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const { name, category } = e.features[0].properties;
          popup.setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-weight:600;font-size:13px;color:#EF9F27;margin-bottom:2px">${name}</div>
              <div style="font-size:11px;color:#aaa">${category}</div>
            `)
            .addTo(map);
        });

        map.on('mouseleave', 'campus-extrusion', () => {
          map.getCanvas().style.cursor = '';
          popup.remove();
        });

        map.addLayer({
          id: 'campus-fill',
          source: 'campus',
          type: 'fill',
          paint: { 'fill-color': 'transparent' }
        })

        map.addSource('route', { type: 'geojson', data: { type: "FeatureCollection", features: [] } })
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ff7a1a',
            'line-width': 5,
            'line-blur': 0.5,
            'line-opacity': 0.9
          }
        })

        map.on('mousemove', 'campus-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer'
          const feature = e.features[0]
          const props = feature.properties
          const name = props.name || feature.id
          if (name) {
            hoverPopup.setLngLat(e.lngLat).setHTML(`
               <div class="building-popup">
                 <img src="/images/${props.id}.jpg" 
                      onerror="this.src='/images/default-building.jpg'"
                      style="width:180px;height:100px;object-fit:cover;border-radius:6px;"/>
                 <div class="popup-name">${name}</div>
                 <div class="popup-type">${props.type} Block</div>
               </div>
             `).addTo(map)
          }
        })

        map.on('mouseleave', 'campus-fill', () => {
          map.getCanvas().style.cursor = ''
          hoverPopup.remove()
        })

        map.on('click', 'campus-fill', (e) => {
          const props = e.features[0].properties
          setSelectedBuilding(props)
          const name = props.name || ""
          const bRooms = allRoomsRef.current.filter(r => r.building.toLowerCase().includes(name.split(" ")[0].toLowerCase()))
          if (bRooms.length > 0) setActiveBuildingRooms({ name, rooms: bRooms })
          else setActiveBuildingRooms(null)
        })

        const graph = buildCampusGraphFromGeoJson(data, roadData)
        setCampusGraph(graph)
        campusGeoJsonFeaturesRef.current = Array.isArray(data?.features) ? data.features : []
        simpleGraphRef.current = roadData ? buildSimpleGraph(roadData) : null

      } catch (e) {
        if (e.name !== "AbortError") console.error("Load error:", e)
      }
    })

    return () => {
      ac.abort()
      if (routeRequestRef.current) routeRequestRef.current.abort()
      if (typeof window !== "undefined") window._mapLibreMap = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Draw / update user marker (NEW pulsing CSS marker)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !userLocation) return

    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.className = 'gps-pulse-marker'
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userLocation[1], userLocation[0]])
        .addTo(map)
    } else {
      userMarkerRef.current.setLngLat([userLocation[1], userLocation[0]])
    }
  }, [userLocation])

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

    let connectorStart = [], graphPath = []

    // Point-in-polygon check: if the user's GPS is inside a building polygon,
    // use that building's registered entrance as the route start to avoid
    // snapping to a distant road node near a different building.
    let effectiveStartLat = startLat
    let effectiveStartLng = startLng
    const containingBuildingId = detectBuildingContainingPoint(
      startLat, startLng, campusGeoJsonFeaturesRef.current
    )
    console.log("[Route Debug] Point-in-polygon building:", containingBuildingId)
    if (containingBuildingId && containingBuildingId !== destinationId) {
      const entrance = BUILDING_ENTRANCES[containingBuildingId]
      if (Array.isArray(entrance) && Number.isFinite(entrance[0]) && Number.isFinite(entrance[1])) {
        effectiveStartLat = entrance[0]
        effectiveStartLng = entrance[1]
        console.log("[Route Debug] Using building entrance as start:", containingBuildingId, entrance)
      }
    }

    // Debug: log what we're snapping from and what nodes look like
    console.log("[Snap Debug] Snapping from:", effectiveStartLat, effectiveStartLng)
    console.log("[Snap Debug] Sample node:", Object.entries(graph.nodes)[0])

    // Try snap as [lat, lng] first, then [lng, lat] if that fails
    let startSnap = snapToNearestNode(effectiveStartLat, effectiveStartLng, graph, GRAPH_SNAP_MAX_METERS)
    if (!startSnap?.key) {
      // Coords might be swapped — try the other orientation
      console.warn("[Snap Debug] First snap failed, trying swapped coords")
      startSnap = snapToNearestNode(effectiveStartLng, effectiveStartLat, graph, GRAPH_SNAP_MAX_METERS)
    }
    // Last resort — massively increase radius to find ANY node
    if (!startSnap?.key) {
      console.warn("[Snap Debug] Both failed, using 5000m radius fallback")
      startSnap = snapToNearestNode(effectiveStartLat, effectiveStartLng, graph, 5000)
    }
    console.log("[Snap Debug] Final snap result:", startSnap)


    if (!startSnap?.key) {
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
      graphPath = campusGraphDijkstra(startSnap.key, destSnap.key, graph) || []
      console.log("Path length:", graphPath.length)
      console.log("First 3 coords:", graphPath.slice(0, 3))
      console.log("[Route Debug] Dijkstra path length:", graphPath.length)
      if (graphPath.length < 2) throw new Error("No campus path found to destination.")

      // Prepend the real user GPS so the drawn line begins exactly where
      // the user is standing, not at the snapped road node.
      const firstGraphCoord = graphPath[0]
      const firstIsExact =
        Array.isArray(firstGraphCoord) &&
        Math.abs(firstGraphCoord[0] - startLat) < 0.000015 &&
        Math.abs(firstGraphCoord[1] - startLng) < 0.000015
      connectorStart = firstIsExact ? [] : [[startLat, startLng]]
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
  async function handleRoute(overrideStartLat, overrideStartLng) {
    setError("")
    setBuildingConfirm(null)
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
    const startCoords = globalStart || userLocation
    if (!startCoords) {
      setError("Waiting for your GPS location...")
      return
    }

    const [startLat, startLng] = typeof overrideStartLat === "number"
      ? [overrideStartLat, overrideStartLng]
      : startCoords

    // If no override, check point-in-polygon and ask for confirmation first.
    if (typeof overrideStartLat !== "number") {
      const detectedId = detectBuildingContainingPoint(
        startLat, startLng, campusGeoJsonFeaturesRef.current
      )
      console.log("[Confirm] Detected building:", detectedId)
      if (detectedId && detectedId !== selectedDest) {
        const blueprint = campusBlueprint.find((b) => b.id === detectedId)
        const buildingName = blueprint?.name ||
          detectedId.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
        pendingRouteRef.current = { startLat, startLng, detectedId }
        setBuildingConfirm({ buildingId: detectedId, buildingName })
        return
      }
    }
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

    if (routeLayerRef.current) { clearInterval(routeLayerRef.current); routeLayerRef.current = null }
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }
    if (typeof window !== "undefined" && window._gpsConnectorLayer) {
      clearInterval(window._gpsConnectorLayer)
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
      const drawMap = mapRef.current

      const rawMaplibreCoords = fullPath.map((c) => [c[1], c[0]])
      let smoothedPath = rawMaplibreCoords
      if (smoothedPath.length >= 3) {
        try {
          const lineFeature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: smoothedPath }
          }
          const curved = bezierSpline(lineFeature, { resolution: 10000, sharpness: 0.85 })
          smoothedPath = curved.geometry.coordinates
        } catch (e) {
          console.warn("Spline fallback", e)
        }
      }

      let currentPoint = 0
      const animatedCoords = []

      if (drawMap.getSource('route')) {
        drawMap.getSource('route').setData({ type: "FeatureCollection", features: [] })
      }

      const drawInterval = setInterval(() => {
        if (!mapRef.current || currentPoint >= smoothedPath.length) {
          clearInterval(drawInterval)
          if (smoothedPath.length > 0) {
            const bounds = new maplibregl.LngLatBounds(
              smoothedPath[0],
              smoothedPath[0]
            )
            smoothedPath.forEach(c => bounds.extend(c))
            drawMap.fitBounds(bounds, { padding: 60 })
          }
          return
        }
        animatedCoords.push(smoothedPath[currentPoint])
        if (drawMap.getSource('route')) {
          drawMap.getSource('route').setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: animatedCoords }
          })
        }
        currentPoint++
      }, 1500 / Math.max(smoothedPath.length, 1))

      routeLayerRef.current = drawInterval // save interval to clear it later if needed

      if (window._movingDot) window._movingDot.remove()
      const dotEl = document.createElement('div')
      dotEl.className = 'moving-route-dot'
      window._movingDot = new maplibregl.Marker({ element: dotEl })
        .setLngLat([fullPath[0][1], fullPath[0][0]])
        .addTo(drawMap)

      let dotIndex = 0
      const dotInterval = setInterval(() => {
        if (!window._movingDot || dotIndex >= fullPath.length) {
          clearInterval(dotInterval)
          if (window._movingDot) window._movingDot.remove()
          return
        }
        window._movingDot.setLngLat([fullPath[dotIndex][1], fullPath[dotIndex][0]])
        dotIndex++
      }, 2500 / Math.max(fullPath.length, 1))

      window._gpsConnectorLayer = dotInterval // attach to clear it on new route

      if (destMarkerRef.current) destMarkerRef.current.remove()
      const destEl = document.createElement('div')
      destEl.style.width = '20px'
      destEl.style.height = '20px'
      destEl.style.background = '#fbbf24'
      destEl.style.border = '2px solid #f59e0b'
      destEl.style.borderRadius = '50%'
      destEl.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.8)'

      destMarkerRef.current = new maplibregl.Marker({ element: destEl })
        .setLngLat([endLng, endLat])
        .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>${destNode.label || selectedDest}</strong>`))
        .addTo(drawMap)
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



  function handleBuildingConfirmYes() {
    const pending = pendingRouteRef.current
    if (!pending) return
    const entrance = BUILDING_ENTRANCES[pending.detectedId]
    if (Array.isArray(entrance) && Number.isFinite(entrance[0]) && Number.isFinite(entrance[1])) {
      handleRoute(entrance[0], entrance[1])
    } else {
      // No entrance registered — fall back to raw GPS
      handleRoute(pending.startLat, pending.startLng)
    }
    pendingRouteRef.current = null
    setBuildingConfirm(null)
  }

  // NEW: Classroom-aware routing directly over API
  async function handleRoomRoute(roomId) {
    setError("")
    setRouteSteps([])
    if (!userLocation) { setError("Waiting for GPS location..."); return }

    // Find nearest outdoor node to user to act as source
    let nearestDist = Infinity
    let sourceNodeId = "MAIN_GATE"
    campusNodes.forEach(n => {
      if (n.node_type === "outdoor" && n.latitude) {
        const d = distanceMeters(userLocation[0], userLocation[1], n.latitude, n.longitude)
        if (d < nearestDist) { nearestDist = d; sourceNodeId = n.node_id }
      }
    })

    try {
      const res = await apiClient.get("/navigate/", {
        params: { source: sourceNodeId, destination: `${roomId}_NODE` }
      })
      const pathData = res.data

      if (routeLayerRef.current) clearInterval(routeLayerRef.current)
      const drawMap = mapRef.current
      const coords = [[userLocation[0], userLocation[1]], ...pathData.coords.map(c => [c.lat, c.lng])]

      if (drawMap.getSource('route')) {
        drawMap.getSource('route').setData({ type: "FeatureCollection", features: [] })
      }

      setRouteSteps(pathData.steps || [])

      let pIdx = 0
      const animatedCoords = []
      const drawInt = setInterval(() => {
        if (!mapRef.current || pIdx >= coords.length) {
          clearInterval(drawInt)
          if (coords.length > 0) {
            const bounds = new maplibregl.LngLatBounds(
              [coords[0][1], coords[0][0]],
              [coords[0][1], coords[0][0]]
            )
            coords.forEach(c => bounds.extend([c[1], c[0]]))
            drawMap.fitBounds(bounds, { padding: 60 })
          }
          return
        }
        animatedCoords.push([coords[pIdx][1], coords[pIdx][0]])
        if (drawMap.getSource('route')) {
          drawMap.getSource('route').setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: animatedCoords }
          })
        }
        pIdx++
      }, 1500 / Math.max(coords.length, 1))

      routeLayerRef.current = drawInt

      setActiveBuildingRooms(null) // close sidebar
    } catch (err) {
      setError(err.response?.data?.error || "Indoor route not found.")
    }
  }

  function handleBuildingConfirmNo() {
    pendingRouteRef.current = null
    setBuildingConfirm(null)
    setError("Tap your building on the map then try again.")
  }

  function handleHandoff() {
    if (!outdoorPath.length) return
    onHandoffToIndoor?.({ building: "nirmithi", entranceNode: "entrance" })
  }

  return (
    <div className="campus-map-wrapper">
      <div className="campus-map-toolbar map-controls">
        <DestinationSearch
          className="campus-map-destination-search"
          label="Destination"
          placeholder="Search destination..."
          options={outdoorDestinationOptions}
          value={selectedDest}
          onChange={(id) => { setSelectedDest(id); setError("") }}
          emptyMessage="No destination found."
        />
        <div className="route-buttons">
          <button type="button" className="route-cta" onClick={handleRoute} disabled={!selectedDest || (userLocationLabel === "Locating..." && !hasGpsFixRef.current)}>
            <svg xmlns="http://www.w3.org/2000/svg" className="route-cta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <span>{userLocationLabel === "Locating..." && !hasGpsFixRef.current ? "📍 Locating..." : "Start Route"}</span>
          </button>
          <button type="button" className="route-button secondary" onClick={handleHandoff} disabled={!outdoorPath.length}>
            Continue Indoors
          </button>
        </div>
        {error && <span className="campus-map-error">{error}</span>}
        {buildingConfirm && (
          <div className="building-confirm-banner">
            <span className="building-confirm-text">
              📍 Are you inside <strong>{buildingConfirm.buildingName}</strong>?
            </span>
            <div className="building-confirm-actions">
              <button type="button" className="building-confirm-yes" onClick={handleBuildingConfirmYes}>✓ Yes</button>
              <button type="button" className="building-confirm-no" onClick={handleBuildingConfirmNo}>✗ No</button>
            </div>
          </div>
        )}
      </div>

      <div className="campus-overview-row filter-chips">
        {campusSummary.map((s) => (
          <span key={s.id} className="campus-overview-chip">{s.label}: {s.count}</span>
        ))}
      </div>

      <div className="map-and-sidebar" style={{ display: "flex", gap: "1rem", position: "relative" }}>

        <div
          ref={mapNodeRef}
          className="campus-map-canvas"
        >
          {/* NEW Reset View Button */}
          <button
            className="reset-3d-btn campus-overview-chip"
            style={{ cursor: "pointer", background: "#ff7a1a", color: "#000", fontWeight: "bold" }}
            onClick={() => {
              if (mapRef.current) {
                mapRef.current.flyTo({
                  center: [78.5580, 17.4515],
                  zoom: 17,
                  pitch: 45,
                  bearing: -20,
                  duration: 1500
                });
              }
            }}
          >
            🔄 Reset 3D View
          </button>
        </div>

        {/* Live Classroom Sidebar Popup */}
        {activeBuildingRooms && (
          <aside className="classroom-sidebar map-overlay-sidebar">
            <div className="classroom-sidebar-head">
              <h3>{activeBuildingRooms.name} Rooms</h3>
              <button className="campus-info-close" onClick={() => setActiveBuildingRooms(null)}>x</button>
            </div>
            <div className="classroom-sidebar-scroll">
              {activeBuildingRooms.rooms.map(room => (
                <div key={room.room_id} className={`sidebar-room-card ${room.status}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{room.room_id}</strong>
                    <span className={`status-dot ${room.status}`}></span>
                  </div>
                  <p className="sidebar-room-name">{room.name} (F{room.floor})</p>

                  {room.status === "available" ? (
                    <button className="sidebar-route-btn" onClick={() => handleRoomRoute(room.room_id)}>
                      📍 Route Here
                    </button>
                  ) : (
                    <div>
                      <p className="sidebar-occupied-text">Occupied right now</p>
                      <button className="sidebar-route-btn alternate" onClick={() => {
                        const altRoom = allRoomsRef.current.find(r => r.status === "available" && r.building === room.building && r.floor === room.floor)
                        if (altRoom) handleRoomRoute(altRoom.room_id)
                        else alert("No available rooms on this floor right now.")
                      }}>
                        🔄 Route to nearest free room
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Route steps popover if navigating to a room */}
        {routeSteps.length > 0 && (
          <div className="route-steps-popover">
            <h4>Indoor Directions</h4>
            <ol>
              {routeSteps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            <button onClick={() => setRouteSteps([])} className="campus-info-close">Dismiss</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default CampusMap
