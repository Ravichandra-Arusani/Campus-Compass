import pointOnFeature from "@turf/point-on-feature"

const EARTH_RADIUS_M = 6371000
const ROAD_POINT_PRECISION = 6
const MIN_ROAD_EDGE_METERS = 1.6
const DEFAULT_SNAP_RADIUS_METERS = 40
const BUILDING_SNAP_RADIUS_METERS = 40

const roadGraphConnectivityByGraph = new WeakMap()
const buildingSnapIndexByGraph = new WeakMap()

function toRadians(value) {
  return (value * Math.PI) / 180
}

export function normalize(coord) {
  const [lng, lat] = Array.isArray(coord) ? coord : []
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null
  }

  return [Number(lng.toFixed(ROAD_POINT_PRECISION)), Number(lat.toFixed(ROAD_POINT_PRECISION))]
}

function toRoadNodeKey(lng, lat) {
  return `${lng},${lat}`
}

export function haversine(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return Number.POSITIVE_INFINITY
  }

  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const haversineValue =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)

  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  return haversine({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng })
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
    return { lat: aLat, lng: aLng }
  }

  let t = (apx * abx + apy * aby) / abLenSq
  if (!Number.isFinite(t)) {
    t = 0
  }
  if (t < 0) {
    t = 0
  } else if (t > 1) {
    t = 1
  }

  return {
    lat: ay + aby * t,
    lng: ax + abx * t,
  }
}

function getRoadLineCoordinateSets(roadGeoJsonPayload) {
  const features = Array.isArray(roadGeoJsonPayload?.features) ? roadGeoJsonPayload.features : []
  const lineCoordinateSets = []
  const geometryTypeCounts = {}
  let acceptedLineFeatureCount = 0
  let ignoredNonLineFeatureCount = 0

  features.forEach((feature) => {
    const geometry = feature?.geometry
    if (!geometry) {
      ignoredNonLineFeatureCount += 1
      geometryTypeCounts.Unknown = (geometryTypeCounts.Unknown || 0) + 1
      return
    }

    const geometryType = String(geometry.type || "Unknown")
    geometryTypeCounts[geometryType] = (geometryTypeCounts[geometryType] || 0) + 1

    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
      lineCoordinateSets.push(geometry.coordinates)
      acceptedLineFeatureCount += 1
      return
    }

    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((lineCoordinates) => {
        if (Array.isArray(lineCoordinates)) {
          lineCoordinateSets.push(lineCoordinates)
        }
      })
      acceptedLineFeatureCount += 1
      return
    }

    ignoredNonLineFeatureCount += 1
  })

  return {
    lineCoordinateSets,
    sourceStats: {
      totalFeatures: features.length,
      acceptedLineFeatureCount,
      ignoredNonLineFeatureCount,
      geometryTypeCounts,
    },
  }
}

function ensureAdjacencyEntry(adjacency, nodeId) {
  let entry = adjacency.get(nodeId)
  if (!entry) {
    entry = new Map()
    adjacency.set(nodeId, entry)
  }
  return entry
}

function connectNodes(nodes, adjacency, fromNodeId, toNodeId) {
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
    return
  }

  const fromNode = nodes.get(fromNodeId)
  const toNode = nodes.get(toNodeId)
  if (!fromNode || !toNode) {
    return
  }

  const edgeDistance = haversine(fromNode, toNode)
  if (!Number.isFinite(edgeDistance) || edgeDistance < MIN_ROAD_EDGE_METERS) {
    return
  }

  const fromAdjacency = ensureAdjacencyEntry(adjacency, fromNodeId)
  const toAdjacency = ensureAdjacencyEntry(adjacency, toNodeId)
  const existingDistance = fromAdjacency.get(toNodeId)

  if (existingDistance === undefined || edgeDistance < existingDistance) {
    fromAdjacency.set(toNodeId, edgeDistance)
    toAdjacency.set(fromNodeId, edgeDistance)
  }
}

function buildRoadNodes(roadGeoJsonPayload) {
  const nodes = new Map()
  const adjacency = new Map()
  const { lineCoordinateSets, sourceStats } = getRoadLineCoordinateSets(roadGeoJsonPayload)

  function getNodeId(coord) {
    const normalized = normalize(coord)
    if (!normalized) {
      return null
    }

    const [lng, lat] = normalized
    const nodeId = toRoadNodeKey(lng, lat)
    if (!nodes.has(nodeId)) {
      nodes.set(nodeId, {
        id: nodeId,
        lng,
        lat,
        neighbors: [],
      })
      adjacency.set(nodeId, new Map())
    }

    return nodeId
  }

  lineCoordinateSets.forEach((lineCoordinates) => {
    if (!Array.isArray(lineCoordinates) || lineCoordinates.length < 2) {
      return
    }

    for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
      const fromNodeId = getNodeId(lineCoordinates[index])
      const toNodeId = getNodeId(lineCoordinates[index + 1])
      connectNodes(nodes, adjacency, fromNodeId, toNodeId)
    }
  })

  nodes.forEach((node, nodeId) => {
    const neighborEntries = [...(adjacency.get(nodeId) || new Map()).entries()]
      .sort((first, second) => first[0].localeCompare(second[0]))

    node.neighbors = neighborEntries.map(([neighborId, weight]) => ({
      id: neighborId,
      weight,
    }))
  })

  return { nodes, adjacency, sourceStats }
}

function readNode(nodes, nodeId) {
  return nodes instanceof Map ? nodes.get(nodeId) : nodes?.[nodeId]
}

function readNodeIds(nodes) {
  return nodes instanceof Map ? [...nodes.keys()] : Object.keys(nodes || {})
}

function readNeighborIds(node) {
  if (!node || !Array.isArray(node.neighbors)) {
    return []
  }

  return node.neighbors
    .map((neighbor) => {
      if (typeof neighbor?.id === "string") return neighbor.id
      if (typeof neighbor?.key === "string") return neighbor.key
      return null
    })
    .filter(Boolean)
}

export function testConnectivity(nodes) {
  const visited = new Set()
  const componentByNode = new Map()
  const nodeIds = readNodeIds(nodes)

  if (nodeIds.length === 0) {
    return {
      visited: 0,
      total: 0,
      componentCount: 0,
      componentByNode,
    }
  }

  let componentCount = 0

  function dfs(startNodeId) {
    const stack = [startNodeId]
    while (stack.length > 0) {
      const nodeId = stack.pop()
      if (!nodeId || visited.has(nodeId)) {
        continue
      }

      visited.add(nodeId)
      componentByNode.set(nodeId, componentCount)

      const node = readNode(nodes, nodeId)
      readNeighborIds(node).forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          stack.push(neighborId)
        }
      })
    }
  }

  nodeIds.forEach((nodeId) => {
    if (visited.has(nodeId)) {
      return
    }
    dfs(nodeId)
    componentCount += 1
  })

  return {
    visited: visited.size,
    total: nodeIds.length,
    componentCount,
    componentByNode,
  }
}

function buildGraphObject(nodes, adjacency, connectivity) {
  const graph = {}

  nodes.forEach((node, nodeId) => {
    graph[nodeId] = {
      coord: [node.lat, node.lng],
      componentId: connectivity.componentByNode.get(nodeId) ?? null,
      neighbors: [...(adjacency.get(nodeId) || new Map()).entries()].map(
        ([neighborId, distance]) => ({ key: neighborId, dist: distance })
      ),
    }
  })

  return graph
}

function toCampusId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function collectCoordinatePairs(value, pairs) {
  if (!Array.isArray(value)) {
    return
  }

  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    pairs.push([value[0], value[1]])
    return
  }

  value.forEach((child) => {
    collectCoordinatePairs(child, pairs)
  })
}

function getFeatureAverageCoordinate(feature) {
  const coordinates = feature?.geometry?.coordinates
  if (!coordinates) {
    return null
  }

  const pairs = []
  collectCoordinatePairs(coordinates, pairs)

  if (pairs.length === 0) {
    return null
  }

  let lngSum = 0
  let latSum = 0
  pairs.forEach(([lng, lat]) => {
    lngSum += lng
    latSum += lat
  })

  return [lngSum / pairs.length, latSum / pairs.length]
}

function getFeaturePointOnFeatureCoordinate(feature) {
  try {
    const point = pointOnFeature(feature)
    const [lng, lat] = point?.geometry?.coordinates || []
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return [lng, lat]
    }
  } catch {
    // Fall through to average-coordinate fallback.
  }

  return getFeatureAverageCoordinate(feature)
}

export function findNearestNode(buildingCoord, nodes) {
  if (!(nodes instanceof Map) || !Array.isArray(buildingCoord)) {
    return null
  }

  const [lng, lat] = buildingCoord
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  let nearestNodeId = null
  let minDistance = Number.POSITIVE_INFINITY

  nodes.forEach((node, nodeId) => {
    const nodeLat = Number.isFinite(node?.lat) ? node.lat : node?.coord?.[0]
    const nodeLng = Number.isFinite(node?.lng) ? node.lng : node?.coord?.[1]
    if (!Number.isFinite(nodeLat) || !Number.isFinite(nodeLng)) {
      return
    }

    const distance = haversine({ lat, lng }, { lat: nodeLat, lng: nodeLng })
    if (distance < minDistance) {
      minDistance = distance
      nearestNodeId = nodeId
    }
  })

  return nearestNodeId
}

export function findNearestRoadNode(graph, buildingCoord, options = {}) {
  const [lng, lat] = Array.isArray(buildingCoord) ? buildingCoord : []
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  const allowedComponentIds = options?.allowedComponentIds
  const shouldFilterByComponent =
    allowedComponentIds instanceof Set && allowedComponentIds.size > 0

  const configuredSnapRadius = Number.isFinite(options?.snapRadiusMeters)
    ? Math.max(0, options.snapRadiusMeters)
    : DEFAULT_SNAP_RADIUS_METERS

  let nearestNodeId = null
  let nearestDistance = Number.POSITIVE_INFINITY
  let nearestWithinRadiusNodeId = null
  let nearestWithinRadiusDistance = Number.POSITIVE_INFINITY
  let nearestWithinRadiusDegree = -1

  Object.entries(graph || {}).forEach(([nodeId, node]) => {
    const [nodeLat, nodeLng] = node?.coord || []
    if (!Number.isFinite(nodeLat) || !Number.isFinite(nodeLng)) {
      return
    }

    if (shouldFilterByComponent && !allowedComponentIds.has(node.componentId)) {
      return
    }

    const distance = haversine({ lat, lng }, { lat: nodeLat, lng: nodeLng })
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestNodeId = nodeId
    }

    if (configuredSnapRadius > 0 && distance <= configuredSnapRadius) {
      const nodeDegree = Array.isArray(node?.neighbors) ? node.neighbors.length : 0
      const isBetterDistance = distance < nearestWithinRadiusDistance - 0.001
      const isSimilarDistance = Math.abs(distance - nearestWithinRadiusDistance) <= 2
      const isBetterDegreeTieBreak = isSimilarDistance && nodeDegree > nearestWithinRadiusDegree

      if (isBetterDistance || isBetterDegreeTieBreak) {
        nearestWithinRadiusDistance = distance
        nearestWithinRadiusNodeId = nodeId
        nearestWithinRadiusDegree = nodeDegree
      }
    }
  })

  if (nearestWithinRadiusNodeId) {
    return {
      id: nearestWithinRadiusNodeId,
      distance: nearestWithinRadiusDistance,
    }
  }

  if (!nearestNodeId) {
    return null
  }

  return {
    id: nearestNodeId,
    distance: nearestDistance,
  }
}

function buildBuildingSnapIndex(buildingGeoJsonPayload, graph) {
  const features = Array.isArray(buildingGeoJsonPayload?.features)
    ? buildingGeoJsonPayload.features
    : []
  const snapIndex = new Map()

  features.forEach((feature, index) => {
    const snapSeedCoord = getFeaturePointOnFeatureCoordinate(feature)
    if (!snapSeedCoord) {
      return
    }

    const nearestRoadNode = findNearestRoadNode(graph, snapSeedCoord, {
      snapRadiusMeters: BUILDING_SNAP_RADIUS_METERS,
    })
    if (!nearestRoadNode?.id) {
      return
    }

    const rawId = String(feature?.properties?.id || "")
    const rawName = String(feature?.properties?.name || "")
    const fallbackId = `building_${index}`
    const normalizedId = toCampusId(rawId || rawName || fallbackId)
    const payload = {
      id: nearestRoadNode.id,
      distance: nearestRoadNode.distance,
      coord: snapSeedCoord,
    }

    snapIndex.set(normalizedId, payload)
    if (rawId) {
      snapIndex.set(rawId, payload)
    }
    if (rawName) {
      snapIndex.set(rawName, payload)
    }
  })

  return snapIndex
}

export function getSnappedBuildingRoadNode(graph, buildingId, options = {}) {
  if (!graph || !buildingId) {
    return null
  }

  const snapIndex = buildingSnapIndexByGraph.get(graph)
  if (!snapIndex) {
    return null
  }

  const normalizedId = toCampusId(buildingId)
  const snapEntry = snapIndex.get(normalizedId) || snapIndex.get(buildingId)
  if (!snapEntry?.id) {
    return null
  }

  const allowedComponentIds = options?.allowedComponentIds
  const shouldFilterByComponent =
    allowedComponentIds instanceof Set && allowedComponentIds.size > 0

  if (!shouldFilterByComponent) {
    return snapEntry
  }

  const componentId = graph[snapEntry.id]?.componentId
  if (allowedComponentIds.has(componentId)) {
    return snapEntry
  }

  return Array.isArray(snapEntry.coord)
    ? findNearestRoadNode(graph, snapEntry.coord, options)
    : null
}

export function getRoadGraphConnectivity(graph) {
  const saved = roadGraphConnectivityByGraph.get(graph)
  if (saved) {
    return saved
  }

  const recalculated = testConnectivity(graph)
  roadGraphConnectivityByGraph.set(graph, recalculated)
  return recalculated
}

export function buildRoadPathGraph(roadGeoJsonPayload, buildingGeoJsonPayload = null, options = {}) {
  const { nodes, adjacency, sourceStats } = buildRoadNodes(roadGeoJsonPayload)
  const connectivity = testConnectivity(nodes)
  const graph = buildGraphObject(nodes, adjacency, connectivity)
  const buildingSnapIndex = buildBuildingSnapIndex(buildingGeoJsonPayload, graph)

  roadGraphConnectivityByGraph.set(graph, connectivity)
  buildingSnapIndexByGraph.set(graph, buildingSnapIndex)

  if (sourceStats?.acceptedLineFeatureCount === 0) {
    throw new Error("Road graph build failed: no LineString/MultiLineString features found in Roads.geojson.")
  }

  if (options?.logSourceSummary === true && sourceStats) {
    console.info("[Routing] Road source filter:", {
      totalFeatures: sourceStats.totalFeatures,
      acceptedLineFeatures: sourceStats.acceptedLineFeatureCount,
      ignoredNonLineFeatures: sourceStats.ignoredNonLineFeatureCount,
      geometryTypes: sourceStats.geometryTypeCounts,
    })
  }

  if (sourceStats?.ignoredNonLineFeatureCount > 0) {
    console.warn(
      `[Routing] Ignored ${sourceStats.ignoredNonLineFeatureCount} non-line features while building road graph.`
    )
  }

  if (connectivity.total > 0 && connectivity.visited !== connectivity.total) {
    console.warn(
      `Campus path graph is fragmented: visited ${connectivity.visited} of ${connectivity.total} nodes.`
    )
  }

  return graph
}

export function summarizeRoadGraph(graph) {
  const nodeIds = Object.keys(graph || {})
  if (nodeIds.length === 0) {
    return {
      nodeCount: 0,
      edgeCount: 0,
      componentCount: 0,
      minEdgeMeters: 0,
      maxEdgeMeters: 0,
      averageEdgeMeters: 0,
    }
  }

  const seenEdges = new Set()
  let totalDistance = 0
  let minEdgeMeters = Number.POSITIVE_INFINITY
  let maxEdgeMeters = 0

  nodeIds.forEach((nodeId) => {
    ;(graph[nodeId]?.neighbors || []).forEach(({ key: neighborId, dist }) => {
      const edgeId = [nodeId, neighborId].sort().join("|")
      if (seenEdges.has(edgeId)) {
        return
      }
      seenEdges.add(edgeId)

      if (!Number.isFinite(dist)) {
        return
      }
      totalDistance += dist
      minEdgeMeters = Math.min(minEdgeMeters, dist)
      maxEdgeMeters = Math.max(maxEdgeMeters, dist)
    })
  })

  const connectivity = getRoadGraphConnectivity(graph)
  const edgeCount = seenEdges.size
  const averageEdgeMeters = edgeCount > 0 ? totalDistance / edgeCount : 0

  return {
    nodeCount: nodeIds.length,
    edgeCount,
    componentCount: connectivity.componentCount,
    minEdgeMeters: Number.isFinite(minEdgeMeters) ? minEdgeMeters : 0,
    maxEdgeMeters,
    averageEdgeMeters,
  }
}

export function findNearestRoadProjection(graph, [targetLat, targetLng], options = {}) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
    return null
  }

  const allowedComponentIds = options?.allowedComponentIds
  const shouldFilterByComponent =
    allowedComponentIds instanceof Set && allowedComponentIds.size > 0

  let nearestDistance = Number.POSITIVE_INFINITY
  let bestProjection = null
  const seenEdges = new Set()

  Object.entries(graph || {}).forEach(([nodeId, node]) => {
    const [aLat, aLng] = node?.coord || []
    if (!Number.isFinite(aLat) || !Number.isFinite(aLng)) {
      return
    }

    if (shouldFilterByComponent && !allowedComponentIds.has(node.componentId)) {
      return
    }

    ;(node.neighbors || []).forEach(({ key: neighborId }) => {
      const neighborNode = graph[neighborId]
      if (!neighborNode) {
        return
      }

      if (shouldFilterByComponent && !allowedComponentIds.has(neighborNode.componentId)) {
        return
      }

      const edgeId = [nodeId, neighborId].sort().join("|")
      if (seenEdges.has(edgeId)) {
        return
      }
      seenEdges.add(edgeId)

      const [bLat, bLng] = neighborNode.coord || []
      const projection = projectPointToSegment(targetLat, targetLng, aLat, aLng, bLat, bLng)
      if (!projection) {
        return
      }

      const candidateDistance = distanceMeters(
        targetLat,
        targetLng,
        projection.lat,
        projection.lng
      )
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance
        bestProjection = {
          edgeStartKey: nodeId,
          edgeEndKey: neighborId,
          point: [projection.lat, projection.lng],
          distance: candidateDistance,
          componentId: node.componentId,
        }
      }
    })
  })

  return bestProjection
}

export function injectProjectionNode(baseGraph, projection, tempKey) {
  const workingGraph = {}

  Object.entries(baseGraph || {}).forEach(([nodeId, node]) => {
    workingGraph[nodeId] = {
      coord: Array.isArray(node.coord) ? [...node.coord] : node.coord,
      componentId: node.componentId,
      neighbors: Array.isArray(node.neighbors)
        ? node.neighbors.map(({ key, dist }) => ({ key, dist }))
        : [],
    }
  })

  if (!projection || !Array.isArray(projection.point)) {
    return workingGraph
  }

  const [projLat, projLng] = projection.point
  const startNode = workingGraph[projection.edgeStartKey]
  const endNode = workingGraph[projection.edgeEndKey]

  if (!startNode || !endNode) {
    return workingGraph
  }

  const componentId = Number.isInteger(startNode.componentId)
    ? startNode.componentId
    : endNode.componentId

  workingGraph[tempKey] = {
    coord: [projLat, projLng],
    componentId,
    neighbors: [],
  }

  const distToStart = distanceMeters(projLat, projLng, startNode.coord[0], startNode.coord[1])
  const distToEnd = distanceMeters(projLat, projLng, endNode.coord[0], endNode.coord[1])

  workingGraph[tempKey].neighbors.push(
    { key: projection.edgeStartKey, dist: distToStart },
    { key: projection.edgeEndKey, dist: distToEnd }
  )
  startNode.neighbors.push({ key: tempKey, dist: distToStart })
  endNode.neighbors.push({ key: tempKey, dist: distToEnd })

  return workingGraph
}

function heuristicBetweenNodeKeys(graph, sourceKey, targetKey) {
  const source = graph[sourceKey]
  const target = graph[targetKey]
  if (!source || !target) {
    return Number.POSITIVE_INFINITY
  }
  return distanceMeters(source.coord[0], source.coord[1], target.coord[0], target.coord[1])
}

class MinPriorityQueue {
  constructor() {
    this.heap = []
  }

  get size() {
    return this.heap.length
  }

  push(priority, nodeKey) {
    this.heap.push({ priority, nodeKey })
    this.bubbleUp(this.heap.length - 1)
  }

  pop() {
    if (this.heap.length === 0) {
      return null
    }

    const head = this.heap[0]
    const tail = this.heap.pop()

    if (this.heap.length > 0 && tail) {
      this.heap[0] = tail
      this.bubbleDown(0)
    }

    return head
  }

  bubbleUp(startIndex) {
    let currentIndex = startIndex

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2)
      if (this.heap[parentIndex].priority <= this.heap[currentIndex].priority) {
        return
      }

      ;[this.heap[parentIndex], this.heap[currentIndex]] = [
        this.heap[currentIndex],
        this.heap[parentIndex],
      ]
      currentIndex = parentIndex
    }
  }

  bubbleDown(startIndex) {
    let currentIndex = startIndex

    while (true) {
      const left = currentIndex * 2 + 1
      const right = currentIndex * 2 + 2
      let smallest = currentIndex

      if (left < this.heap.length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left
      }
      if (right < this.heap.length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right
      }

      if (smallest === currentIndex) {
        return
      }

      ;[this.heap[currentIndex], this.heap[smallest]] = [
        this.heap[smallest],
        this.heap[currentIndex],
      ]
      currentIndex = smallest
    }
  }
}

export function dijkstraRoadPathKeys(graph, startKey, endKey) {
  if (!graph?.[startKey] || !graph?.[endKey]) {
    return null
  }

  if (startKey === endKey) {
    return [startKey]
  }

  const distances = {}
  const previous = {}
  const queue = new MinPriorityQueue()

  Object.keys(graph).forEach((nodeId) => {
    distances[nodeId] = Number.POSITIVE_INFINITY
    previous[nodeId] = null
  })

  distances[startKey] = 0
  queue.push(0, startKey)

  while (queue.size > 0) {
    const next = queue.pop()
    if (!next) {
      break
    }

    const { priority: currentDistance, nodeKey: currentNodeId } = next
    if (currentDistance > distances[currentNodeId]) {
      continue
    }

    if (currentNodeId === endKey) {
      break
    }

    ;(graph[currentNodeId]?.neighbors || []).forEach(({ key: neighborId, dist }) => {
      if (!graph[neighborId] || !Number.isFinite(dist)) {
        return
      }

      const tentativeDistance = currentDistance + dist
      if (tentativeDistance >= distances[neighborId]) {
        return
      }

      distances[neighborId] = tentativeDistance
      previous[neighborId] = currentNodeId
      queue.push(tentativeDistance, neighborId)
    })
  }

  if (!Number.isFinite(distances[endKey]) || distances[endKey] === Number.POSITIVE_INFINITY) {
    return null
  }

  const path = []
  let cursor = endKey
  while (cursor) {
    path.unshift(cursor)
    if (cursor === startKey) {
      break
    }
    cursor = previous[cursor]
  }

  return path[0] === startKey ? path : null
}

export function dijkstraRoadPath(graph, startKey, endKey) {
  const pathKeys = dijkstraRoadPathKeys(graph, startKey, endKey)
  if (!pathKeys) {
    return null
  }
  return pathKeys.map((nodeKey) => graph[nodeKey].coord)
}

export function pathLengthFromCoordinates(pathCoordinates) {
  if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) {
    return 0
  }

  let total = 0
  for (let index = 0; index < pathCoordinates.length - 1; index += 1) {
    const from = pathCoordinates[index]
    const to = pathCoordinates[index + 1]
    total += distanceMeters(from[0], from[1], to[0], to[1])
  }

  return total
}

export function astarRoadPath(graph, startKey, endKey) {
  if (!graph?.[startKey] || !graph?.[endKey]) {
    return null
  }

  if (startKey === endKey) {
    return [graph[startKey].coord]
  }

  const openSet = new Set([startKey])
  const cameFrom = {}
  const gScore = {}
  const fScore = {}

  Object.keys(graph).forEach((nodeId) => {
    gScore[nodeId] = Number.POSITIVE_INFINITY
    fScore[nodeId] = Number.POSITIVE_INFINITY
  })

  gScore[startKey] = 0
  fScore[startKey] = heuristicBetweenNodeKeys(graph, startKey, endKey)

  function pickLowestScoreNode() {
    let bestNodeId = null
    openSet.forEach((nodeId) => {
      if (bestNodeId === null || fScore[nodeId] < fScore[bestNodeId]) {
        bestNodeId = nodeId
      }
    })
    return bestNodeId
  }

  while (openSet.size > 0) {
    const currentNodeId = pickLowestScoreNode()
    if (!currentNodeId) {
      return null
    }

    if (currentNodeId === endKey) {
      const pathKeys = [currentNodeId]
      let cursor = currentNodeId
      while (cameFrom[cursor]) {
        cursor = cameFrom[cursor]
        pathKeys.unshift(cursor)
      }
      return pathKeys.map((nodeKey) => graph[nodeKey].coord)
    }

    openSet.delete(currentNodeId)
    const currentDistance = gScore[currentNodeId]

    ;(graph[currentNodeId]?.neighbors || []).forEach(({ key: neighborId, dist }) => {
      if (!graph[neighborId] || !Number.isFinite(dist)) {
        return
      }

      const tentativeScore = currentDistance + dist
      if (tentativeScore >= gScore[neighborId]) {
        return
      }

      cameFrom[neighborId] = currentNodeId
      gScore[neighborId] = tentativeScore
      fScore[neighborId] = tentativeScore + heuristicBetweenNodeKeys(graph, neighborId, endKey)
      openSet.add(neighborId)
    })
  }

  return null
}
