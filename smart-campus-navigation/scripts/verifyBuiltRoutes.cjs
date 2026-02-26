const path = require("path")
const fs = require("fs")
const { chromium } = require("playwright")

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173"
const FOOTPRINTS_GEOJSON_PATH = path.join(process.cwd(), "public", "data", "campus.geojson")
const FORBIDDEN_FOOTPRINT_TYPES = new Set(["academic", "service", "hostel"])
const CUT_THROUGH_REFERENCES = [
  [17.470196, 78.721807],
  [17.471243, 78.722057],
  [17.471132, 78.722666],
  [17.46995, 78.723203],
]
const FORBIDDEN_FOOTPRINTS = loadForbiddenFootprints()

const ROUTE_CASES = [
  {
    id: "outside_to_avishkar",
    label: "Outside campus -> Avishkar Block",
    geolocation: { latitude: 17.47095, longitude: 78.72435, accuracy: 5 },
    destination: "Avishkar Block",
    expectOsrm: true,
    expectCutThrough: true,
    expectConnectorSegment: true,
    expectedGraphLengthRangeMeters: { min: 330, max: 460 },
  },
  {
    id: "outside_to_pratham",
    label: "Outside campus -> Pratham Block",
    geolocation: { latitude: 17.47095, longitude: 78.72435, accuracy: 5 },
    destination: "Pratham Block",
    expectOsrm: true,
    expectCutThrough: false,
    expectConnectorSegment: true,
    expectedGraphLengthRangeMeters: { min: 430, max: 600 },
  },
  {
    id: "inside_to_library",
    label: "Inside campus -> Library",
    geolocation: { latitude: 17.47055, longitude: 78.72215, accuracy: 5 },
    destination: "Library",
    expectOsrm: false,
    expectCutThrough: false,
    expectConnectorSegment: null,
    expectedGraphLengthRangeMeters: { min: 360, max: 520 },
  },
]

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const earthRadiusM = 6371000
  const lat1 = toRadians(aLat)
  const lat2 = toRadians(bLat)
  const dLat = toRadians(bLat - aLat)
  const dLng = toRadians(bLng - aLng)
  const haversineValue =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const arc = 2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))
  return earthRadiusM * arc
}

function routeLengthMeters(routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    return 0
  }

  let total = 0
  for (let index = 1; index < routePoints.length; index += 1) {
    const [aLat, aLng] = routePoints[index - 1]
    const [bLat, bLng] = routePoints[index]
    total += distanceMeters(aLat, aLng, bLat, bLng)
  }
  return total
}

function loadForbiddenFootprints() {
  try {
    const payload = JSON.parse(fs.readFileSync(FOOTPRINTS_GEOJSON_PATH, "utf8"))
    const features = Array.isArray(payload?.features) ? payload.features : []
    const forbidden = []

    features.forEach((feature) => {
      const type = String(feature?.properties?.type || "").toLowerCase()
      if (!FORBIDDEN_FOOTPRINT_TYPES.has(type)) {
        return
      }

      const geometry = feature?.geometry
      if (!geometry) {
        return
      }

      if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
        forbidden.push({
          id: String(feature?.properties?.id || feature?.properties?.name || "unknown"),
          polygons: [geometry.coordinates],
        })
        return
      }

      if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
        forbidden.push({
          id: String(feature?.properties?.id || feature?.properties?.name || "unknown"),
          polygons: geometry.coordinates,
        })
      }
    })

    return forbidden
  } catch (error) {
    console.warn("Failed to load forbidden footprints:", error?.message || error)
    return []
  }
}

function isPointOnSegment(pointLng, pointLat, aLng, aLat, bLng, bLat) {
  const epsilon = 1e-10
  const cross = (pointLng - aLng) * (bLat - aLat) - (pointLat - aLat) * (bLng - aLng)
  if (Math.abs(cross) > epsilon) {
    return false
  }

  const dot = (pointLng - aLng) * (bLng - aLng) + (pointLat - aLat) * (bLat - aLat)
  if (dot < 0) {
    return false
  }

  const segmentLengthSquared = (bLng - aLng) ** 2 + (bLat - aLat) ** 2
  if (dot > segmentLengthSquared) {
    return false
  }

  return true
}

function isPointInsideRing(pointLng, pointLat, ringCoordinates) {
  if (!Array.isArray(ringCoordinates) || ringCoordinates.length < 3) {
    return false
  }

  let inside = false
  for (let index = 0, previousIndex = ringCoordinates.length - 1; index < ringCoordinates.length; previousIndex = index, index += 1) {
    const [currentLng, currentLat] = ringCoordinates[index]
    const [previousLng, previousLat] = ringCoordinates[previousIndex]

    if (
      isPointOnSegment(
        pointLng,
        pointLat,
        currentLng,
        currentLat,
        previousLng,
        previousLat
      )
    ) {
      // Treat boundary points as outside to avoid false positives on perimeter-aligned paths.
      return false
    }

    const intersects =
      (currentLat > pointLat) !== (previousLat > pointLat) &&
      pointLng <
        ((previousLng - currentLng) * (pointLat - currentLat)) /
          ((previousLat - currentLat) || Number.MIN_VALUE) +
          currentLng

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointInsidePolygon(pointLng, pointLat, polygonCoordinates) {
  if (!Array.isArray(polygonCoordinates) || polygonCoordinates.length === 0) {
    return false
  }

  const [outerRing, ...holeRings] = polygonCoordinates
  if (!isPointInsideRing(pointLng, pointLat, outerRing)) {
    return false
  }

  for (const holeRing of holeRings) {
    if (isPointInsideRing(pointLng, pointLat, holeRing)) {
      return false
    }
  }

  return true
}

function findContainingForbiddenFootprint(routePoint) {
  if (!Array.isArray(routePoint) || routePoint.length < 2) {
    return null
  }

  const [pointLat, pointLng] = routePoint

  for (const footprint of FORBIDDEN_FOOTPRINTS) {
    for (const polygon of footprint.polygons || []) {
      if (isPointInsidePolygon(pointLng, pointLat, polygon)) {
        return footprint.id
      }
    }
  }

  return null
}

function getSolidRouteForbiddenPointStats(routePoints) {
  const samples = []
  let count = 0

  routePoints.forEach((routePoint, index) => {
    const footprintId = findContainingForbiddenFootprint(routePoint)
    if (!footprintId) {
      return
    }

    count += 1
    if (samples.length < 5) {
      samples.push({
        index,
        footprintId,
        point: routePoint,
      })
    }
  })

  return {
    count,
    samples,
  }
}

function minDistanceToCutThroughMeters(routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  let minDistance = Number.POSITIVE_INFINITY
  routePoints.forEach(([lat, lng]) => {
    CUT_THROUGH_REFERENCES.forEach(([referenceLat, referenceLng]) => {
      minDistance = Math.min(
        minDistance,
        distanceMeters(lat, lng, referenceLat, referenceLng)
      )
    })
  })
  return minDistance
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function runRouteCase(browser, routeCase) {
  const context = await browser.newContext({
    geolocation: routeCase.geolocation,
    permissions: ["geolocation"],
    viewport: { width: 1600, height: 960 },
  })

  await context.addInitScript(() => {
    window.__routeProbe = {
      routes: [],
      connectors: [],
      routeLayers: [],
      osrm: [],
      consoleErrors: [],
    }

    const normalizePoint = (candidate) => {
      if (Array.isArray(candidate) && candidate.length >= 2) {
        const lat = Number(candidate[0])
        const lng = Number(candidate[1])
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return [lat, lng]
        }
      }
      if (
        candidate &&
        typeof candidate === "object" &&
        Number.isFinite(candidate.lat) &&
        Number.isFinite(candidate.lng)
      ) {
        return [candidate.lat, candidate.lng]
      }
      return null
    }

    const flattenLatLngs = (value, output) => {
      const point = normalizePoint(value)
      if (point) {
        output.push(point)
        return
      }
      if (!Array.isArray(value)) {
        return
      }
      value.forEach((entry) => flattenLatLngs(entry, output))
    }

    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const input = args[0]
      const url = typeof input === "string" ? input : input?.url
      const isOsrm = typeof url === "string" && url.includes("router.project-osrm.org/route/v1/foot")

      if (!isOsrm) {
        return originalFetch(...args)
      }

      const start = Date.now()
      try {
        const response = await originalFetch(...args)
        window.__routeProbe.osrm.push({
          url,
          status: response.status,
          ok: response.ok,
          elapsedMs: Date.now() - start,
        })
        return response
      } catch (error) {
        window.__routeProbe.osrm.push({
          url,
          ok: false,
          error: String(error),
          elapsedMs: Date.now() - start,
        })
        throw error
      }
    }

    const tryPatchLeaflet = () => {
      if (!window.L || window.__routeProbeLeafletPatched) {
        return
      }
      window.__routeProbeLeafletPatched = true

      const originalPolyline = window.L.polyline
      window.L.polyline = function patchedPolyline(latlngs, options, ...rest) {
        const layer = originalPolyline.call(this, latlngs, options, ...rest)

        try {
          const className = String(options?.className || "")
          const normalized = []
          flattenLatLngs(latlngs, normalized)
          const hasDash = typeof options?.dashArray === "string" && options.dashArray.trim().length > 0
          const routeLayerEntry = {
            at: Date.now(),
            className,
            hasDash,
            pointCount: normalized.length,
            latlngs: normalized,
          }

          if (className.includes("campus-active-route")) {
            window.__routeProbe.routes.push({
              ...routeLayerEntry,
            })
          }
          if (className.includes("campus-route-connector")) {
            window.__routeProbe.connectors.push({
              ...routeLayerEntry,
            })
          }
          if (
            className.includes("campus-active-route") ||
            className.includes("campus-route-connector")
          ) {
            window.__routeProbe.routeLayers.push(routeLayerEntry)
          }
        } catch {
          // Intentionally ignore probe errors.
        }

        return layer
      }
    }

    const patchInterval = window.setInterval(tryPatchLeaflet, 25)
    window.setTimeout(() => window.clearInterval(patchInterval), 15000)
  })

  const page = await context.newPage()
  page.on("console", (message) => {
    if (message.type() === "error") {
      context
        .addInitScript(() => {})
        .catch(() => {})
    }
  })

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("input.destination-search-input", { timeout: 60000 })
  await page.evaluate(() => {
    document.getElementById("map-section")?.scrollIntoView({ behavior: "instant", block: "center" })
  })

  const input = page.locator("input.destination-search-input")
  await input.click()
  await input.fill(routeCase.destination)

  const optionPattern = new RegExp(`^\\s*${escapeRegex(routeCase.destination)}\\s*$`, "i")
  const option = page.locator(".destination-search-option").filter({ hasText: optionPattern }).first()
  await option.waitFor({ state: "visible", timeout: 10000 })
  await option.click()

  const routeButton = page.locator("button.route-cta")
  await routeButton.waitFor({ state: "visible", timeout: 10000 })
  await routeButton.click()

  await page.waitForFunction(
    () =>
      (Array.isArray(window.__routeProbe?.routes) && window.__routeProbe.routes.length > 0) ||
      Boolean(document.querySelector(".campus-map-error")?.textContent?.trim()),
    { timeout: 60000 }
  )
  await page.waitForTimeout(1500)

  const probe = await page.evaluate(
    () =>
      window.__routeProbe || {
        routes: [],
        connectors: [],
        routeLayers: [],
        osrm: [],
      }
  )
  const uiErrorText = await page
    .locator(".campus-map-error")
    .first()
    .textContent()
    .then((value) => (value || "").trim())
    .catch(() => "")
  const route = probe.routes?.[probe.routes.length - 1]?.latlngs || []
  const connectorEntries = Array.isArray(probe.connectors) ? probe.connectors : []
  const routeLayerEntries = Array.isArray(probe.routeLayers) ? probe.routeLayers : []
  const activeRouteEntries = routeLayerEntries.filter((entry) =>
    String(entry?.className || "").includes("campus-active-route")
  )
  const connectorRouteEntries = routeLayerEntries.filter((entry) =>
    String(entry?.className || "").includes("campus-route-connector")
  )
  const connectorPointCount = connectorEntries.reduce(
    (sum, entry) => sum + (Number(entry?.pointCount) || 0),
    0
  )

  const routeLength = routeLengthMeters(route)
  const routeDirectDistance =
    route.length >= 2
      ? distanceMeters(
          route[0][0],
          route[0][1],
          route[route.length - 1][0],
          route[route.length - 1][1]
        )
      : 0
  const routeDirectness = routeDirectDistance > 0 ? routeLength / routeDirectDistance : 0
  const minCutThroughDistance = minDistanceToCutThroughMeters(route)
  const osrmCalls = Array.isArray(probe.osrm) ? probe.osrm : []
  const expectedRange = routeCase.expectedGraphLengthRangeMeters
  const distanceBandMet =
    !expectedRange ||
    (routeLength >= expectedRange.min && routeLength <= expectedRange.max)
  const connectorExpectationMet =
    routeCase.expectConnectorSegment === null
      ? true
      : routeCase.expectConnectorSegment
        ? connectorRouteEntries.length > 0
        : connectorRouteEntries.length === 0
  const connectorClassSeparationMet =
    activeRouteEntries.every(
      (entry) =>
        String(entry?.className || "").includes("campus-active-route") &&
        !String(entry?.className || "").includes("campus-route-connector") &&
        !entry?.hasDash
    ) &&
    connectorRouteEntries.every(
      (entry) =>
        String(entry?.className || "").includes("campus-route-connector") &&
        !String(entry?.className || "").includes("campus-active-route") &&
        entry?.hasDash
    )
  const forbiddenSolidPointStats = getSolidRouteForbiddenPointStats(route)

  const screenshotPath = path.join(process.cwd(), `${routeCase.id}.built.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })

  await context.close()

  const osrmSuccess = osrmCalls.some((entry) => entry.ok === true)
  const cutThroughDetected = Number.isFinite(minCutThroughDistance) && minCutThroughDistance <= 30

  const checks = {
    hasRoute: route.length >= 2,
    noUiError: uiErrorText.length === 0,
    osrmExpectationMet: routeCase.expectOsrm ? osrmSuccess : osrmCalls.length === 0,
    connectorExpectationMet,
    connectorClassSeparationMet,
    noSolidRoutePointInsideForbidden: forbiddenSolidPointStats.count === 0,
    distanceBandMet,
    cutThroughExpectationMet: routeCase.expectCutThrough ? cutThroughDetected : true,
  }

  return {
    id: routeCase.id,
    label: routeCase.label,
    destination: routeCase.destination,
    geolocation: routeCase.geolocation,
    routePointCount: route.length,
    connectorPointCount,
    routeLengthMeters: Number(routeLength.toFixed(1)),
    expectedGraphLengthRangeMeters: expectedRange || null,
    routeDirectDistanceMeters: Number(routeDirectDistance.toFixed(1)),
    routeDirectness: Number(routeDirectness.toFixed(2)),
    minCutThroughDistanceMeters: Number.isFinite(minCutThroughDistance)
      ? Number(minCutThroughDistance.toFixed(1))
      : null,
    cutThroughDetected,
    uiErrorText,
    forbiddenSolidPointStats,
    routeLayerCounts: {
      active: activeRouteEntries.length,
      connectors: connectorRouteEntries.length,
      total: routeLayerEntries.length,
    },
    osrmCalls,
    checks,
    screenshotPath,
    pass: Object.values(checks).every(Boolean),
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const results = []

  try {
    for (const routeCase of ROUTE_CASES) {
      const result = await runRouteCase(browser, routeCase)
      results.push(result)
    }
  } finally {
    await browser.close()
  }

  const summary = {
    baseUrl: BASE_URL,
    timestamp: new Date().toISOString(),
    allPassed: results.every((entry) => entry.pass),
    results,
  }

  console.log(JSON.stringify(summary, null, 2))
  if (!summary.allPassed) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
