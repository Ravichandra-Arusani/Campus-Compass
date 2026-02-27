import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  astarRoadPath,
  buildRoadPathGraph,
  dijkstraRoadPath,
  dijkstraRoadPathKeys,
  pathLengthFromCoordinates,
  summarizeRoadGraph,
} from "../src/outdoor/roadPathGraph.js"

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const roadsPath = path.resolve(__dirname, "../public/data/Roads.geojson")
  const buildingsPath = path.resolve(__dirname, "../public/data/Campus map.geojson")

  const roadsPayload = JSON.parse(fs.readFileSync(roadsPath, "utf8"))
  const buildingsPayload = JSON.parse(fs.readFileSync(buildingsPath, "utf8"))
  const graph = buildRoadPathGraph(roadsPayload, buildingsPayload)
  const stats = summarizeRoadGraph(graph)

  assert(stats.nodeCount > 0, "Routing graph has zero nodes.")
  assert(stats.edgeCount > 0, "Routing graph has zero edges.")
  assert(stats.componentCount === 1, `Expected 1 connected component, got ${stats.componentCount}.`)

  const nodeKeys = Object.keys(graph)
  const intersectionKey = nodeKeys.find((nodeKey) => (graph[nodeKey]?.neighbors || []).length >= 2)
  assert(Boolean(intersectionKey), "Could not find an intersection node for routing tests.")

  const intersectionNeighbors = graph[intersectionKey].neighbors
  const straightStart = intersectionKey
  const straightEnd = intersectionNeighbors[0]?.key
  assert(Boolean(straightEnd), "Could not build straight-road test pair.")

  const straightPath = dijkstraRoadPathKeys(graph, straightStart, straightEnd)
  assert(straightPath?.length === 2, "Straight-road route should have exactly one hop.")

  const crossStart = intersectionNeighbors[0]?.key
  const crossEnd = intersectionNeighbors[1]?.key
  assert(Boolean(crossStart) && Boolean(crossEnd), "Could not build intersection-hop test pair.")

  const crossPath = dijkstraRoadPathKeys(graph, crossStart, crossEnd)
  assert(crossPath?.length >= 2, "Intersection route should return a valid path.")

  let multiStart = null
  let multiEnd = null
  let maxDirectDistance = -1

  for (let i = 0; i < nodeKeys.length; i += 1) {
    const firstKey = nodeKeys[i]
    const firstCoord = graph[firstKey]?.coord
    if (!Array.isArray(firstCoord) || firstCoord.length < 2) {
      continue
    }

    for (let j = i + 1; j < nodeKeys.length; j += 1) {
      const secondKey = nodeKeys[j]
      const secondCoord = graph[secondKey]?.coord
      if (!Array.isArray(secondCoord) || secondCoord.length < 2) {
        continue
      }

      const directDistance = pathLengthFromCoordinates([firstCoord, secondCoord])
      if (directDistance > maxDirectDistance) {
        maxDirectDistance = directDistance
        multiStart = firstKey
        multiEnd = secondKey
      }
    }
  }

  assert(Boolean(multiStart) && Boolean(multiEnd), "Could not derive multi-hop test pair.")

  const forwardCoords = dijkstraRoadPath(graph, multiStart, multiEnd)
  const reverseCoords = dijkstraRoadPath(graph, multiEnd, multiStart)

  assert(Array.isArray(forwardCoords) && forwardCoords.length >= 3, "Multi-hop route failed.")
  assert(Array.isArray(reverseCoords) && reverseCoords.length >= 3, "Reverse route failed.")

  const forwardDistance = pathLengthFromCoordinates(forwardCoords)
  const reverseDistance = pathLengthFromCoordinates(reverseCoords)

  assert(
    Math.abs(forwardDistance - reverseDistance) < 0.001,
    "Forward and reverse distances are not symmetric."
  )

  let comparedPairs = 0
  for (let i = 0; i < nodeKeys.length && comparedPairs < 20; i += 1) {
    for (let j = i + 1; j < nodeKeys.length && comparedPairs < 20; j += 1) {
      const fromKey = nodeKeys[i]
      const toKey = nodeKeys[j]
      const dijkstraPath = dijkstraRoadPath(graph, fromKey, toKey)
      const astarPath = astarRoadPath(graph, fromKey, toKey)
      if (!dijkstraPath || !astarPath) {
        continue
      }

      const dijkstraLength = pathLengthFromCoordinates(dijkstraPath)
      const astarLength = pathLengthFromCoordinates(astarPath)
      assert(
        Math.abs(dijkstraLength - astarLength) < 0.001,
        `A* and Dijkstra mismatch for ${fromKey} -> ${toKey}.`
      )
      comparedPairs += 1
    }
  }

  console.info("[verifyRoadRouting] PASS", {
    graphNodes: stats.nodeCount,
    graphEdges: stats.edgeCount,
    graphComponents: stats.componentCount,
    straightHopPathLength: straightPath.length,
    crossPathLength: crossPath.length,
    multiHopPathLength: forwardCoords.length,
    forwardDistanceMeters: Number(forwardDistance.toFixed(2)),
    reverseDistanceMeters: Number(reverseDistance.toFixed(2)),
    comparedPairs,
  })
}

main()
