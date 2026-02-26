const METERS_PER_DEGREE_LAT = 111320

function toProjectedXY(position, referenceLatRadians) {
  const x = position.lng * METERS_PER_DEGREE_LAT * Math.cos(referenceLatRadians)
  const y = position.lat * METERS_PER_DEGREE_LAT
  return { x, y }
}

export function distanceBetweenPositionsMeters(from, to) {
  if (!from || !to) {
    return Number.POSITIVE_INFINITY
  }

  const referenceLatRadians = ((from.lat + to.lat) / 2) * (Math.PI / 180)
  const fromXY = toProjectedXY(from, referenceLatRadians)
  const toXY = toProjectedXY(to, referenceLatRadians)
  const deltaX = fromXY.x - toXY.x
  const deltaY = fromXY.y - toXY.y

  return Math.sqrt(deltaX ** 2 + deltaY ** 2)
}

export function distancePointToSegmentMeters(point, start, end) {
  if (!point || !start || !end) {
    return Number.POSITIVE_INFINITY
  }

  const referenceLatRadians =
    ((point.lat + start.lat + end.lat) / 3) * (Math.PI / 180)

  const pointXY = toProjectedXY(point, referenceLatRadians)
  const startXY = toProjectedXY(start, referenceLatRadians)
  const endXY = toProjectedXY(end, referenceLatRadians)

  const segmentX = endXY.x - startXY.x
  const segmentY = endXY.y - startXY.y
  const pointVectorX = pointXY.x - startXY.x
  const pointVectorY = pointXY.y - startXY.y
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2

  if (segmentLengthSquared === 0) {
    return Math.sqrt(pointVectorX ** 2 + pointVectorY ** 2)
  }

  const projectionRatio = Math.max(
    0,
    Math.min(
      1,
      (pointVectorX * segmentX + pointVectorY * segmentY) /
        segmentLengthSquared
    )
  )

  const closestX = startXY.x + segmentX * projectionRatio
  const closestY = startXY.y + segmentY * projectionRatio
  const deltaX = pointXY.x - closestX
  const deltaY = pointXY.y - closestY

  return Math.sqrt(deltaX ** 2 + deltaY ** 2)
}

export function distanceToRouteMeters(position, routeNodeIds, nodes) {
  if (!position || !Array.isArray(routeNodeIds) || routeNodeIds.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  if (routeNodeIds.length === 1) {
    const node = nodes[routeNodeIds[0]]
    return node ? distanceBetweenPositionsMeters(position, node) : Number.POSITIVE_INFINITY
  }

  let minimumDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < routeNodeIds.length - 1; index += 1) {
    const startNode = nodes[routeNodeIds[index]]
    const endNode = nodes[routeNodeIds[index + 1]]

    if (!startNode || !endNode) {
      continue
    }

    const edgeDistance = distancePointToSegmentMeters(position, startNode, endNode)
    if (edgeDistance < minimumDistance) {
      minimumDistance = edgeDistance
    }
  }

  return minimumDistance
}

export function findNearestNodeId(position, candidateNodeIds, nodes) {
  if (!position || !Array.isArray(candidateNodeIds) || candidateNodeIds.length === 0) {
    return null
  }

  let nearestNodeId = null
  let nearestDistance = Number.POSITIVE_INFINITY

  candidateNodeIds.forEach((nodeId) => {
    const node = nodes[nodeId]
    if (!node) {
      return
    }

    const distance = distanceBetweenPositionsMeters(position, node)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestNodeId = nodeId
    }
  })

  return nearestNodeId
}

export function offsetPositionMeters(position, northMeters, eastMeters) {
  if (!position) {
    return null
  }

  const latRadians = position.lat * (Math.PI / 180)
  const deltaLat = northMeters / METERS_PER_DEGREE_LAT
  const denominator = METERS_PER_DEGREE_LAT * Math.cos(latRadians)
  const safeDenominator = Math.abs(denominator) < 1e-6 ? 1e-6 : denominator
  const deltaLng = eastMeters / safeDenominator

  return {
    lat: position.lat + deltaLat,
    lng: position.lng + deltaLng,
  }
}
