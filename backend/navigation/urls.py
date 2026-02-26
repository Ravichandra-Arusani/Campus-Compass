from django.urls import path

from .views import (
    auth_me,
    available_rooms,
    building_rooms,
    compute_route,
    create_navigation_session,
    health_check,
    list_buildings,
    list_navigation_nodes,
    navigation_analytics_daily,
    navigation_analytics_export,
    navigation_analytics_summary,
    navigation_graph,
    navigation_graph_version,
)

urlpatterns = [
    path("health/", health_check),
    path("auth/me/", auth_me),
    path("route/", compute_route),
    path("buildings/", list_buildings),
    path("buildings/<int:building_id>/rooms/", building_rooms),
    path("available-rooms/", available_rooms),
    path("rooms/available/", available_rooms),
    path("navigation/nodes/", list_navigation_nodes),
    path("navigation/graph/", navigation_graph),
    path("navigation/graph/version/", navigation_graph_version),
    path("navigation/session/", create_navigation_session),
    path("navigation/analytics/summary/", navigation_analytics_summary),
    path("navigation/analytics/daily/", navigation_analytics_daily),
    path("navigation/analytics/export/", navigation_analytics_export),
]
