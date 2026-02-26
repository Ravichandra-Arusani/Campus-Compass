from django.contrib import admin

from .models import (
    Alert,
    Building,
    Edge,
    GraphVersion,
    NavigationSession,
    NavigationSessionNodeUsage,
    Node,
    NodeEdge,
    Room,
)

admin.site.register(Building)
admin.site.register(Room)
admin.site.register(Edge)
admin.site.register(Alert)


@admin.register(Node)
class NodeAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "building", "floor", "kind", "connector_type")
    list_filter = ("building", "floor", "kind", "connector_type")
    search_fields = ("id", "name", "building")


@admin.register(NodeEdge)
class NodeEdgeAdmin(admin.ModelAdmin):
    list_display = ("from_node", "to_node", "distance", "mode")
    list_filter = ("mode",)
    search_fields = ("from_node__id", "to_node__id")


@admin.register(GraphVersion)
class GraphVersionAdmin(admin.ModelAdmin):
    list_display = ("version", "updated_at")
    readonly_fields = ("updated_at",)


@admin.register(NavigationSession)
class NavigationSessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "start_node",
        "end_node",
        "preference_mode",
        "route_node_count",
        "route_distance",
        "duration_seconds",
        "completed",
        "created_at",
    )
    list_filter = ("preference_mode", "completed", "created_at")
    search_fields = ("user__username", "start_node__id", "end_node__id")
    readonly_fields = ("created_at",)


@admin.register(NavigationSessionNodeUsage)
class NavigationSessionNodeUsageAdmin(admin.ModelAdmin):
    list_display = ("session", "node", "floor", "is_connector", "hits")
    list_filter = ("is_connector", "floor")
    search_fields = ("node__id", "node__name", "session__id")
