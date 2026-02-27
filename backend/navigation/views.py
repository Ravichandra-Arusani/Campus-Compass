import csv
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache
from django.db.models import Avg, Count, F, Q, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from .models import (
    Building,
    GraphVersion,
    NavigationSession,
    NavigationSessionNodeUsage,
    Node,
    NodeEdge,
    Room,
)
from .pagination import AnalyticsPagination
from .pathfinding import find_shortest_path
from .serializers import (
    BuildingSerializer,
    GraphVersionSerializer,
    NavigationSessionSerializer,
    NavigationSessionWriteSerializer,
    NodeEdgeSerializer,
    NodeSerializer,
    RoomAvailabilitySerializer,
    RouteRequestSerializer,
)
from .throttles import AnalyticsExportThrottle, AnalyticsThrottle, NavigationSessionThrottle


@api_view(["POST"])
def compute_route(request):
    serializer = RouteRequestSerializer(data=request.data)

    if serializer.is_valid():
        start = serializer.validated_data["start"]
        end = serializer.validated_data["end"]

        route_data = find_shortest_path(start, end)

        return Response(route_data)

    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
def list_buildings(request):
    queryset = Building.objects.order_by("name")
    serializer = BuildingSerializer(queryset, many=True)
    return Response(serializer.data)


@api_view(["GET"])
def building_rooms(request, building_id):
    building = get_object_or_404(Building, id=building_id)
    rooms = Room.objects.filter(building=building).order_by("name")
    serializer = RoomAvailabilitySerializer(rooms, many=True)

    return Response(
        {
            "building": building.name,
            "rooms": serializer.data,
        }
    )


@api_view(["GET"])
def available_rooms(request):
    rooms = Room.objects.select_related("building").order_by("building__name", "name")

    room_type = (request.query_params.get("type") or "").strip().upper()
    if room_type:
        valid_room_types = {choice[0] for choice in Room.RoomType.choices}
        if room_type not in valid_room_types:
            return Response([])
        rooms = rooms.filter(type=room_type)

    serialized_rooms = RoomAvailabilitySerializer(rooms, many=True).data

    payload = []
    for room in serialized_rooms:
        if not room["is_available"]:
            continue

        payload.append(
            {
                **room,
                "type": (room.get("type") or "").lower(),
                "currentOccupancy": room.get("current_occupancy", 0),
            }
        )

    return Response(payload)


@api_view(["GET"])
def list_navigation_nodes(request):
    nodes = Node.objects.all().order_by("building", "floor", "name")
    serializer = NodeSerializer(nodes, many=True)
    return Response(serializer.data)


def build_graph_etag(version):
    return f'W/"navigation-graph-v{version}"'


def build_cache_key(prefix, request=None, suffix=""):
    if request is None:
        return f"{prefix}:{suffix}" if suffix else prefix

    query_items = []
    for key in sorted(request.query_params.keys()):
        values = request.query_params.getlist(key)
        for value in values:
            query_items.append((key, value))

    query_string = urlencode(query_items, doseq=True)
    user_id = getattr(request.user, "id", "anon")
    if suffix:
        return f"{prefix}:{user_id}:{suffix}:{query_string}"
    return f"{prefix}:{user_id}:{query_string}"


@api_view(["GET"])
def navigation_graph(request):
    graph_version = GraphVersion.get_current()
    etag = build_graph_etag(graph_version.version)

    if request.headers.get("If-None-Match") == etag:
        response = Response(status=status.HTTP_304_NOT_MODIFIED)
        response["ETag"] = etag
        response["Cache-Control"] = "no-cache"
        return response

    cache_key = build_cache_key(
        prefix="navigation:graph",
        suffix=f"v{graph_version.version}",
    )
    payload = cache.get(cache_key)

    if payload is None:
        nodes = list(Node.objects.all())
        edges = list(NodeEdge.objects.select_related("from_node", "to_node").all())

        node_payload = {
            node.id: {
                "lat": node.lat,
                "lng": node.lng,
                "floor": node.floor,
                "building": node.building,
                "name": node.name,
                "kind": node.kind,
                "connectorType": node.connector_type,
            }
            for node in nodes
        }

        campus_graph = {node.id: {} for node in nodes}
        edge_details = {node.id: {} for node in nodes}

        for edge in edges:
            campus_graph[edge.from_node_id][edge.to_node_id] = edge.distance
            edge_details[edge.from_node_id][edge.to_node_id] = {
                "distance": edge.distance,
                "mode": edge.mode,
            }

        floors = sorted({node.floor for node in nodes})
        version_payload = GraphVersionSerializer(graph_version).data

        payload = {
            "version": version_payload["version"],
            "updatedAt": version_payload["updatedAt"],
            "nodes": node_payload,
            "edges": NodeEdgeSerializer(edges, many=True).data,
            "campusGraph": campus_graph,
            "edgeDetails": edge_details,
            "availableFloors": floors,
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
        }
        cache.set(cache_key, payload, timeout=settings.GRAPH_CACHE_TTL_SECONDS)

    response = Response(payload)
    response["ETag"] = etag
    response["Cache-Control"] = "no-cache"
    return response


@api_view(["GET"])
def navigation_graph_version(request):
    graph_version = GraphVersion.get_current()
    cache_key = build_cache_key(
        prefix="navigation:graph:version",
        suffix=f"v{graph_version.version}",
    )
    payload = cache.get(cache_key)

    if payload is None:
        serializer = GraphVersionSerializer(graph_version)
        payload = serializer.data
        cache.set(cache_key, payload, timeout=settings.GRAPH_CACHE_TTL_SECONDS)

    response = Response(payload)
    response["ETag"] = build_graph_etag(graph_version.version)
    response["Cache-Control"] = "no-cache"
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([NavigationSessionThrottle])
def create_navigation_session(request):
    serializer = NavigationSessionWriteSerializer(
        data=request.data,
        context={"request": request},
    )

    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    session = serializer.save()
    payload = NavigationSessionSerializer(session).data
    return Response(payload, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    user = request.user
    return Response(
        {
            "id": user.id,
            "username": user.get_username(),
            "isStaff": bool(user.is_staff),
            "isSuperuser": bool(user.is_superuser),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response(
        {
            "status": "ok",
            "service": "smart-campus-navigation-backend",
            "timestamp": timezone.now().isoformat(),
        }
    )


def normalize_days(days_raw, default=30, max_days=365):
    if not days_raw:
        return default

    try:
        parsed = int(days_raw)
    except (TypeError, ValueError):
        return default

    if parsed < 1:
        return default

    return min(parsed, max_days)


def get_analytics_base_queryset(request):
    days = normalize_days(request.query_params.get("days"))
    cutoff = timezone.now() - timedelta(days=days)
    queryset = NavigationSession.objects.filter(created_at__gte=cutoff)
    return queryset, days, cutoff


def build_paginated_block(
    queryset,
    request,
    page_param="page",
    page_size_param="page_size",
    transform=None,
):
    paginator = AnalyticsPagination()
    paginator.page_query_param = page_param
    paginator.page_size_query_param = page_size_param

    paginated_items = paginator.paginate_queryset(queryset, request)
    if transform:
        results = [transform(item) for item in paginated_items]
    else:
        results = list(paginated_items)

    return {
        "count": paginator.page.paginator.count,
        "next": paginator.get_next_link(),
        "previous": paginator.get_previous_link(),
        "page": paginator.page.number,
        "pageSize": paginator.get_page_size(request),
        "results": results,
    }


def normalize_route_row(row):
    return {
        "startNodeId": row["start_node_id"],
        "startName": row["startName"] or row["start_node_id"],
        "endNodeId": row["end_node_id"],
        "endName": row["endName"] or row["end_node_id"],
        "count": row["count"],
        "avgDistance": round(float(row["avgDistance"]), 2),
        "avgEtaSeconds": round(float(row["avgEtaSeconds"]), 2),
    }


def normalize_connector_row(row):
    return {
        "nodeId": row["node_id"],
        "name": row["name"] or row["node_id"],
        "building": row["building"] or "",
        "floor": row["floor"],
        "count": int(row["count"]),
    }


def normalize_daily_row(row):
    return {
        "day": row["day"].isoformat() if row["day"] else None,
        "totalSessions": row["totalSessions"],
        "completedSessions": row["completedSessions"],
        "avgDistance": round(float(row["avgDistance"]), 2),
        "avgEtaSeconds": round(float(row["avgEtaSeconds"]), 2),
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
@throttle_classes([AnalyticsThrottle])
def navigation_analytics_summary(request):
    cache_key = build_cache_key(prefix="navigation:analytics:summary", request=request)
    cached_payload = cache.get(cache_key)
    if cached_payload is not None:
        return Response(cached_payload)

    queryset, days, cutoff = get_analytics_base_queryset(request)

    aggregates = queryset.aggregate(
        totalSessions=Count("id"),
        completedSessions=Count("id", filter=Q(completed=True)),
        avgDistance=Coalesce(Avg("route_distance"), 0.0),
        avgEtaSeconds=Coalesce(Avg("duration_seconds"), 0.0),
        avgRouteNodeCount=Coalesce(Avg("route_node_count"), 0.0),
    )

    top_routes_queryset = queryset.values("start_node_id", "end_node_id").annotate(
        startName=F("start_node__name"),
        endName=F("end_node__name"),
        count=Count("id"),
        avgDistance=Coalesce(Avg("route_distance"), 0.0),
        avgEtaSeconds=Coalesce(Avg("duration_seconds"), 0.0),
    ).order_by("-count", "start_node_id", "end_node_id")

    top_routes = build_paginated_block(
        top_routes_queryset,
        request,
        page_param="routes_page",
        page_size_param="routes_page_size",
        transform=normalize_route_row,
    )

    connector_usage_queryset = NavigationSessionNodeUsage.objects.filter(
        session__created_at__gte=cutoff,
        is_connector=True,
    )
    top_connectors_queryset = connector_usage_queryset.values("node_id").annotate(
        name=F("node__name"),
        building=F("node__building"),
        floor=F("floor"),
        count=Coalesce(Sum("hits"), 0),
    ).order_by("-count", "name", "node_id")

    top_connectors = build_paginated_block(
        top_connectors_queryset,
        request,
        page_param="connectors_page",
        page_size_param="connectors_page_size",
        transform=normalize_connector_row,
    )

    preference_breakdown = list(
        queryset.values("preference_mode")
        .annotate(count=Count("id"))
        .order_by("-count")
    )

    floor_usage_rows = (
        NavigationSessionNodeUsage.objects.filter(session__created_at__gte=cutoff)
        .values("floor")
        .annotate(count=Coalesce(Sum("hits"), 0))
        .order_by("floor")
    )
    floor_usage = {str(row["floor"]): int(row["count"]) for row in floor_usage_rows}

    payload = {
        "windowDays": days,
        "totalSessions": aggregates["totalSessions"],
        "completedSessions": aggregates["completedSessions"],
        "avgDistance": round(float(aggregates["avgDistance"]), 2),
        "avgEtaSeconds": round(float(aggregates["avgEtaSeconds"]), 2),
        "avgRouteNodeCount": round(float(aggregates["avgRouteNodeCount"]), 2),
        "topRoutes": top_routes,
        "topConnectors": top_connectors,
        "floorUsage": floor_usage,
        "preferenceBreakdown": [
            {"mode": row["preference_mode"], "count": row["count"]}
            for row in preference_breakdown
        ],
    }
    cache.set(cache_key, payload, timeout=settings.ANALYTICS_CACHE_TTL_SECONDS)
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAdminUser])
@throttle_classes([AnalyticsThrottle])
def navigation_analytics_daily(request):
    cache_key = build_cache_key(prefix="navigation:analytics:daily", request=request)
    cached_payload = cache.get(cache_key)
    if cached_payload is not None:
        return Response(cached_payload)

    queryset, days, _ = get_analytics_base_queryset(request)

    rows = queryset.annotate(day=TruncDate("created_at")).values("day").annotate(
        totalSessions=Count("id"),
        completedSessions=Count("id", filter=Q(completed=True)),
        avgDistance=Coalesce(Avg("route_distance"), 0.0),
        avgEtaSeconds=Coalesce(Avg("duration_seconds"), 0.0),
    ).order_by("day")

    series = build_paginated_block(
        rows,
        request,
        page_param="page",
        page_size_param="page_size",
        transform=normalize_daily_row,
    )

    payload = {
        "windowDays": days,
        "series": series,
    }
    cache.set(cache_key, payload, timeout=settings.ANALYTICS_CACHE_TTL_SECONDS)
    return Response(payload)


class Echo:
    def write(self, value):
        return value


def stream_csv(header_row, data_rows):
    pseudo_buffer = Echo()
    writer = csv.writer(pseudo_buffer)
    yield writer.writerow(header_row)
    for row in data_rows:
        yield writer.writerow(row)


@api_view(["GET"])
@permission_classes([IsAdminUser])
@throttle_classes([AnalyticsExportThrottle])
def navigation_analytics_export(request):
    queryset, days, cutoff = get_analytics_base_queryset(request)
    export_type = (request.query_params.get("type") or "routes").strip().lower()

    if export_type == "routes":
        rows_queryset = queryset.values("start_node_id", "end_node_id").annotate(
            startName=F("start_node__name"),
            endName=F("end_node__name"),
            count=Count("id"),
            avgDistance=Coalesce(Avg("route_distance"), 0.0),
            avgEtaSeconds=Coalesce(Avg("duration_seconds"), 0.0),
        ).order_by("-count", "start_node_id", "end_node_id")

        header = ["start_node", "end_node", "session_count", "avg_distance_m", "avg_eta_seconds"]
        row_iterator = (
            [
                row["startName"] or row["start_node_id"] or "",
                row["endName"] or row["end_node_id"] or "",
                row["count"],
                round(float(row["avgDistance"]), 2),
                round(float(row["avgEtaSeconds"]), 2),
            ]
            for row in rows_queryset.iterator()
        )
        filename = f"analytics_routes_{days}d.csv"
    elif export_type == "connectors":
        rows_queryset = (
            NavigationSessionNodeUsage.objects.filter(
                session__created_at__gte=cutoff,
                is_connector=True,
            )
            .values("node_id")
            .annotate(
                name=F("node__name"),
                building=F("node__building"),
                floor=F("floor"),
                count=Coalesce(Sum("hits"), 0),
            )
            .order_by("-count", "name", "node_id")
        )

        header = ["connector_node_id", "connector_name", "building", "floor", "usage_count"]
        row_iterator = (
            [
                row["node_id"],
                row["name"] or "",
                row["building"] or "",
                row["floor"],
                int(row["count"]),
            ]
            for row in rows_queryset.iterator()
        )
        filename = f"analytics_connectors_{days}d.csv"
    elif export_type == "daily":
        rows_queryset = queryset.annotate(day=TruncDate("created_at")).values("day").annotate(
            totalSessions=Count("id"),
            completedSessions=Count("id", filter=Q(completed=True)),
            avgDistance=Coalesce(Avg("route_distance"), 0.0),
            avgEtaSeconds=Coalesce(Avg("duration_seconds"), 0.0),
        ).order_by("day")

        header = [
            "day",
            "total_sessions",
            "completed_sessions",
            "avg_distance_m",
            "avg_eta_seconds",
        ]
        row_iterator = (
            [
                row["day"].isoformat() if row["day"] else "",
                row["totalSessions"],
                row["completedSessions"],
                round(float(row["avgDistance"]), 2),
                round(float(row["avgEtaSeconds"]), 2),
            ]
            for row in rows_queryset.iterator()
        )
        filename = f"analytics_daily_{days}d.csv"
    else:
        return Response(
            {
                "detail": "Invalid export type. Supported values: routes, connectors, daily."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    response = StreamingHttpResponse(
        streaming_content=stream_csv(header, row_iterator),
        content_type="text/csv",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
