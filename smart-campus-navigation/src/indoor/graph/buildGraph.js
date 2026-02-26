function distanceBetweenPoints(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function buildGraph(nodes, edges) {
  const graph = {}

  nodes.forEach((node) => {
    graph[node.id] = {
      ...node,
      neighbors: [],
    }
  })

  edges.forEach((edge) => {
    if (!graph[edge.from] || !graph[edge.to]) {
      return
    }

    const parsedWeight = Number(edge.weight)
    const weight = Number.isFinite(parsedWeight) && parsedWeight > 0
      ? parsedWeight
      : distanceBetweenPoints(graph[edge.from], graph[edge.to])

    graph[edge.from].neighbors.push({
      id: edge.to,
      weight,
      mode: edge.mode || null,
    })
  })

  Object.keys(graph).forEach((nodeId) => {
    graph[nodeId].neighbors.sort((first, second) => first.id.localeCompare(second.id))
  })

  return graph
}
