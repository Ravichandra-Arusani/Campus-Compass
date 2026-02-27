import { useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { campusBlueprint, campusBlueprintById } from "../data/campusBlueprint"
import { buildCampusGraphFromGeoJson } from "../outdoor/campusGraph"
import {
  buildRoadPathGraph,
  dijkstraRoadPath,
  findNearestRoadNode,
  getRoadGraphConnectivity,
  getSnappedBuildingRoadNode,
} from "../outdoor/roadPathGraph"
import DestinationSearch from "./DestinationSearch"

const VBIT_CENTER = [17.4706, 78.7216]
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
const GEOJSON_CACHE_BUSTER = Date.now()
const SNAP_CONNECTOR_MIN_RENDER_METERS = 3
const MAX_START_CONNECTOR_METERS = 250
const DESTINATION_SNAP_MAX_METERS = 75
const GRAPH_CACHE_KEYS = [
  "smart-campus-navigation:graph-cache:v1",
  "cachedGraph",
  "graph",
  "nodes",
  "adjacency",
]

const HARD_ROUTE_WAYPOINTS_BY_DESTINATION = {
  pratham_block: [
    [17.470937, 78.723397],
    [17.4705, 78.7229],
    [17.470522, 78.722185],
    [17.46965, 78.722006],
    [17.46961, 78.722393],
    [17.46957, 78.722774],
  ],
  library: [
    [17.470937, 78.723397],
    [17.4705, 78.7229],
    [17.470522, 78.722185],
    [17.470535, 78.721627],
    [17.470589, 78.721254],
  ],
  avishkar_block: [
    [17.470937, 78.723397],
    [17.4705, 78.7229],
    [17.470522, 78.722185],
    [17.470535, 78.721627],
    [17.470589, 78.721254],
    [17.470052, 78.72121],
  ],
}

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

function appendPathSegment(targetPath, segment) {
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

function getNearestWaypointIndex(origin, waypoints) {
  if (!Array.isArray(origin) || !Array.isArray(waypoints) || waypoints.length === 0) {
    return 0
  }

  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  waypoints.forEach(([lat, lng], index) => {
    const meters = distanceMeters(origin[0], origin[1], lat, lng)
    if (meters < nearestDistance) {
      nearestDistance = meters
      nearestIndex = index
    }
  })

  return nearestIndex
}

function resolveForcedGraphPath(destinationId, origin) {
  const waypoints = HARD_ROUTE_WAYPOINTS_BY_DESTINATION[destinationId]
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return null
  }

  const nearestIndex = getNearestWaypointIndex(origin, waypoints)
  return waypoints.slice(nearestIndex)
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
  const routeRequestRef  = useRef(null)
  const destMarkerRef    = useRef(null)
  const campusFootprintLayerRef = useRef(null)
  const hasCenteredOnUserRef = useRef(false)
  const hasGpsFixRef = useRef(false)
  const campusPathGraphRef = useRef(null)

  const [userLocation,      setUserLocation]      = useState(null)
  const [userLocationLabel, setUserLocationLabel] = useState(
    typeof navigator !== "undefined" && navigator.geolocation
      ? "Locating..."
      : "GPS unavailable - enable location access to route from your position"
  )
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

  // Map initialization
  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined

    if (typeof window !== "undefined" && window.localStorage) {
      GRAPH_CACHE_KEYS.forEach((storageKey) => {
        window.localStorage.removeItem(storageKey)
      })
    }

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
            const props    = resolveCampusProperties(feature?.properties)
            const name     = props?.name
            const baseStyle = getFootprintStyle({ properties: props })
            if (name) {
              layer.bindTooltip(name, {
                permanent: false,
                direction: "top",
                className: "campus-footprint-label",
                opacity: 0.92,
              })
              layer.bindPopup(name)
            }
            layer.on("mouseover", () =>
              layer.setStyle({
                fillOpacity: FOOTPRINT_HOVER_FILL_OPACITY,
                weight: (baseStyle.weight || 2) + 2,
              })
            )
            layer.on("mouseout",  () =>
              layer.setStyle({
                fillOpacity: baseStyle.fillOpacity,
                weight: baseStyle.weight || 2,
              })
            )
            layer.on("click",     () => setSelectedBuilding(props))
          },
        }).addTo(map)

        const graph = buildCampusGraphFromGeoJson(data, roadData)
        setCampusGraph(graph)
        const roadPathGraph = buildRoadPathGraph(roadData, data, {
          logSourceSummary: false,
        })
        campusPathGraphRef.current = roadPathGraph

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
      if (campusFootprintLayerRef.current) { campusFootprintLayerRef.current.remove(); campusFootprintLayerRef.current = null }
      campusPathGraphRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // GPS: watch user position
  useEffect(() => {
    if (!navigator.geolocation) {
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

async function getHybridRoute(startLat, startLng, endLat, endLng, destinationId, abortSignal) {
  const pathGraph = campusPathGraphRef.current
  const graphNodeCount = Object.keys(pathGraph || {}).length
  if (graphNodeCount === 0) {
    throw new Error("Campus path network is not available.")
  }

  const connectivity = getRoadGraphConnectivity(pathGraph)
  if (connectivity.total > 0 && connectivity.visited !== connectivity.total) {
    throw new Error("Campus path network is fragmented. Connectivity test failed.")
  }

  function resolveDestinationRoadNode(allowedComponentIds) {
    const coordinateSnappedDestinationNode = findNearestRoadNode(pathGraph, [endLng, endLat], {
      allowedComponentIds,
    })
    const snappedBuildingRoadNode = destinationId
      ? getSnappedBuildingRoadNode(pathGraph, destinationId, { allowedComponentIds })
      : null

    let destinationRoadNode = coordinateSnappedDestinationNode || null
    if (
      (!destinationRoadNode ||
        !Number.isFinite(destinationRoadNode.distance) ||
        destinationRoadNode.distance > DESTINATION_SNAP_MAX_METERS) &&
      snappedBuildingRoadNode
    ) {
      destinationRoadNode = snappedBuildingRoadNode
    }

    if (!destinationRoadNode?.id) {
      throw new Error("Destination is not connected to mapped campus paths.")
    }
    if (
      !Number.isFinite(destinationRoadNode.distance) ||
      destinationRoadNode.distance > DESTINATION_SNAP_MAX_METERS
    ) {
      throw new Error("Destination is too far from mapped campus paths.")
    }

    return destinationRoadNode
  }

  const insideCampus =
    startLat >= CAMPUS_BOUNDS.minLat &&
    startLat <= CAMPUS_BOUNDS.maxLat &&
    startLng >= CAMPUS_BOUNDS.minLng &&
    startLng <= CAMPUS_BOUNDS.maxLng

  const connectorStart = []
  let graphPath = []

  if (!insideCampus) {
    const entranceRoadNode = findNearestRoadNode(pathGraph, [CAMPUS_ENTRANCE_HINT[1], CAMPUS_ENTRANCE_HINT[0]])
    if (!entranceRoadNode?.id) {
      throw new Error("Campus entrance is not connected to mapped campus paths.")
    }

    const entranceCoord = pathGraph[entranceRoadNode.id]?.coord
    if (!Array.isArray(entranceCoord) || !Number.isFinite(entranceCoord[0]) || !Number.isFinite(entranceCoord[1])) {
      throw new Error("Campus entrance node coordinates are unavailable.")
    }

    const [entranceLat, entranceLng] = entranceCoord
    try {
      const osrmUrl =
        "https://router.project-osrm.org/route/v1/foot/" +
        `${startLng},${startLat};${entranceLng},${entranceLat}` +
        "?overview=full&geometries=geojson"
      const response = await fetch(osrmUrl, { signal: abortSignal })
      if (!response.ok) {
        throw new Error(`Routing service returned ${response.status}`)
      }

      const payload = await response.json()
      const coordinates = payload?.routes?.[0]?.geometry?.coordinates
      if (Array.isArray(coordinates) && coordinates.length > 0) {
        connectorStart.push(...coordinates.map(([lng, lat]) => [lat, lng]))
      } else {
        connectorStart.push([startLat, startLng], [entranceLat, entranceLng])
      }
    } catch (connectorError) {
      if (connectorError?.name === "AbortError") {
        throw connectorError
      }
      connectorStart.push([startLat, startLng], [entranceLat, entranceLng])
    }

    const entranceComponentId = pathGraph[entranceRoadNode.id]?.componentId
    const allowedComponentIds =
      Number.isInteger(entranceComponentId) ? new Set([entranceComponentId]) : undefined
    const destinationRoadNode = resolveDestinationRoadNode(allowedComponentIds)

    graphPath = dijkstraRoadPath(pathGraph, entranceRoadNode.id, destinationRoadNode.id) || []
    if (graphPath.length < 2) {
      throw new Error("No on-campus walking path found from entrance to destination.")
    }
  } else {
    const startRoadNode = findNearestRoadNode(pathGraph, [startLng, startLat])
    if (!startRoadNode?.id) {
      throw new Error("Current location is not connected to mapped campus paths.")
    }
    if (!Number.isFinite(startRoadNode.distance)) {
      throw new Error("Could not snap current location to campus road network.")
    }

    const startNodeCoord = pathGraph[startRoadNode.id]?.coord
    if (
      Array.isArray(startNodeCoord) &&
      Number.isFinite(startNodeCoord[0]) &&
      Number.isFinite(startNodeCoord[1]) &&
      startRoadNode.distance >= SNAP_CONNECTOR_MIN_RENDER_METERS &&
      startRoadNode.distance <= MAX_START_CONNECTOR_METERS
    ) {
      connectorStart.push([startLat, startLng], startNodeCoord)
    }

    const startComponentId = pathGraph[startRoadNode.id]?.componentId
    const allowedComponentIds =
      Number.isInteger(startComponentId) ? new Set([startComponentId]) : undefined
    const destinationRoadNode = resolveDestinationRoadNode(allowedComponentIds)

    graphPath = dijkstraRoadPath(pathGraph, startRoadNode.id, destinationRoadNode.id) || []
    if (graphPath.length < 2) {
      throw new Error("No on-campus walking path found to destination.")
    }
  }

  const fullPath = []
  appendPathSegment(fullPath, connectorStart)
  appendPathSegment(fullPath, graphPath)

  return { fullPath, graphPath, connectorStart }
}

  // Routing
  // Route using snapped road-network nodes and draw a short connector from live GPS to the first road node.
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
    const controller = new AbortController()
    routeRequestRef.current = controller

    if (routeLayerRef.current) { routeLayerRef.current.remove(); routeLayerRef.current = null }
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }
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
      let resolvedRouteSegments = routeSegments
      const connectorStart = Array.isArray(routeSegments?.connectorStart)
        ? routeSegments.connectorStart
        : []
      const connectorAnchor = connectorStart.length > 0
        ? connectorStart[connectorStart.length - 1]
        : [startLat, startLng]
      const forcedGraphPath = resolveForcedGraphPath(selectedDest, connectorAnchor)
      if (Array.isArray(forcedGraphPath) && forcedGraphPath.length >= 2) {
        const forcedFullPath = []
        appendPathSegment(forcedFullPath, connectorStart)
        appendPathSegment(forcedFullPath, forcedGraphPath)
        resolvedRouteSegments = {
          fullPath: forcedFullPath,
          graphPath: forcedGraphPath,
          connectorStart,
        }
      }

      const routeLatLngs = resolvedRouteSegments?.fullPath || []
      if (!routeLatLngs.length) {
        setError("No route found for this destination.")
        return
      }

      setOutdoorPath(routeLatLngs)
      const routeGroup = L.featureGroup().addTo(map)

      if (Array.isArray(resolvedRouteSegments.connectorStart) && resolvedRouteSegments.connectorStart.length >= 2) {
        L.polyline(resolvedRouteSegments.connectorStart, {
          color: "#94a3b8",
          weight: 3,
          opacity: 0.75,
          dashArray: "4,4",
          lineCap: "round",
          lineJoin: "round",
          className: "campus-route-connector",
        }).addTo(routeGroup)
      }

      if (Array.isArray(resolvedRouteSegments.graphPath) && resolvedRouteSegments.graphPath.length >= 2) {
        L.polyline(resolvedRouteSegments.graphPath, {
          color: "#f59e0b",
          weight: 6,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          className: "campus-active-route",
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



