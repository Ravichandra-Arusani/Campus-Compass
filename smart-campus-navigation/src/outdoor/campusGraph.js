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
  if (graph?.srujan_block) {
    return "srujan_block"
  }
  const firstRoadNodeId = Object.keys(graph || {}).find((nodeId) =>
    nodeId.startsWith(ROAD_NODE_PREFIX)
  )
  return firstRoadNodeId || Object.keys(graph || {})[0] || null
}
