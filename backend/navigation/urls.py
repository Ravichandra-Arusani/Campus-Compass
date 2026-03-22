from django.urls import path

from .views import (
    auth_me,
    available_rooms,
    building_rooms,
    campus_buildings_list,
    campus_navigate,
    campus_nodes_list,
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
    room_availability,
    room_availability_all,
    room_availability_update,
)

urlpatterns = [
    path("health/", health_check),
    path("auth/me/", auth_me),

    # New campus navigation API
    path("navigate/", campus_navigate),           # GET /api/navigate/?source=X&destination=Y
    path("nodes/", campus_nodes_list),             # GET /api/nodes/
    path("buildings/", campus_buildings_list),     # GET /api/buildings/   (replaces old list_buildings for campus mode)

    # Room availability APIs
    path("availability/", room_availability),              # GET /api/availability/?room_id=X
    path("availability/all/", room_availability_all),      # GET /api/availability/all/
    path("availability/update/", room_availability_update),# POST /api/availability/update/

    # Legacy / existing routes kept intact
    path("route/", compute_route),
    path("buildings-old/", list_buildings),
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

    # JWT token endpoints are in core/urls.py: /api/auth/token/ and /api/auth/token/refresh/
]

