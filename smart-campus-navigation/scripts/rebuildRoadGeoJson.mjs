import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildRoadPathGraph, summarizeRoadGraph } from "../src/outdoor/roadPathGraph.js"

function toFixedNumber(value, decimals = 6) {
  return Number.parseFloat(Number(value).toFixed(decimals))
}

function toRoadFeature([fromLat, fromLng], [toLat, toLng]) {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [toFixedNumber(fromLng), toFixedNumber(fromLat)],
        [toFixedNumber(toLng), toFixedNumber(toLat)],
      ],
    },
  }
}

function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const roadsPath = path.resolve(__dirname, "../public/data/Roads.geojson")
  const buildingsPath = path.resolve(__dirname, "../public/data/Campus map.geojson")

  const roadsPayload = JSON.parse(fs.readFileSync(roadsPath, "utf8"))
  const buildingsPayload = JSON.parse(fs.readFileSync(buildingsPath, "utf8"))

  const graph = buildRoadPathGraph(roadsPayload, buildingsPayload, {
    endpointSnapMeters: 1.5,
  })
  const stats = summarizeRoadGraph(graph)

  const seenEdges = new Set()
  const features = []

  Object.entries(graph).forEach(([nodeKey, node]) => {
    const fromCoord = node?.coord
    if (!Array.isArray(fromCoord) || fromCoord.length < 2) {
      return
    }

    ;(node.neighbors || []).forEach(({ key: neighborKey }) => {
      const toCoord = graph[neighborKey]?.coord
      if (!Array.isArray(toCoord) || toCoord.length < 2) {
        return
      }

      const edgeId = [nodeKey, neighborKey].sort().join("|")
      if (seenEdges.has(edgeId)) {
        return
      }
      seenEdges.add(edgeId)
      features.push(toRoadFeature(fromCoord, toCoord))
    })
  })

  features.sort((a, b) => {
    const [aLng, aLat] = a.geometry.coordinates[0]
    const [bLng, bLat] = b.geometry.coordinates[0]
    if (aLat !== bLat) return aLat - bLat
    if (aLng !== bLng) return aLng - bLng
    const [a2Lng, a2Lat] = a.geometry.coordinates[1]
    const [b2Lng, b2Lat] = b.geometry.coordinates[1]
    if (a2Lat !== b2Lat) return a2Lat - b2Lat
    return a2Lng - b2Lng
  })

  const rebuiltPayload = {
    type: "FeatureCollection",
    features,
  }

  fs.writeFileSync(roadsPath, JSON.stringify(rebuiltPayload))

  console.info("[rebuildRoadGeoJson] Rebuilt campus road topology", {
    nodes: stats.nodeCount,
    edges: stats.edgeCount,
    components: stats.componentCount,
    minEdgeMeters: Number(stats.minEdgeMeters.toFixed(2)),
    maxEdgeMeters: Number(stats.maxEdgeMeters.toFixed(2)),
    avgEdgeMeters: Number(stats.averageEdgeMeters.toFixed(2)),
  })
}

main()
