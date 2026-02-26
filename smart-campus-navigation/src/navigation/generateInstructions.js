export function generateInstructions(path, nodes, edgeDetails) {
  if (!Array.isArray(path) || path.length === 0) {
    return []
  }

  if (path.length === 1) {
    const onlyNode = nodes[path[0]]
    if (!onlyNode) {
      return ["You are already at your destination."]
    }

    return [
      `You are already at ${onlyNode.name} (${onlyNode.building}, Floor ${onlyNode.floor}).`,
    ]
  }

  const instructions = []
  const startNode = nodes[path[0]]
  const destinationNode = nodes[path[path.length - 1]]

  if (startNode) {
    instructions.push(
      `Start at ${startNode.name} in ${startNode.building} on Floor ${startNode.floor}.`
    )
  }

  for (let index = 0; index < path.length - 1; index += 1) {
    const currentId = path[index]
    const nextId = path[index + 1]
    const currentNode = nodes[currentId]
    const nextNode = nodes[nextId]
    const edge = edgeDetails[currentId]?.[nextId]

    if (!currentNode || !nextNode || !edge) {
      continue
    }

    if (currentNode.floor !== nextNode.floor) {
      if (edge.mode === "stairs") {
        instructions.push(`Take the stairs to Floor ${nextNode.floor}.`)
      } else if (edge.mode === "elevator") {
        instructions.push(`Take the elevator to Floor ${nextNode.floor}.`)
      } else {
        instructions.push(`Proceed to Floor ${nextNode.floor}.`)
      }
      continue
    }

    if (currentNode.building !== nextNode.building) {
      instructions.push(`Proceed toward ${nextNode.building}.`)
      continue
    }

    if (nextNode.kind === "connector") {
      instructions.push(`Move to ${nextNode.name} on Floor ${nextNode.floor}.`)
    }
  }

  if (destinationNode) {
    instructions.push(
      `You have arrived at ${destinationNode.name} in ${destinationNode.building} on Floor ${destinationNode.floor}.`
    )
  } else {
    instructions.push("You have arrived at your destination.")
  }

  return instructions
}
