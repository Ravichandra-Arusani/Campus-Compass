import apiClient from "../apiClient"

export async function getAnalyticsSummary({
  days = 30,
  routesPage = 1,
  routesPageSize = 10,
  connectorsPage = 1,
  connectorsPageSize = 10,
} = {}) {
  const response = await apiClient.get("/navigation/analytics/summary/", {
    params: {
      days,
      routes_page: routesPage,
      routes_page_size: routesPageSize,
      connectors_page: connectorsPage,
      connectors_page_size: connectorsPageSize,
    },
  })
  return response.data
}

export async function getAnalyticsDaily({ days = 30, page = 1, pageSize = 90 } = {}) {
  const response = await apiClient.get("/navigation/analytics/daily/", {
    params: { days, page, page_size: pageSize },
  })
  return response.data
}

export async function exportAnalyticsCsv({ days = 30, type = "routes" } = {}) {
  const response = await apiClient.get("/navigation/analytics/export/", {
    params: { days, type },
    responseType: "blob",
  })

  return {
    blob: response.data,
    contentDisposition: response.headers["content-disposition"] || "",
  }
}
