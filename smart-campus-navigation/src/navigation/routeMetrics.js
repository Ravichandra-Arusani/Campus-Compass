const HORIZONTAL_SPEED_METERS_PER_SECOND = 1.4
const STAIRS_SPEED_METERS_PER_SECOND = 0.6
const ELEVATOR_TRANSITION_SECONDS = 5

export function estimateRouteDurationSeconds(path, edgeDetails) {
  if (!Array.isArray(path) || path.length < 2) {
    return 0
  }

  let totalSeconds = 0

  for (let index = 0; index < path.length - 1; index += 1) {
    const fromId = path[index]
    const toId = path[index + 1]
    const edge = edgeDetails[fromId]?.[toId]

    if (!edge) {
      continue
    }

    if (edge.mode === "stairs") {
      totalSeconds += edge.distance / STAIRS_SPEED_METERS_PER_SECOND
      continue
    }

    if (edge.mode === "elevator") {
      totalSeconds += ELEVATOR_TRANSITION_SECONDS
      continue
    }

    totalSeconds += edge.distance / HORIZONTAL_SPEED_METERS_PER_SECOND
  }

  return totalSeconds
}
