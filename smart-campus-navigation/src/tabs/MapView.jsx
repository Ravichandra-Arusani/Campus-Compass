import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "leaflet.markercluster"
import "leaflet.markercluster/dist/MarkerCluster.css"
import "leaflet.markercluster/dist/MarkerCluster.Default.css"
import { dijkstra, calculatePathDistance } from "../navigation/dijkstra"
import { buildConstrainedGraph } from "../navigation/graphConstraints"
import { generateInstructions } from "../navigation/generateInstructions"
import {
  distanceBetweenPositionsMeters,
  distanceToRouteMeters,
  findNearestNodeId,
  offsetPositionMeters,
} from "../navigation/positioning"
import { estimateRouteDurationSeconds } from "../navigation/routeMetrics"
import { simulateRouteProgress } from "../navigation/simulateMovement"
import { getNavigationGraph, logNavigationSession } from "../services/api/navigationService"
import DestinationSearch from "../components/DestinationSearch"

const CAMPUS_CENTER = [17.4454, 78.3495]
const SNAP_TO_NODE_THRESHOLD_METERS = 5
const ROUTE_DEVIATION_THRESHOLD_METERS = 18
const REROUTE_COOLDOWN_MS = 3500
const EMPTY_OBJECT = Object.freeze({})
const EMPTY_ARRAY = Object.freeze([])

function buildRouteEdges(routeNodeIds, nodesLookup) {
  if (!Array.isArray(routeNodeIds) || routeNodeIds.length < 2) {
    return []
  }

  const edges = []

  for (let index = 0; index < routeNodeIds.length - 1; index += 1) {
    const fromId = routeNodeIds[index]
    const toId = routeNodeIds[index + 1]
    const fromNode = nodesLookup[fromId]
    const toNode = nodesLookup[toId]

    if (!fromNode || !toNode) {
      continue
    }

    edges.push({
      index,
      fromId,
      toId,
      fromNode,
      toNode,
    })
  }

  return edges
}

function buildNextInstruction(routeNodeIds, currentNodeIndex, nodesLookup, edgeDetailsLookup) {
  if (!Array.isArray(routeNodeIds) || routeNodeIds.length < 2) {
    return ""
  }

  if (currentNodeIndex >= routeNodeIds.length - 1) {
    const destination = nodesLookup[routeNodeIds[routeNodeIds.length - 1]]
    return destination
      ? `Arrived at ${destination.name} in ${destination.building}.`
      : "You have arrived at your destination."
  }

  const currentId = routeNodeIds[currentNodeIndex]
  const nextId = routeNodeIds[currentNodeIndex + 1]
  const currentNode = nodesLookup[currentId]
  const nextNode = nodesLookup[nextId]
  const edge = edgeDetailsLookup[currentId]?.[nextId]

  if (!currentNode || !nextNode || !edge) {
    return "Continue on the current route."
  }

  if (currentNode.floor !== nextNode.floor) {
    if (edge.mode === "stairs") {
      return `Take stairs to Floor ${nextNode.floor}.`
    }

    if (edge.mode === "elevator") {
      return `Take elevator to Floor ${nextNode.floor}.`
    }

    return `Proceed to Floor ${nextNode.floor}.`
  }

  if (currentNode.building !== nextNode.building) {
    return `Proceed toward ${nextNode.building}.`
  }

  if (nextNode.kind === "connector") {
    return `Move to ${nextNode.name}.`
  }

  return `Head to ${nextNode.name} in ${nextNode.building}.`
}

function MapView({ onReady }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const markerClusterLayerRef = useRef(null)
  const routeLayersRef = useRef([])
  const userMarkerRef = useRef(null)
  const navigationModeRef = useRef(false)
  const isNavigatingRef = useRef(false)
  const startNodeRef = useRef("")
  const endNodeRef = useRef("")
  const preferenceRef = useRef("default")
  const routeRef = useRef([])
  const currentNodeIndexRef = useRef(0)
  const rerouteCooldownRef = useRef(0)
  const routeDistanceRef = useRef(0)
  const navigationStartedAtRef = useRef(0)
  const completionLoggedForRouteRef = useRef(false)

  const [graphData, setGraphData] = useState(null)
  const [graphLoading, setGraphLoading] = useState(true)
  const [graphError, setGraphError] = useState("")

  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [tileError, setTileError] = useState(false)
  const [navigationMode, setNavigationMode] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [activeFloor, setActiveFloor] = useState(1)
  const [routingPreference, setRoutingPreference] = useState("default")
  const [startNodeId, setStartNodeId] = useState("")
  const [endNodeId, setEndNodeId] = useState("")
  const [routeNodeIds, setRouteNodeIds] = useState([])
  const [routeDistance, setRouteDistance] = useState(0)
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0)
  const [routeError, setRouteError] = useState("")
  const [navigationNotice, setNavigationNotice] = useState("")
  const [instructionsOpen, setInstructionsOpen] = useState(true)
  const [currentNodeIndex, setCurrentNodeIndex] = useState(0)
  const [userPosition, setUserPosition] = useState(null)

  const nodesLookup = useMemo(() => graphData?.nodes ?? EMPTY_OBJECT, [graphData])
  const campusGraphData = useMemo(
    () => graphData?.campusGraph ?? EMPTY_OBJECT,
    [graphData]
  )
  const edgeDetailsLookup = useMemo(
    () => graphData?.edgeDetails ?? EMPTY_OBJECT,
    [graphData]
  )
  const availableFloorOptions = useMemo(
    () => graphData?.availableFloors ?? EMPTY_ARRAY,
    [graphData]
  )
  const hasGraphData = Object.keys(nodesLookup).length > 0

  const roomNodes = useMemo(() => {
    return Object.entries(nodesLookup)
      .filter(([, node]) => node.kind === "room")
      .map(([nodeId, node]) => ({
        id: nodeId,
        ...node,
      }))
      .sort((first, second) => first.name.localeCompare(second.name))
  }, [nodesLookup])

  const roomNodeOptions = useMemo(() => {
    return roomNodes.map((node) => ({
      id: node.id,
      label: `${node.name} (${node.building} - Floor ${node.floor})`,
      searchText: `${node.name} ${node.building} ${node.floor} ${node.id}`,
    }))
  }, [roomNodes])

  const routeFloors = useMemo(() => {
    return Array.from(
      new Set(
        routeNodeIds
          .map((nodeId) => nodesLookup[nodeId]?.floor)
          .filter((floor) => typeof floor === "number")
      )
    ).sort((a, b) => a - b)
  }, [nodesLookup, routeNodeIds])

  const routeEdges = useMemo(
    () => buildRouteEdges(routeNodeIds, nodesLookup),
    [nodesLookup, routeNodeIds]
  )

  const routeInstructions = useMemo(() => {
    return generateInstructions(routeNodeIds, nodesLookup, edgeDetailsLookup)
  }, [edgeDetailsLookup, nodesLookup, routeNodeIds])

  const constrainedGraphForView = useMemo(() => {
    return buildConstrainedGraph(campusGraphData, nodesLookup, routingPreference)
  }, [campusGraphData, nodesLookup, routingPreference])

  const nextInstruction = useMemo(() => {
    return buildNextInstruction(
      routeNodeIds,
      currentNodeIndex,
      nodesLookup,
      edgeDetailsLookup
    )
  }, [currentNodeIndex, edgeDetailsLookup, nodesLookup, routeNodeIds])

  useEffect(() => {
    let ignore = false

    async function loadGraph() {
      setGraphLoading(true)
      setGraphError("")

      try {
        const payload = await getNavigationGraph()
        if (ignore) {
          return
        }

        setGraphData(payload)
        if (Array.isArray(payload.availableFloors) && payload.availableFloors.length > 0) {
          setActiveFloor((previousFloor) => {
            if (payload.availableFloors.includes(previousFloor)) {
              return previousFloor
            }
            return payload.availableFloors[0]
          })
        }
      } catch (error) {
        if (ignore) {
          return
        }
        setGraphError(error.message || "Failed to load navigation graph.")
      } finally {
        if (!ignore) {
          setGraphLoading(false)
        }
      }
    }

    loadGraph()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    navigationModeRef.current = navigationMode
  }, [navigationMode])

  useEffect(() => {
    isNavigatingRef.current = isNavigating
  }, [isNavigating])

  useEffect(() => {
    startNodeRef.current = startNodeId
  }, [startNodeId])

  useEffect(() => {
    endNodeRef.current = endNodeId
  }, [endNodeId])

  useEffect(() => {
    preferenceRef.current = routingPreference
  }, [routingPreference])

  useEffect(() => {
    routeRef.current = routeNodeIds
  }, [routeNodeIds])

  useEffect(() => {
    currentNodeIndexRef.current = currentNodeIndex
  }, [currentNodeIndex])

  useEffect(() => {
    routeDistanceRef.current = routeDistance
  }, [routeDistance])

  const formatNodeLabel = useCallback(
    (nodeId) => {
      const node = nodesLookup[nodeId]
      if (!node) {
        return nodeId
      }

      return `${node.name} (${node.building} - Floor ${node.floor})`
    },
    [nodesLookup]
  )

  const resetNavigationSession = useCallback(() => {
    setIsNavigating(false)
    setCurrentNodeIndex(0)
    setUserPosition(null)
    setNavigationNotice("")
    navigationStartedAtRef.current = 0
    completionLoggedForRouteRef.current = false
  }, [])

  const submitNavigationSession = useCallback(
    async ({
      startNodeId: sessionStartNodeId,
      endNodeId: sessionEndNodeId,
      path,
      distanceMeters,
      durationSeconds,
      completed,
      preferenceMode,
    }) => {
      if (!Array.isArray(path) || path.length === 0) {
        return
      }

      try {
        const normalizedDistance = Number(distanceMeters)
        const normalizedDuration = Number(durationSeconds)

        await logNavigationSession({
          startNodeId: sessionStartNodeId,
          endNodeId: sessionEndNodeId,
          preferenceMode,
          routeNodeIds: path,
          routeDistance:
            Number.isFinite(normalizedDistance) && normalizedDistance >= 0
              ? normalizedDistance
              : 0,
          durationSeconds:
            Number.isFinite(normalizedDuration) && normalizedDuration >= 0
              ? normalizedDuration
              : 0,
          completed: Boolean(completed),
        })
      } catch (error) {
        console.error("Navigation session log failed:", error)
      }
    },
    []
  )

  const clearRoute = useCallback(() => {
    setStartNodeId("")
    setEndNodeId("")
    setRouteNodeIds([])
    setRouteDistance(0)
    setRouteDurationSeconds(0)
    setRouteError("")
    resetNavigationSession()
  }, [resetNavigationSession])

  const computeRoute = useCallback(
    (startId, endId, preference) => {
      if (!hasGraphData) {
        setRouteError("Navigation graph is not loaded yet.")
        return
      }

      if (!startId || !endId) {
        setRouteNodeIds([])
        setRouteDistance(0)
        setRouteDurationSeconds(0)
        setRouteError("")
        resetNavigationSession()
        return
      }

      if (startId === endId) {
        setRouteNodeIds([startId])
        setRouteDistance(0)
        setRouteDurationSeconds(0)
        setRouteError("Start and destination cannot be the same node.")
        resetNavigationSession()
        return
      }

      const constrainedGraph = buildConstrainedGraph(campusGraphData, nodesLookup, preference)

      if (!constrainedGraph[startId] || !constrainedGraph[endId]) {
        setRouteNodeIds([])
        setRouteDistance(0)
        setRouteDurationSeconds(0)
        setRouteError("Current accessibility preference blocks one of the selected nodes.")
        resetNavigationSession()
        return
      }

      const path = dijkstra(constrainedGraph, startId, endId)

      if (path.length < 2) {
        setRouteNodeIds([])
        setRouteDistance(0)
        setRouteDurationSeconds(0)
        setRouteError("No walkable route found for the selected preference.")
        resetNavigationSession()
        return
      }

      const totalDistance = calculatePathDistance(constrainedGraph, path)
      const durationSeconds = estimateRouteDurationSeconds(path, edgeDetailsLookup)
      const startNode = nodesLookup[path[0]]
      const routeStartNodeId = path[0]
      const routeEndNodeId = path[path.length - 1]

      setRouteNodeIds(path)
      setRouteDistance(Number.isFinite(totalDistance) ? totalDistance : 0)
      setRouteDurationSeconds(durationSeconds)
      setRouteError("")
      setCurrentNodeIndex(0)
      setIsNavigating(true)
      setNavigationNotice("Live guidance started.")
      navigationStartedAtRef.current = Date.now()
      completionLoggedForRouteRef.current = false

      if (startNode) {
        setUserPosition({ lat: startNode.lat, lng: startNode.lng })
        setActiveFloor(startNode.floor)
      }

      submitNavigationSession({
        startNodeId: routeStartNodeId,
        endNodeId: routeEndNodeId,
        path,
        distanceMeters: totalDistance,
        durationSeconds,
        completed: false,
        preferenceMode: preference,
      })
    },
    [
      campusGraphData,
      edgeDetailsLookup,
      hasGraphData,
      nodesLookup,
      resetNavigationSession,
      submitNavigationSession,
    ]
  )

  const setSelectionAndRoute = useCallback(
    (nextStartNodeId, nextEndNodeId, preference = preferenceRef.current) => {
      setStartNodeId(nextStartNodeId)
      setEndNodeId(nextEndNodeId)

      if (nextStartNodeId) {
        const nextNode = nodesLookup[nextStartNodeId]
        const nextFloor = nextNode?.floor
        if (typeof nextFloor === "number") {
          setActiveFloor(nextFloor)
        }
        if (nextNode) {
          setUserPosition({ lat: nextNode.lat, lng: nextNode.lng })
        }
      }

      if (!navigationModeRef.current || !nextStartNodeId || !nextEndNodeId) {
        setRouteNodeIds([])
        setRouteDistance(0)
        setRouteDurationSeconds(0)
        setRouteError("")
        resetNavigationSession()
        return
      }

      computeRoute(nextStartNodeId, nextEndNodeId, preference)
    },
    [computeRoute, nodesLookup, resetNavigationSession]
  )

  const handleNavigationPositionUpdate = useCallback(
    (positionUpdate) => {
      if (!positionUpdate) {
        return
      }

      const position = {
        lat: positionUpdate.lat,
        lng: positionUpdate.lng,
      }

      setUserPosition(position)

      if (!isNavigatingRef.current) {
        return
      }

      const activeRoute = routeRef.current
      if (activeRoute.length < 2) {
        return
      }

      let activeIndex = currentNodeIndexRef.current
      const nextNodeId = activeRoute[activeIndex + 1]

      if (nextNodeId) {
        const nextNode = nodesLookup[nextNodeId]
        const distanceToNextNode = distanceBetweenPositionsMeters(position, nextNode)

        if (distanceToNextNode <= SNAP_TO_NODE_THRESHOLD_METERS) {
          activeIndex += 1
          currentNodeIndexRef.current = activeIndex
          setCurrentNodeIndex(activeIndex)
          setActiveFloor(nextNode.floor)
          setNavigationNotice(`Reached ${nextNode.name} on Floor ${nextNode.floor}.`)

          if (activeIndex >= activeRoute.length - 1) {
            setIsNavigating(false)
            setNavigationNotice("Destination reached.")

            if (!completionLoggedForRouteRef.current) {
              completionLoggedForRouteRef.current = true
              const durationSeconds =
                navigationStartedAtRef.current > 0
                  ? (Date.now() - navigationStartedAtRef.current) / 1000
                  : 0

              submitNavigationSession({
                startNodeId: activeRoute[0],
                endNodeId: activeRoute[activeRoute.length - 1],
                path: activeRoute,
                distanceMeters: routeDistanceRef.current,
                durationSeconds,
                completed: true,
                preferenceMode: preferenceRef.current,
              })
            }
            return
          }
        }
      }

      const deviationDistance = distanceToRouteMeters(position, activeRoute, nodesLookup)
      if (deviationDistance <= ROUTE_DEVIATION_THRESHOLD_METERS) {
        return
      }

      const now = Date.now()
      if (now - rerouteCooldownRef.current < REROUTE_COOLDOWN_MS) {
        return
      }

      rerouteCooldownRef.current = now
      const destinationNodeId = endNodeRef.current
      if (!destinationNodeId) {
        return
      }

      const constrainedGraph = buildConstrainedGraph(
        campusGraphData,
        nodesLookup,
        preferenceRef.current
      )
      const nearestNodeId = findNearestNodeId(
        position,
        Object.keys(constrainedGraph),
        nodesLookup
      )

      if (!nearestNodeId || nearestNodeId === destinationNodeId) {
        return
      }

      setNavigationNotice(
        `Deviation detected (${Math.round(deviationDistance)}m). Auto rerouting...`
      )
      setStartNodeId(nearestNodeId)
      computeRoute(nearestNodeId, destinationNodeId, preferenceRef.current)
    },
    [campusGraphData, computeRoute, nodesLookup, submitNavigationSession]
  )

  const handleToggleNavigationMode = useCallback(() => {
    if (!hasGraphData) {
      setRouteError("Navigation graph is unavailable.")
      return
    }

    setNavigationMode((previousMode) => {
      const nextMode = !previousMode

      if (!nextMode) {
        clearRoute()
      }

      return nextMode
    })
  }, [clearRoute, hasGraphData])

  const handleNodeClick = useCallback(
    (nodeId) => {
      const node = nodesLookup[nodeId]

      if (!navigationModeRef.current || !node || node.kind !== "room") {
        return
      }

      const currentStart = startNodeRef.current
      const currentEnd = endNodeRef.current

      if (!currentStart || currentEnd) {
        setSelectionAndRoute(nodeId, "")
        return
      }

      setSelectionAndRoute(currentStart, nodeId)
    },
    [nodesLookup, setSelectionAndRoute]
  )

  const handlePreferenceChange = useCallback(
    (event) => {
      const nextPreference = event.target.value
      setRoutingPreference(nextPreference)

      const currentStart = startNodeRef.current
      const currentEnd = endNodeRef.current

      if (navigationModeRef.current && currentStart && currentEnd) {
        computeRoute(currentStart, currentEnd, nextPreference)
      }
    },
    [computeRoute]
  )

  const handleFloorChange = useCallback(
    (event) => {
      const nextFloor = Number(event.target.value)
      setActiveFloor(nextFloor)

      const currentStart = startNodeRef.current
      const currentEnd = endNodeRef.current

      if (navigationModeRef.current && currentStart && currentEnd) {
        computeRoute(currentStart, currentEnd, preferenceRef.current)
      }
    },
    [computeRoute]
  )

  const handleRecalculate = useCallback(() => {
    const currentStart = startNodeRef.current
    const currentEnd = endNodeRef.current

    if (!navigationModeRef.current || !currentStart || !currentEnd) {
      return
    }

    computeRoute(currentStart, currentEnd, preferenceRef.current)
  }, [computeRoute])

  const handleSimulateDeviation = useCallback(() => {
    if (!isNavigatingRef.current || !userPosition) {
      return
    }

    const deviatedPosition = offsetPositionMeters(userPosition, 24, 22)
    if (!deviatedPosition) {
      return
    }

    handleNavigationPositionUpdate(deviatedPosition)
  }, [handleNavigationPositionUpdate, userPosition])

  const renderVisibleNodes = useCallback(() => {
    const map = mapRef.current
    const markerClusterLayer = markerClusterLayerRef.current

    if (!map || !markerClusterLayer) {
      return
    }

    const bounds = map.getBounds().pad(0.2)
    markerClusterLayer.clearLayers()

    Object.entries(nodesLookup).forEach(([nodeId, node]) => {
      if (node.floor !== activeFloor) {
        return
      }

      if (!constrainedGraphForView[nodeId]) {
        return
      }

      if (!bounds.contains([node.lat, node.lng])) {
        return
      }

      let color = "#FF6A00"
      let radius = 6

      if (node.kind === "room") {
        color = "#F59E0B"
        radius = 7
      } else if (node.connectorType === "elevator") {
        color = "#2979FF"
      }

      const marker = L.circleMarker([node.lat, node.lng], {
        radius,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.85,
      })

      const occupancyText = ""

      marker.bindPopup(
        `<strong>${node.name}</strong><br/>${node.building} - Floor ${node.floor}${occupancyText}`
      )

      marker.on("click", () => {
        handleNodeClick(nodeId)
      })

      markerClusterLayer.addLayer(marker)
    })
  }, [activeFloor, constrainedGraphForView, handleNodeClick, nodesLookup])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) {
      return undefined
    }

    const map = L.map(mapNodeRef.current, {
      zoomControl: false,
      preferCanvas: true,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      attributionControl: false,
    }).setView(CAMPUS_CENTER, 17)

    const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      minZoom: 15,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1,
    })

    tileLayer.on("tileerror", () => {
      setTileError(true)
    })

    tileLayer.addTo(map)

    const markerClusterLayer = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      removeOutsideVisibleBounds: true,
      disableClusteringAtZoom: 18,
      maxClusterRadius: 40,
      iconCreateFunction: (cluster) => {
        return L.divIcon({
          className: "cluster-badge",
          html: `<span>${cluster.getChildCount()}</span>`,
          iconSize: [36, 36],
        })
      },
    }).addTo(map)

    mapRef.current = map
    markerClusterLayerRef.current = markerClusterLayer

    requestAnimationFrame(() => {
      map.invalidateSize()
      onReady?.()
    })

    return () => {
      map.remove()
      mapRef.current = null
      markerClusterLayerRef.current = null
      userMarkerRef.current = null
    }
  }, [onReady])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return undefined
    }

    map.on("moveend", renderVisibleNodes)
    renderVisibleNodes()

    return () => {
      map.off("moveend", renderVisibleNodes)
    }
  }, [renderVisibleNodes])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    routeLayersRef.current.forEach((layer) => {
      map.removeLayer(layer)
    })
    routeLayersRef.current = []

    if (routeEdges.length === 0) {
      return
    }

    routeEdges.forEach((edge) => {
      const isCompleted = edge.index < currentNodeIndex
      const isActive = edge.index === currentNodeIndex && isNavigating
      const touchesActiveFloor =
        edge.fromNode.floor === activeFloor || edge.toNode.floor === activeFloor

      const style = {
        color: "#2979FF",
        weight: 5,
        opacity: 0.72,
        lineCap: "round",
        lineJoin: "round",
      }

      if (isCompleted) {
        style.color = "#6B7280"
        style.opacity = 0.5
        style.weight = 4
      } else if (isActive) {
        style.color = "#FF6A00"
        style.opacity = 0.98
        style.weight = 8
      } else {
        style.dashArray = "8 10"
      }

      if (!touchesActiveFloor) {
        style.opacity *= 0.45
      }

      let coordinates = [
        [edge.fromNode.lat, edge.fromNode.lng],
        [edge.toNode.lat, edge.toNode.lng],
      ]

      if (edge.fromNode.lat === edge.toNode.lat && edge.fromNode.lng === edge.toNode.lng) {
        coordinates = [
          [edge.fromNode.lat, edge.fromNode.lng],
          [edge.toNode.lat + 0.00004, edge.toNode.lng + 0.00004],
        ]
      }

      const routeLayer = L.polyline(coordinates, style).addTo(map)
      routeLayersRef.current.push(routeLayer)
    })
  }, [activeFloor, currentNodeIndex, isNavigating, routeEdges])

  useEffect(() => {
    const map = mapRef.current

    if (!map || routeNodeIds.length < 2) {
      return
    }

    const allCoordinates = routeNodeIds
      .map((nodeId) => nodesLookup[nodeId])
      .filter(Boolean)
      .map((node) => [node.lat, node.lng])

    if (allCoordinates.length >= 2) {
      map.fitBounds(L.latLngBounds(allCoordinates), {
        padding: [40, 40],
        maxZoom: 18,
      })
    }
  }, [nodesLookup, routeNodeIds])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    if (!userPosition || !isNavigating) {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current)
        userMarkerRef.current = null
      }
      return
    }

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.circleMarker([userPosition.lat, userPosition.lng], {
        radius: 8,
        color: "#FFFFFF",
        weight: 2,
        fillColor: "#00B8D4",
        fillOpacity: 1,
      }).addTo(map)
      return
    }

    userMarkerRef.current.setLatLng([userPosition.lat, userPosition.lng])
  }, [isNavigating, userPosition])

  useEffect(() => {
    if (!isNavigating || routeNodeIds.length < 2 || !hasGraphData) {
      return undefined
    }

    const stopSimulation = simulateRouteProgress(
      routeNodeIds,
      nodesLookup,
      (positionUpdate) => {
        handleNavigationPositionUpdate(positionUpdate)
      },
      {
        intervalMs: 750,
        stepsPerEdge: 5,
        startNodeIndex: currentNodeIndexRef.current,
      }
    )

    return () => {
      stopSimulation()
    }
  }, [handleNavigationPositionUpdate, hasGraphData, isNavigating, nodesLookup, routeNodeIds])

  const routeEtaText = useMemo(() => {
    const totalSeconds = Math.max(0, Math.round(routeDurationSeconds))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  }, [routeDurationSeconds])

  const routeDescription =
    routeNodeIds.length > 1
      ? routeNodeIds.map((nodeId) => formatNodeLabel(nodeId)).join(" -> ")
      : ""

  const routeSpansFloors = routeFloors.length > 1
  const routeProgressPercent =
    routeNodeIds.length > 1
      ? Math.min(100, (currentNodeIndex / (routeNodeIds.length - 1)) * 100)
      : 0

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Campus Map</h2>
        <p>
          Live guidance mode with simulated user movement, snap-to-route
          progression, and auto rerouting.
        </p>
      </div>

      <div className="routing-toolbar">
        <button
          type="button"
          className={navigationMode ? "route-button active" : "route-button"}
          onClick={handleToggleNavigationMode}
          disabled={graphLoading || !!graphError}
        >
          {navigationMode ? "Stop Navigation Mode" : "Start Navigation Mode"}
        </button>

        {navigationMode && (
          <button type="button" className="route-button secondary" onClick={clearRoute}>
            Clear Route
          </button>
        )}

        {navigationMode && startNodeId && endNodeId && (
          <button type="button" className="route-button secondary" onClick={handleRecalculate}>
            Recalculate
          </button>
        )}

        {routeNodeIds.length > 1 && (
          <button
            type="button"
            className="route-button secondary"
            onClick={() => {
              setIsNavigating((previousState) => {
                const nextState = !previousState
                setNavigationNotice(nextState ? "Guidance resumed." : "Guidance paused.")
                return nextState
              })
            }}
          >
            {isNavigating ? "Pause Guidance" : "Resume Guidance"}
          </button>
        )}

        {routeNodeIds.length > 1 && (
          <button
            type="button"
            className="route-button secondary"
            onClick={handleSimulateDeviation}
          >
            Simulate Deviation
          </button>
        )}

        <label className="preference-selector">
          Routing
          <select value={routingPreference} onChange={handlePreferenceChange}>
            <option value="default">Default</option>
            <option value="noStairs">Avoid Stairs</option>
            <option value="liftOnly">Lift Only</option>
          </select>
        </label>

        <label className="floor-selector">
          Floor
          <select value={activeFloor} onChange={handleFloorChange}>
            {availableFloorOptions.map((floor) => (
              <option key={floor} value={floor}>
                Floor {floor}
              </option>
            ))}
          </select>
        </label>
      </div>

      {navigationMode && (
        <div className="routing-select-row">
          <DestinationSearch
            label="Start"
            placeholder="Search start node..."
            options={roomNodeOptions}
            value={startNodeId}
            onChange={(nextStartNodeId) => {
              setSelectionAndRoute(nextStartNodeId, endNodeId)
            }}
            emptyMessage="No start node found."
          />

          <DestinationSearch
            label="Destination"
            placeholder="Search destination node..."
            options={roomNodeOptions}
            value={endNodeId}
            onChange={(nextEndNodeId) => {
              setSelectionAndRoute(startNodeId, nextEndNodeId)
            }}
            emptyMessage="No destination node found."
          />
        </div>
      )}

      {graphLoading && <div className="network-banner info">Loading navigation graph...</div>}
      {graphError && <div className="network-banner">{graphError}</div>}
      {!isOnline && <div className="network-banner warning">You are offline. Map tiles may not load.</div>}
      {tileError && <div className="network-banner">Map tile issue detected. Retry when network is stable.</div>}
      {routeError && <div className="network-banner">{routeError}</div>}
      {navigationNotice && <div className="network-banner info">{navigationNotice}</div>}

      {routeNodeIds.length > 1 && (
        <div className="next-instruction">
          <p className="next-instruction-label">Next Instruction</p>
          <p className="next-instruction-text">{nextInstruction}</p>
          <div className="next-instruction-meta">
            <span>
              Node {Math.min(currentNodeIndex + 1, routeNodeIds.length)} / {routeNodeIds.length}
            </span>
            <span>{isNavigating ? "Live tracking active" : "Tracking paused"}</span>
          </div>
          <div className="navigation-progress-track">
            <div
              className="navigation-progress-fill"
              style={{ width: `${routeProgressPercent}%` }}
            />
          </div>
        </div>
      )}

      {routeNodeIds.length > 1 && (
        <div className="route-summary">
          <p>
            Distance: <strong>{Math.round(routeDistance)} m</strong>
          </p>
          <p>
            ETA: <strong>{routeEtaText}</strong>
          </p>
          {routeSpansFloors && (
            <p className="route-floors">
              Route spans floors: {routeFloors.map((floor) => `F${floor}`).join(", ")}
            </p>
          )}
          <p className="route-nodes">{routeDescription}</p>
        </div>
      )}

      {routeInstructions.length > 0 && (
        <div className="instruction-panel">
          <button
            type="button"
            className="instruction-toggle"
            onClick={() => {
              setInstructionsOpen((previousState) => !previousState)
            }}
          >
            {instructionsOpen ? "Hide Instructions" : "Show Instructions"}
          </button>

          {instructionsOpen && (
            <ol className="instruction-list">
              {routeInstructions.map((instruction, index) => (
                <li key={`${index + 1}-${instruction}`}>{instruction}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="map-surface">
        <div ref={mapNodeRef} className="map-canvas" />
      </div>
    </section>
  )
}

export default MapView
