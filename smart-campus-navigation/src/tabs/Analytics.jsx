import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  exportAnalyticsCsv,
  getAnalyticsDaily,
  getAnalyticsSummary,
} from "../services/api/analyticsService"

const RANGE_OPTIONS = [7, 30, 90]
const PIE_COLORS = ["#FF6A00", "#2979FF", "#00B8D4", "#1ED760", "#9CA3AF"]

function formatEta(seconds) {
  const normalized = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  const minutes = Math.floor(normalized / 60)
  const remainingSeconds = normalized % 60
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`
}

function getFilenameFromDisposition(headerValue, fallbackName) {
  if (!headerValue) {
    return fallbackName
  }

  const match = /filename="?([^"]+)"?/i.exec(headerValue)
  return match?.[1] || fallbackName
}

function Analytics() {
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState(null)
  const [dailySeries, setDailySeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [routesPage, setRoutesPage] = useState(1)
  const [connectorsPage, setConnectorsPage] = useState(1)
  const [exportingType, setExportingType] = useState("")

  const loadAnalytics = useCallback(async () => {
    setLoading(true)
    setError("")

    try {
      const [summaryPayload, dailyPayload] = await Promise.all([
        getAnalyticsSummary({
          days,
          routesPage,
          routesPageSize: 10,
          connectorsPage,
          connectorsPageSize: 10,
        }),
        getAnalyticsDaily({
          days,
          page: 1,
          pageSize: Math.max(days, 30),
        }),
      ])

      setSummary(summaryPayload)
      const seriesResults = Array.isArray(dailyPayload?.series?.results)
        ? dailyPayload.series.results
        : []
      setDailySeries(seriesResults)
    } catch (loadError) {
      setError(loadError.message || "Failed to load analytics.")
      setSummary(null)
      setDailySeries([])
    } finally {
      setLoading(false)
    }
  }, [connectorsPage, days, routesPage])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  const connectorBarData = useMemo(() => {
    const connectorResults = summary?.topConnectors?.results
    if (!Array.isArray(connectorResults)) {
      return []
    }

    return connectorResults.map((item) => ({
      name: item.name,
      count: item.count,
      floor: item.floor,
    }))
  }, [summary])

  const preferencePieData = useMemo(() => {
    if (!summary?.preferenceBreakdown) {
      return []
    }

    return summary.preferenceBreakdown.map((item) => ({
      name: item.mode,
      value: item.count,
    }))
  }, [summary])

  const handleExport = useCallback(
    async (type) => {
      setExportingType(type)
      setError("")

      try {
        const { blob, contentDisposition } = await exportAnalyticsCsv({
          days,
          type,
        })
        const defaultName = `analytics_${type}_${days}d.csv`
        const filename = getFilenameFromDisposition(contentDisposition, defaultName)
        const objectUrl = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = objectUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(objectUrl)
      } catch (exportError) {
        setError(exportError.message || "CSV export failed.")
      } finally {
        setExportingType("")
      }
    },
    [days]
  )

  const routeRows = summary?.topRoutes?.results || []
  const connectorRows = summary?.topConnectors?.results || []
  const routesHasNext = Boolean(summary?.topRoutes?.next)
  const routesHasPrevious = Boolean(summary?.topRoutes?.previous)
  const connectorsHasNext = Boolean(summary?.topConnectors?.next)
  const connectorsHasPrevious = Boolean(summary?.topConnectors?.previous)

  return (
    <section className="panel">
      <div className="panel-head analytics-head">
        <div>
          <h2>Navigation Analytics</h2>
          <p>Operational summary for route usage, connector load, and daily trends.</p>
        </div>

        <div className="analytics-controls">
          <label>
            Window
            <select
              value={days}
              onChange={(event) => {
                const nextDays = Number(event.target.value)
                setDays(nextDays)
                setRoutesPage(1)
                setConnectorsPage(1)
              }}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="route-button secondary" onClick={loadAnalytics}>
            Refresh
          </button>
        </div>
      </div>

      <div className="analytics-export-row">
        <button
          type="button"
          className="route-button secondary"
          onClick={() => handleExport("routes")}
          disabled={exportingType !== ""}
        >
          {exportingType === "routes" ? "Exporting Routes..." : "Export Routes CSV"}
        </button>
        <button
          type="button"
          className="route-button secondary"
          onClick={() => handleExport("connectors")}
          disabled={exportingType !== ""}
        >
          {exportingType === "connectors" ? "Exporting Connectors..." : "Export Connectors CSV"}
        </button>
        <button
          type="button"
          className="route-button secondary"
          onClick={() => handleExport("daily")}
          disabled={exportingType !== ""}
        >
          {exportingType === "daily" ? "Exporting Daily..." : "Export Daily CSV"}
        </button>
      </div>

      {loading ? <div className="network-banner info">Loading analytics...</div> : null}
      {error ? <div className="network-banner">{error}</div> : null}

      {summary ? (
        <>
          <div className="analytics-kpi-grid">
            <article className="analytics-kpi-card">
              <p>Total Sessions</p>
              <h3>{summary.totalSessions}</h3>
            </article>
            <article className="analytics-kpi-card">
              <p>Completed Sessions</p>
              <h3>{summary.completedSessions}</h3>
            </article>
            <article className="analytics-kpi-card">
              <p>Avg Distance</p>
              <h3>{Math.round(summary.avgDistance)} m</h3>
            </article>
            <article className="analytics-kpi-card">
              <p>Avg ETA</p>
              <h3>{formatEta(summary.avgEtaSeconds)}</h3>
            </article>
          </div>

          <div className="analytics-chart-grid">
            <article className="analytics-chart-card">
              <h3>Daily Sessions</h3>
              <div className="analytics-chart-surface">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={dailySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(245,245,245,0.12)" />
                    <XAxis dataKey="day" stroke="#D1D5DB" />
                    <YAxis stroke="#D1D5DB" allowDecimals={false} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="totalSessions"
                      stroke="#FF6A00"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="analytics-chart-card">
              <h3>Connector Usage</h3>
              <div className="analytics-chart-surface">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={connectorBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(245,245,245,0.12)" />
                    <XAxis dataKey="name" stroke="#D1D5DB" />
                    <YAxis stroke="#D1D5DB" allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#2979FF" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="analytics-chart-card">
              <h3>Preference Distribution</h3>
              <div className="analytics-chart-surface">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={preferencePieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                    >
                      {preferencePieData.map((item, index) => (
                        <Cell
                          key={`${item.name}-${item.value}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </article>
          </div>

          <div className="analytics-table-grid">
            <article className="analytics-table-card">
              <h3>Top Routes</h3>
              <table>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Sessions</th>
                    <th>Avg Distance</th>
                    <th>Avg ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {routeRows.map((route) => (
                    <tr key={`${route.startNodeId}-${route.endNodeId}`}>
                      <td>
                        {route.startName} to {route.endName}
                      </td>
                      <td>{route.count}</td>
                      <td>{Math.round(route.avgDistance)} m</td>
                      <td>{formatEta(route.avgEtaSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="analytics-pagination-row">
                <button
                  type="button"
                  className="route-button secondary"
                  disabled={!routesHasPrevious || loading}
                  onClick={() => {
                    setRoutesPage((previousPage) => Math.max(1, previousPage - 1))
                  }}
                >
                  Previous
                </button>
                <span>Page {summary?.topRoutes?.page || 1}</span>
                <button
                  type="button"
                  className="route-button secondary"
                  disabled={!routesHasNext || loading}
                  onClick={() => {
                    setRoutesPage((previousPage) => previousPage + 1)
                  }}
                >
                  Next
                </button>
              </div>
            </article>

            <article className="analytics-table-card">
              <h3>Top Connectors</h3>
              <table>
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Floor</th>
                    <th>Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {connectorRows.map((connector) => (
                    <tr key={connector.nodeId}>
                      <td>{connector.name}</td>
                      <td>{connector.floor}</td>
                      <td>{connector.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="analytics-pagination-row">
                <button
                  type="button"
                  className="route-button secondary"
                  disabled={!connectorsHasPrevious || loading}
                  onClick={() => {
                    setConnectorsPage((previousPage) => Math.max(1, previousPage - 1))
                  }}
                >
                  Previous
                </button>
                <span>Page {summary?.topConnectors?.page || 1}</span>
                <button
                  type="button"
                  className="route-button secondary"
                  disabled={!connectorsHasNext || loading}
                  onClick={() => {
                    setConnectorsPage((previousPage) => previousPage + 1)
                  }}
                >
                  Next
                </button>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  )
}

export default Analytics
