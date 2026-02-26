function cloneGraph(graph) {
  const cloned = {}

  Object.entries(graph).forEach(([nodeId, neighbors]) => {
    cloned[nodeId] = { ...neighbors }
  })

  return cloned
}

function removeNode(graph, nodeId) {
  if (!graph[nodeId]) {
    return
  }

  delete graph[nodeId]

  Object.values(graph).forEach((neighbors) => {
    if (neighbors[nodeId] !== undefined) {
      delete neighbors[nodeId]
    }
  })
}

function getBlockedNodes(nodes, preference) {
  const blockedNodeIds = new Set()

  Object.entries(nodes).forEach(([nodeId, node]) => {
    if (node.kind !== "connector") {
      return
    }

    if (preference === "noStairs" && node.connectorType === "stairs") {
      blockedNodeIds.add(nodeId)
    }

    if (preference === "liftOnly" && node.connectorType !== "elevator") {
      blockedNodeIds.add(nodeId)
    }
  })

  return blockedNodeIds
}

export function buildConstrainedGraph(baseGraph, nodes, preference = "default") {
  if (preference === "default") {
    return cloneGraph(baseGraph)
  }

  const constrainedGraph = cloneGraph(baseGraph)
  const blockedNodeIds = getBlockedNodes(nodes, preference)

  blockedNodeIds.forEach((nodeId) => {
    removeNode(constrainedGraph, nodeId)
  })

  return constrainedGraph
}
