export function dijkstra(graph, start, end) {
  if (!graph[start] || !graph[end]) {
    return []
  }

  if (start === end) {
    return [start]
  }

  const distances = {}
  const previous = {}
  const visited = {}
  const queue = new Set(Object.keys(graph))

  queue.forEach((nodeId) => {
    distances[nodeId] = Number.POSITIVE_INFINITY
    previous[nodeId] = null
  })

  distances[start] = 0

  while (queue.size > 0) {
    let closestNode = null

    queue.forEach((nodeId) => {
      if (closestNode === null || distances[nodeId] < distances[closestNode]) {
        closestNode = nodeId
      }
    })

    if (closestNode === null || distances[closestNode] === Number.POSITIVE_INFINITY) {
      break
    }

    if (closestNode === end) {
      break
    }

    queue.delete(closestNode)
    visited[closestNode] = true

    Object.keys(graph[closestNode]).forEach((neighborId) => {
      if (visited[neighborId]) {
        return
      }

      const newDistance = distances[closestNode] + graph[closestNode][neighborId]

      if (newDistance < distances[neighborId]) {
        distances[neighborId] = newDistance
        previous[neighborId] = closestNode
      }
    })
  }

  const path = []
  let current = end

  while (current !== null) {
    path.unshift(current)
    current = previous[current]
  }

  if (path[0] !== start) {
    return []
  }

  return path
}

export function calculatePathDistance(graph, path) {
  if (!Array.isArray(path) || path.length < 2) {
    return 0
  }

  let total = 0

  for (let i = 0; i < path.length - 1; i += 1) {
    const fromId = path[i]
    const toId = path[i + 1]
    const edgeWeight = graph[fromId]?.[toId]

    if (typeof edgeWeight !== "number") {
      return Number.POSITIVE_INFINITY
    }

    total += edgeWeight
  }

  return total
}
