export function simulateRouteProgress(
  path,
  nodes,
  onUpdate,
  options = {}
) {
  const intervalMs = options.intervalMs ?? 650
  const stepsPerEdge = options.stepsPerEdge ?? 5
  const startNodeIndex = options.startNodeIndex ?? 0

  if (!Array.isArray(path) || path.length < 2) {
    return () => {}
  }

  let edgeIndex = Math.min(Math.max(startNodeIndex, 0), path.length - 2)
  let stepIndex = 0
  let stopped = false

  const emitCurrentPosition = () => {
    const fromNode = nodes[path[edgeIndex]]
    const toNode = nodes[path[edgeIndex + 1]]

    if (!fromNode || !toNode) {
      return
    }

    const progress = Math.min(1, stepIndex / stepsPerEdge)
    const lat = fromNode.lat + (toNode.lat - fromNode.lat) * progress
    const lng = fromNode.lng + (toNode.lng - fromNode.lng) * progress

    onUpdate({
      lat,
      lng,
      fromNodeId: path[edgeIndex],
      toNodeId: path[edgeIndex + 1],
      progress,
      edgeIndex,
      done: false,
    })
  }

  const stop = () => {
    stopped = true
    if (timerId) {
      clearInterval(timerId)
    }
  }

  emitCurrentPosition()

  const timerId = setInterval(() => {
    if (stopped) {
      return
    }

    stepIndex += 1
    emitCurrentPosition()

    if (stepIndex <= stepsPerEdge) {
      return
    }

    edgeIndex += 1
    stepIndex = 0

    if (edgeIndex >= path.length - 1) {
      const destinationNodeId = path[path.length - 1]
      const destinationNode = nodes[destinationNodeId]

      if (destinationNode) {
        onUpdate({
          lat: destinationNode.lat,
          lng: destinationNode.lng,
          nodeId: destinationNodeId,
          done: true,
        })
      }

      stop()
    }
  }, intervalMs)

  return stop
}
