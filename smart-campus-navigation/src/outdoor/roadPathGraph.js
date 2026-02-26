const EARTH_RADIUS_M = 6371000
const ROAD_POINT_PRECISION = 5
const MIN_ROAD_EDGE_METERS = 0.5
const INTERSECTION_EPSILON = 1e-9

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
  return `${lat.toFixed(ROAD_POINT_PRECISION)},${lng.toFixed(ROAD_POINT_PRECISION)}`
}

function toLatLngCoordinatePair(coordinatePair) {
  const [lng, lat] = Array.isArray(coordinatePair) ? coordinatePair : []
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }
  return [lat, lng]
}

function isCoordinatePairEqual(first, second, tolerance = 1e-7) {
  if (!Array.isArray(first) || !Array.isArray(second)) {
    return false
  }

  return (
    Math.abs(first[0] - second[0]) <= tolerance &&
    Math.abs(first[1] - second[1]) <= tolerance
  )
}

function segmentIntersectionPoint(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) {
    return null
  }

  const ax = startA[1]
  const ay = startA[0]
  const bx = endA[1]
  const by = endA[0]
  const cx = startB[1]
  const cy = startB[0]
  const dx = endB[1]
  const dy = endB[0]

  const rX = bx - ax
  const rY = by - ay
  const sX = dx - cx
  const sY = dy - cy
  const denominator = rX * sY - rY * sX

  if (Math.abs(denominator) <= INTERSECTION_EPSILON) {
    return null
  }

  const cMinusAX = cx - ax
  const cMinusAY = cy - ay
  const t = (cMinusAX * sY - cMinusAY * sX) / denominator
  const u = (cMinusAX * rY - cMinusAY * rX) / denominator

  if (
    t < -INTERSECTION_EPSILON ||
    t > 1 + INTERSECTION_EPSILON ||
    u < -INTERSECTION_EPSILON ||
    u > 1 + INTERSECTION_EPSILON
  ) {
    return null
  }

  const intersectionX = ax + t * rX
  const intersectionY = ay + t * rY
  return [intersectionY, intersectionX]
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
  if (t < 0) {
    t = 0
  } else if (t > 1) {
    t = 1
  }

  const projX = ax + abx * t
  const projY = ay + aby * t

  return { lat: projY, lng: projX, t }
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

function getRoadSegments(roadGeoJsonPayload) {
  const lineCoordinateSets = getRoadLineCoordinateSets(roadGeoJsonPayload)
  const segments = []

  lineCoordinateSets.forEach((lineCoordinates) => {
    for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
      const start = toLatLngCoordinatePair(lineCoordinates[index])
      const end = toLatLngCoordinatePair(lineCoordinates[index + 1])
      if (!start || !end) {
        continue
      }

      const [startLat, startLng] = start
      const [endLat, endLng] = end
      if (distanceMeters(startLat, startLng, endLat, endLng) < MIN_ROAD_EDGE_METERS) {
        continue
      }

      segments.push({ start, end })
    }
  })

  return segments
}

function closeRingIfNeeded(ringCoordinates) {
  if (!Array.isArray(ringCoordinates) || ringCoordinates.length < 3) {
    return null
  }

  const normalizedRing = ringCoordinates
    .map((coordinatePair) => toLatLngCoordinatePair(coordinatePair))
    .filter(Boolean)

  if (normalizedRing.length < 3) {
    return null
  }

  if (!isCoordinatePairEqual(normalizedRing[0], normalizedRing[normalizedRing.length - 1])) {
    normalizedRing.push([...normalizedRing[0]])
  }

  return normalizedRing
}

function getBlockingBuildingRings(buildingGeoJsonPayload) {
  const blockedTypes = new Set(["academic", "service", "hostel"])
  const features = Array.isArray(buildingGeoJsonPayload?.features)
    ? buildingGeoJsonPayload.features
    : []
  const rings = []

  features.forEach((feature) => {
    const featureType = feature?.properties?.type
    if (!blockedTypes.has(featureType)) {
      return
    }

    const geometry = feature?.geometry
    if (!geometry) {
      return
    }

    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
      const ring = closeRingIfNeeded(geometry.coordinates[0])
      if (ring) {
        rings.push(ring)
      }
      return
    }

    if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((polygonCoordinates) => {
        const ring = closeRingIfNeeded(polygonCoordinates?.[0])
        if (ring) {
          rings.push(ring)
        }
      })
    }
  })

  return rings
}

function pointInRing(point, ring) {
  if (!Array.isArray(point) || !Array.isArray(ring) || ring.length < 3) {
    return false
  }

  const y = point[0]
  const x = point[1]
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i][0]
    const xi = ring[i][1]
    const yj = ring[j][0]
    const xj = ring[j][1]
    const crossesLatitude = (yi > y) !== (yj > y)

    if (!crossesLatitude) {
      continue
    }

    const slopeDenominator = yj - yi
    const safeDenominator =
      Math.abs(slopeDenominator) < INTERSECTION_EPSILON
        ? INTERSECTION_EPSILON
        : slopeDenominator
    const candidateX = ((xj - xi) * (y - yi)) / safeDenominator + xi

    if (x < candidateX) {
      inside = !inside
    }
  }

  return inside
}

function segmentCrossesRing(start, end, ring) {
  if (!Array.isArray(start) || !Array.isArray(end) || !Array.isArray(ring) || ring.length < 3) {
    return false
  }

  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  if (pointInRing(midpoint, ring)) {
    return true
  }

  for (let index = 0; index < ring.length - 1; index += 1) {
    const ringStart = ring[index]
    const ringEnd = ring[index + 1]
    const intersection = segmentIntersectionPoint(start, end, ringStart, ringEnd)
    if (!intersection) {
      continue
    }

    if (isCoordinatePairEqual(intersection, start) || isCoordinatePairEqual(intersection, end)) {
      continue
    }

    return true
  }

  return false
}

function segmentCrossesBlockingRings(start, end, blockingRings) {
  if (!Array.isArray(blockingRings) || blockingRings.length === 0) {
    return false
  }

  return blockingRings.some((ring) => segmentCrossesRing(start, end, ring))
}

function appendUniqueCoordinate(points, candidate) {
  if (!Array.isArray(candidate)) {
    return
  }

  const exists = points.some((point) => isCoordinatePairEqual(point, candidate))
  if (!exists) {
    points.push(candidate)
  }
}

function computeSegmentProgress(point, start, end) {
  const latSpan = end[0] - start[0]
  const lngSpan = end[1] - start[1]

  if (Math.abs(latSpan) >= Math.abs(lngSpan) && Math.abs(latSpan) > INTERSECTION_EPSILON) {
    return (point[0] - start[0]) / latSpan
  }

  if (Math.abs(lngSpan) > INTERSECTION_EPSILON) {
    return (point[1] - start[1]) / lngSpan
  }

  return 0
}

function syncNeighborsFromAdjacency(graph, adjacency) {
  Object.keys(graph).forEach((nodeKey) => {
    graph[nodeKey].neighbors = [...(adjacency[nodeKey] || new Map()).entries()].map(
      ([neighborKey, weight]) => ({ key: neighborKey, dist: weight })
    )
  })
}

function assignConnectedComponents(graph) {
  const unseenNodeKeys = new Set(Object.keys(graph))
  const components = []

  while (unseenNodeKeys.size > 0) {
    const seedNodeKey = unseenNodeKeys.values().next().value
    const stack = [seedNodeKey]
    const componentNodes = []
    unseenNodeKeys.delete(seedNodeKey)

    while (stack.length > 0) {
      const currentNodeKey = stack.pop()
      componentNodes.push(currentNodeKey)
      graph[currentNodeKey].componentId = components.length

      const neighbors = graph[currentNodeKey]?.neighbors || []
      neighbors.forEach(({ key: neighborNodeKey }) => {
        if (!unseenNodeKeys.has(neighborNodeKey)) {
          return
        }
        unseenNodeKeys.delete(neighborNodeKey)
        stack.push(neighborNodeKey)
      })
    }

    components.push(componentNodes)
  }

  return components.sort((first, second) => second.length - first.length)
}

export function buildRoadPathGraph(roadGeoJsonPayload, buildingGeoJsonPayload = null, options = {}) {
  const rawSegments = getRoadSegments(roadGeoJsonPayload)
  const shouldBlockBuildingCrossings = Boolean(options?.blockBuildingCrossings)
  const blockingRings = shouldBlockBuildingCrossings
    ? getBlockingBuildingRings(buildingGeoJsonPayload)
    : []
  const splitPointsBySegment = rawSegments.map((segment) => [segment.start, segment.end])
  const graph = {}
  const adjacency = {}

  for (let i = 0; i < rawSegments.length; i += 1) {
    for (let j = i + 1; j < rawSegments.length; j += 1) {
      const intersection = segmentIntersectionPoint(
        rawSegments[i].start,
        rawSegments[i].end,
        rawSegments[j].start,
        rawSegments[j].end
      )
      if (!intersection) {
        continue
      }

      appendUniqueCoordinate(splitPointsBySegment[i], intersection)
      appendUniqueCoordinate(splitPointsBySegment[j], intersection)
    }
  }

  function ensureNode([lat, lng]) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null
    }

    const normalizedLat = Number.parseFloat(lat.toFixed(ROAD_POINT_PRECISION))
    const normalizedLng = Number.parseFloat(lng.toFixed(ROAD_POINT_PRECISION))
    const nodeKey = toRoadNodeKey(normalizedLat, normalizedLng)

    if (!graph[nodeKey]) {
      graph[nodeKey] = {
        coord: [normalizedLat, normalizedLng],
        neighbors: [],
        componentId: null,
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

    if (segmentCrossesBlockingRings([aLat, aLng], [bLat, bLng], blockingRings)) {
      return
    }

    const segmentDistance = distanceMeters(aLat, aLng, bLat, bLng)
    if (!Number.isFinite(segmentDistance) || segmentDistance < MIN_ROAD_EDGE_METERS) {
      return
    }

    const existingWeight = adjacency[a].get(b)
    if (existingWeight === undefined || segmentDistance < existingWeight) {
      adjacency[a].set(b, segmentDistance)
      adjacency[b].set(a, segmentDistance)
    }
  }

  rawSegments.forEach((segment, index) => {
    const splitPoints = splitPointsBySegment[index] || []
    const uniquePoints = []
    splitPoints.forEach((point) => appendUniqueCoordinate(uniquePoints, point))

    uniquePoints.sort(
      (first, second) =>
        computeSegmentProgress(first, segment.start, segment.end) -
        computeSegmentProgress(second, segment.start, segment.end)
    )

    for (let pointIndex = 0; pointIndex < uniquePoints.length - 1; pointIndex += 1) {
      const fromNode = ensureNode(uniquePoints[pointIndex])
      const toNode = ensureNode(uniquePoints[pointIndex + 1])
      connectNodes(fromNode, toNode)
    }
  })

  syncNeighborsFromAdjacency(graph, adjacency)
  const components = assignConnectedComponents(graph)

  if (components.length > 1) {
    console.warn(
      `Campus path graph has ${components.length} disconnected segments. ` +
      "Routing is constrained to the active component."
    )
  }

  return graph
}

export function findNearestRoadProjection(graph, [targetLat, targetLng], options = {}) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
    return null
  }

  const allowedComponentIds = options?.allowedComponentIds
  const shouldFilterByComponent =
    allowedComponentIds instanceof Set && allowedComponentIds.size > 0

  let nearestDistance = Number.POSITIVE_INFINITY
  let best = null
  const seenEdges = new Set()

  Object.entries(graph || {}).forEach(([nodeKey, node]) => {
    const [aLat, aLng] = node.coord || []
    if (!Number.isFinite(aLat) || !Number.isFinite(aLng)) {
      return
    }

    if (shouldFilterByComponent && !allowedComponentIds.has(node.componentId)) {
      return
    }

    ;(node.neighbors || []).forEach(({ key: neighborKey }) => {
      const neighbor = graph[neighborKey]
      if (!neighbor) {
        return
      }

      if (shouldFilterByComponent && !allowedComponentIds.has(neighbor.componentId)) {
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
          componentId: node.componentId,
        }
      }
    })
  })

  return best
}

export function injectProjectionNode(baseGraph, projection, tempKey) {
  const workingGraph = {}

  Object.entries(baseGraph || {}).forEach(([nodeKey, node]) => {
    workingGraph[nodeKey] = {
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
  const { edgeStartKey, edgeEndKey } = projection
  const startNode = workingGraph[edgeStartKey]
  const endNode = workingGraph[edgeEndKey]

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
    { key: edgeStartKey, dist: distToStart },
    { key: edgeEndKey, dist: distToEnd }
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

  function pickLowestScoreNode() {
    let bestNode = null
    openSet.forEach((nodeKey) => {
      if (bestNode === null || fScore[nodeKey] < fScore[bestNode]) {
        bestNode = nodeKey
      }
    })
    return bestNode
  }

  Object.keys(graph).forEach((nodeKey) => {
    gScore[nodeKey] = Number.POSITIVE_INFINITY
    fScore[nodeKey] = Number.POSITIVE_INFINITY
  })

  gScore[startKey] = 0
  fScore[startKey] = heuristicBetweenNodeKeys(graph, startKey, endKey)

  while (openSet.size > 0) {
    const currentKey = pickLowestScoreNode()
    if (!currentKey) {
      return null
    }

    if (currentKey === endKey) {
      const pathKeys = [currentKey]
      let cursor = currentKey
      while (cameFrom[cursor]) {
        cursor = cameFrom[cursor]
        pathKeys.unshift(cursor)
      }
      return pathKeys.map((nodeKey) => graph[nodeKey].coord)
    }

    openSet.delete(currentKey)
    const currentDistance = gScore[currentKey]
    const neighbors = graph[currentKey]?.neighbors || []

    neighbors.forEach(({ key: neighborKey, dist }) => {
      if (!graph[neighborKey] || !Number.isFinite(dist)) {
        return
      }

      const tentativeScore = currentDistance + dist
      if (tentativeScore >= gScore[neighborKey]) {
        return
      }

      cameFrom[neighborKey] = currentKey
      gScore[neighborKey] = tentativeScore
      fScore[neighborKey] = tentativeScore + heuristicBetweenNodeKeys(graph, neighborKey, endKey)
      openSet.add(neighborKey)
    })
  }

  return null
}
