import turfCentroid from "@turf/centroid"
import pointOnFeature from "@turf/point-on-feature"

const EARTH_RADIUS_M = 6371000
const ROAD_NODE_PREFIX = "road_"

const LEGACY_ID_ALIASES = {
  avishkar: "avishkar_block",
  main_entrance: "main_entrance",
  nalanda_block: "nalanda_hall",
  parking: "vbit_parking",
  srujun_block: "srujan_block",
  prathim_block: "pratham_block2",
}

function toCampusId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function toCanonicalCampusId(value) {
  const normalizedId = toCampusId(value)
  return LEGACY_ID_ALIASES[normalizedId] || normalizedId
}

function getFeatureId(feature) {
  return toCanonicalCampusId(feature?.properties?.id || feature?.properties?.name)
}

function getDisplayLabel(nodeId, featureById) {
  const featureName = featureById[nodeId]?.properties?.name
  if (featureName) {
    return featureName
  }
  if (nodeId.startsWith(ROAD_NODE_PREFIX)) {
    return "Road Node"
  }
  return nodeId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function computeFeatureCentroid(feature) {
  try {
    const computed = pointOnFeature(feature)
    const [lng, lat] = computed?.geometry?.coordinates || []
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null
    }
    return { x: lat, y: lng }
  } catch {
    // Fall through to centroid fallback.
  }

  try {
    const computed = turfCentroid(feature)
    const [lng, lat] = computed?.geometry?.coordinates || []
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null
    }
    return { x: lat, y: lng }
  } catch {
    return null
  }
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function distanceMeters(a, b) {
  const lat1 = toRadians(a.x)
  const lat2 = toRadians(b.x)
  const dLat = toRadians(b.x - a.x)
  const dLng = toRadians(b.y - a.y)
  const haversineValue =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const arc = 2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))
  return Math.max(1, Math.round(EARTH_RADIUS_M * arc))
}

function buildCentroidIndex(geoJsonPayload) {
  const features = Array.isArray(geoJsonPayload?.features) ? geoJsonPayload.features : []
  const centroidById = {}
  const featureById = {}

  features.forEach((feature) => {
    const id = getFeatureId(feature)
    if (!id || centroidById[id]) {
      return
    }
    const centroid = computeFeatureCentroid(feature)
    if (!centroid) {
      return
    }
    centroidById[id] = centroid
    featureById[id] = feature
  })

  return { centroidById, featureById }
}

function coordinateKey(lat, lng) {
  // 1e-5 deg ~= 1.1m, enough to merge hand-drawn overlap points.
  return `${lat.toFixed(5)}|${lng.toFixed(5)}`
}

function extractRoadLines(roadGeoJsonPayload) {
  const features = Array.isArray(roadGeoJsonPayload?.features)
    ? roadGeoJsonPayload.features
    : []
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
      geometry.coordinates.forEach((line) => {
        if (Array.isArray(line)) {
          lineCoordinateSets.push(line)
        }
      })
    }
  })

  return lineCoordinateSets
}

function buildRoadNetwork(roadGeoJsonPayload) {
  const lineCoordinateSets = extractRoadLines(roadGeoJsonPayload)
  const roadNodeIdByKey = new Map()
  const roadNodes = {}
  const roadAdjacency = {}
  let roadIndex = 0

  function ensureRoadNode(lat, lng) {
    const key = coordinateKey(lat, lng)
    const existingRoadNodeId = roadNodeIdByKey.get(key)
    if (existingRoadNodeId) {
      return existingRoadNodeId
    }

    const roadNodeId = `${ROAD_NODE_PREFIX}${roadIndex}`
    roadIndex += 1
    roadNodeIdByKey.set(key, roadNodeId)
    roadNodes[roadNodeId] = {
      x: Number.parseFloat(lat.toFixed(7)),
      y: Number.parseFloat(lng.toFixed(7)),
    }
    return roadNodeId
  }

  function connectRoadNodes(a, b) {
    if (!a || !b || a === b) {
      return
    }
    roadAdjacency[a] = roadAdjacency[a] || new Set()
    roadAdjacency[b] = roadAdjacency[b] || new Set()
    roadAdjacency[a].add(b)
    roadAdjacency[b].add(a)
  }

  lineCoordinateSets.forEach((lineCoordinates) => {
    let previousRoadNodeId = null

    lineCoordinates.forEach((coordinatePair) => {
      const [lng, lat] = Array.isArray(coordinatePair) ? coordinatePair : []
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return
      }

      const roadNodeId = ensureRoadNode(lat, lng)
      connectRoadNodes(previousRoadNodeId, roadNodeId)
      previousRoadNodeId = roadNodeId
    })
  })

  return { roadNodes, roadAdjacency }
}

function ensureAdjacencyEntry(adjacency, id) {
  adjacency[id] = adjacency[id] || new Set()
}

function addBidirectionalEdge(adjacency, a, b, allNodes) {
  if (!allNodes[a] || !allNodes[b] || a === b) {
    return
  }
  ensureAdjacencyEntry(adjacency, a)
  ensureAdjacencyEntry(adjacency, b)
  adjacency[a].add(b)
  adjacency[b].add(a)
}

function getNearestNodeIds(origin, candidates, count) {
  if (!origin || !Array.isArray(candidates) || candidates.length === 0) {
    return []
  }

  return candidates
    .map((candidate) => ({
      id: candidate.id,
      distance: distanceMeters(origin, candidate),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((entry) => entry.id)
}

export function buildCampusGraphFromGeoJson(buildingGeoJsonPayload, roadGeoJsonPayload = null) {
  const { centroidById, featureById } = buildCentroidIndex(buildingGeoJsonPayload)
  const { roadNodes, roadAdjacency } = buildRoadNetwork(roadGeoJsonPayload)

  const allNodes = {
    ...centroidById,
    ...roadNodes,
  }
  const adjacency = {}

  // Road-to-road edges from drawn LineString geometry.
  Object.entries(roadAdjacency).forEach(([roadNodeId, roadNeighborIds]) => {
    roadNeighborIds.forEach((neighborRoadNodeId) => {
      addBidirectionalEdge(adjacency, roadNodeId, neighborRoadNodeId, allNodes)
    })
  })

  const buildingIds = Object.keys(centroidById)
  const roadCandidates = Object.entries(roadNodes).map(([id, node]) => ({
    id,
    x: node.x,
    y: node.y,
  }))

  // Snap each building centroid to its nearest road nodes.
  if (roadCandidates.length > 0) {
    buildingIds.forEach((buildingId) => {
      const buildingNode = centroidById[buildingId]
      const nearestRoadNodeIds = getNearestNodeIds(buildingNode, roadCandidates, 2)
      nearestRoadNodeIds.forEach((roadNodeId) => {
        addBidirectionalEdge(adjacency, buildingId, roadNodeId, allNodes)
      })
    })
  } else {
    // Fallback if road data is unavailable: connect each building to 3 nearest buildings.
    const buildingCandidates = buildingIds.map((id) => ({ id, ...centroidById[id] }))
    buildingIds.forEach((buildingId) => {
      const nearestBuildingIds = getNearestNodeIds(centroidById[buildingId], buildingCandidates, 4)
      nearestBuildingIds
        .filter((candidateBuildingId) => candidateBuildingId !== buildingId)
        .forEach((neighborBuildingId) => {
          addBidirectionalEdge(adjacency, buildingId, neighborBuildingId, allNodes)
        })
    })
  }

  const graph = {}
  Object.entries(adjacency).forEach(([nodeId, neighbors]) => {
    if (!allNodes[nodeId]) {
      return
    }
    graph[nodeId] = {
      x: allNodes[nodeId].x,
      y: allNodes[nodeId].y,
      label: getDisplayLabel(nodeId, featureById),
      neighbors: [...neighbors].sort().map((neighborNodeId) => ({
        id: neighborNodeId,
        weight: distanceMeters(allNodes[nodeId], allNodes[neighborNodeId]),
      })),
    }
  })

  return graph
}

export function resolveOutdoorStartNodeId(graph) {
  // Use a well-connected central node as default start (srujan_block road entrance)
  const DEFAULT_START = "17.470575|78.721449"
  if (graph?.[DEFAULT_START]) {
    return DEFAULT_START
  }
  const firstRoadNodeId = Object.keys(graph || {}).find((nodeId) =>
    nodeId.startsWith(ROAD_NODE_PREFIX)
  )
  return firstRoadNodeId || Object.keys(graph || {})[0] || null
}

// Road graph derived directly from Roads.geojson — 28 nodes, 31 undirected edges.
// Coordinates match the actual campus GeoJSON features.
export const CAMPUS_GRAPH_NODES = Object.freeze({
  "17.469786|78.721342": { lat: 17.469786, lng: 78.721342 },
  "17.469826|78.723180": { lat: 17.469826, lng: 78.723180 },
  "17.469897|78.723295": { lat: 17.469897, lng: 78.723295 },
  "17.469905|78.723189": { lat: 17.469905, lng: 78.723189 },
  "17.469944|78.722840": { lat: 17.469944, lng: 78.722840 },
  "17.469951|78.721754": { lat: 17.469951, lng: 78.721754 },
  "17.469989|78.722419": { lat: 17.469989, lng: 78.722419 },
  "17.469999|78.721380": { lat: 17.469999, lng: 78.721380 },
  "17.470035|78.722028": { lat: 17.470035, lng: 78.722028 },
  "17.470056|78.721792": { lat: 17.470056, lng: 78.721792 },
  "17.470261|78.721415": { lat: 17.470261, lng: 78.721415 },
  "17.470392|78.721797": { lat: 17.470392, lng: 78.721797 },
  "17.470445|78.723398": { lat: 17.470445, lng: 78.723398 },
  "17.470500|78.721891": { lat: 17.470500, lng: 78.721891 },
  "17.470541|78.721728": { lat: 17.470541, lng: 78.721728 },
  "17.470575|78.721449": { lat: 17.470575, lng: 78.721449 },
  "17.470578|78.721872": { lat: 17.470578, lng: 78.721872 },
  "17.470632|78.721810": { lat: 17.470632, lng: 78.721810 },
  "17.470833|78.721480": { lat: 17.470833, lng: 78.721480 },
  "17.470987|78.723604": { lat: 17.470987, lng: 78.723604 },
  "17.470998|78.723508": { lat: 17.470998, lng: 78.723508 },
  "17.471109|78.721523": { lat: 17.471109, lng: 78.721523 },
  "17.471116|78.723026": { lat: 17.471116, lng: 78.723026 },
  "17.471275|78.722199": { lat: 17.471275, lng: 78.722199 },
  "17.471312|78.721952": { lat: 17.471312, lng: 78.721952 },
  "17.471348|78.721702": { lat: 17.471348, lng: 78.721702 },
  "17.471363|78.721552": { lat: 17.471363, lng: 78.721552 },
  "17.471386|78.721486": { lat: 17.471386, lng: 78.721486 },
})

export const CAMPUS_GRAPH_ADJACENCY = Object.freeze({
  "17.469786|78.721342": ["17.469999|78.721380"],
  "17.469826|78.723180": ["17.469905|78.723189"],
  "17.469897|78.723295": ["17.469905|78.723189", "17.470445|78.723398"],
  "17.469905|78.723189": ["17.469826|78.723180", "17.469897|78.723295", "17.469944|78.722840"],
  "17.469944|78.722840": ["17.469905|78.723189", "17.469989|78.722419"],
  "17.469951|78.721754": ["17.469999|78.721380", "17.470056|78.721792"],
  "17.469989|78.722419": ["17.469944|78.722840", "17.470035|78.722028"],
  "17.469999|78.721380": ["17.469786|78.721342", "17.469951|78.721754", "17.470261|78.721415"],
  "17.470035|78.722028": ["17.469989|78.722419", "17.470056|78.721792"],
  "17.470056|78.721792": ["17.469951|78.721754", "17.470035|78.722028", "17.470392|78.721797"],
  "17.470261|78.721415": ["17.469999|78.721380", "17.470575|78.721449"],
  "17.470392|78.721797": ["17.470056|78.721792", "17.470500|78.721891", "17.470541|78.721728"],
  "17.470445|78.723398": ["17.469897|78.723295", "17.470998|78.723508"],
  "17.470500|78.721891": ["17.470392|78.721797", "17.470578|78.721872"],
  "17.470541|78.721728": ["17.470392|78.721797", "17.470575|78.721449", "17.470632|78.721810"],
  "17.470575|78.721449": ["17.470261|78.721415", "17.470541|78.721728", "17.470833|78.721480"],
  "17.470578|78.721872": ["17.470500|78.721891", "17.470632|78.721810"],
  "17.470632|78.721810": ["17.470541|78.721728", "17.470578|78.721872", "17.471312|78.721952"],
  "17.470833|78.721480": ["17.470575|78.721449", "17.471109|78.721523"],
  "17.470987|78.723604": ["17.470998|78.723508"],
  "17.470998|78.723508": ["17.470445|78.723398", "17.470987|78.723604", "17.471116|78.723026"],
  "17.471109|78.721523": ["17.470833|78.721480", "17.471363|78.721552"],
  "17.471116|78.723026": ["17.470998|78.723508", "17.471275|78.722199"],
  "17.471275|78.722199": ["17.471116|78.723026", "17.471312|78.721952"],
  "17.471312|78.721952": ["17.470632|78.721810", "17.471275|78.722199", "17.471348|78.721702"],
  "17.471348|78.721702": ["17.471312|78.721952", "17.471363|78.721552"],
  "17.471363|78.721552": ["17.471109|78.721523", "17.471348|78.721702", "17.471386|78.721486"],
  "17.471386|78.721486": ["17.471363|78.721552"],
})

function resolveGraphSource(graphOverride) {
  const nodes = graphOverride?.nodes || CAMPUS_GRAPH_NODES
  const adjacency = graphOverride?.adjacency || CAMPUS_GRAPH_ADJACENCY
  return { nodes, adjacency }
}

function distanceLatLngMeters(aLat, aLng, bLat, bLng) {
  return distanceMeters({ x: aLat, y: aLng }, { x: bLat, y: bLng })
}

export function snapToNearestNode(lat, lng, graphOverride = null, maxSnapMeters = 40) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  const { nodes } = resolveGraphSource(graphOverride)
  let bestKey = null
  let bestDist = Number.POSITIVE_INFINITY
  let bestCoords = null

  Object.entries(nodes).forEach(([key, node]) => {
    const nodeLat = node?.lat
    const nodeLng = node?.lng
    if (!Number.isFinite(nodeLat) || !Number.isFinite(nodeLng)) {
      return
    }
    const dist = distanceLatLngMeters(lat, lng, nodeLat, nodeLng)
    if (dist < bestDist) {
      bestDist = dist
      bestKey = key
      bestCoords = [nodeLat, nodeLng]
    }
  })

  if (!bestKey || !Number.isFinite(bestDist) || bestDist > maxSnapMeters) {
    return null
  }

  return {
    key: bestKey,
    coords: bestCoords,
    dist: bestDist,
  }
}

export function dijkstra(startKey, endKey, graphOverride = null) {
  if (!startKey || !endKey) {
    return null
  }

  const { nodes, adjacency } = resolveGraphSource(graphOverride)
  if (!nodes[startKey] || !nodes[endKey]) {
    return null
  }
  if (startKey === endKey) {
    const onlyNode = nodes[startKey]
    return [[onlyNode.lat, onlyNode.lng]]
  }

  const distances = {}
  const previous = {}
  const visited = new Set()
  const queue = [[0, startKey]]

  Object.keys(nodes).forEach((nodeKey) => {
    distances[nodeKey] = Number.POSITIVE_INFINITY
    previous[nodeKey] = null
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

    const neighbors = adjacency[currentKey] || []
    neighbors.forEach((neighborKey) => {
      if (!nodes[neighborKey]) {
        return
      }
      const currentNode = nodes[currentKey]
      const neighborNode = nodes[neighborKey]
      const edgeCost = distanceLatLngMeters(
        currentNode.lat,
        currentNode.lng,
        neighborNode.lat,
        neighborNode.lng
      )
      const nextDistance = distanceSoFar + edgeCost
      if (nextDistance < distances[neighborKey]) {
        distances[neighborKey] = nextDistance
        previous[neighborKey] = currentKey
        queue.push([nextDistance, neighborKey])
      }
    })
  }

  if (!Number.isFinite(distances[endKey]) || distances[endKey] === Number.POSITIVE_INFINITY) {
    return null
  }

  const path = []
  let cursor = endKey
  while (cursor) {
    const node = nodes[cursor]
    if (!node) {
      return null
    }
    path.unshift([node.lat, node.lng])
    if (cursor === startKey) {
      break
    }
    cursor = previous[cursor]
  }

  return path.length > 1 ? path : null
}
