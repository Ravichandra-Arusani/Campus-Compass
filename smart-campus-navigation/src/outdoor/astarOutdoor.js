const EARTH_RADIUS_M = 6371000

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function heuristic(a, b) {
  const lat1 = toRadians(a.x)
  const lat2 = toRadians(b.x)
  const dLat = toRadians(b.x - a.x)
  const dLng = toRadians(b.y - a.y)

  const haversineValue =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const arc = 2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))

  return EARTH_RADIUS_M * arc
}

function reconstructPath(cameFrom, current) {
  const path = [current]

  while (cameFrom[current]) {
    current = cameFrom[current]
    path.unshift(current)
  }

  return path
}

function pickLowestScoreNode(openSet, fScore) {
  let bestNode = null

  openSet.forEach((nodeId) => {
    if (bestNode === null) {
      bestNode = nodeId
      return
    }

    if (fScore[nodeId] < fScore[bestNode]) {
      bestNode = nodeId
      return
    }

    if (fScore[nodeId] === fScore[bestNode] && nodeId < bestNode) {
      bestNode = nodeId
    }
  })

  return bestNode
}

export function astar(graph, startId, endId) {
  if (!graph[startId] || !graph[endId]) {
    return []
  }

  if (startId === endId) {
    return [startId]
  }

  const openSet = new Set([startId])
  const cameFrom = {}
  const gScore = {}
  const fScore = {}

  Object.keys(graph).forEach((nodeId) => {
    gScore[nodeId] = Number.POSITIVE_INFINITY
    fScore[nodeId] = Number.POSITIVE_INFINITY
  })

  gScore[startId] = 0
  fScore[startId] = heuristic(graph[startId], graph[endId])

  while (openSet.size > 0) {
    const current = pickLowestScoreNode(openSet, fScore)
    if (!current) {
      return []
    }

    if (current === endId) {
      return reconstructPath(cameFrom, current)
    }

    openSet.delete(current)

    for (const neighbor of graph[current].neighbors) {
      const tentativeG = gScore[current] + neighbor.weight

      if (tentativeG < gScore[neighbor.id]) {
        cameFrom[neighbor.id] = current
        gScore[neighbor.id] = tentativeG
        fScore[neighbor.id] = tentativeG + heuristic(graph[neighbor.id], graph[endId])
        openSet.add(neighbor.id)
      }
    }
  }

  return []
}
