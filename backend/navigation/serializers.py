from collections import Counter

from rest_framework import serializers

from .models import (
    Building,
    GraphVersion,
    NavigationSession,
    NavigationSessionNodeUsage,
    Node,
    NodeEdge,
    Room,
)


class RouteRequestSerializer(serializers.Serializer):
    start = serializers.CharField()
    end = serializers.CharField()


class BuildingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Building
        fields = ("id", "name", "x", "y", "z")


class RoomAvailabilitySerializer(serializers.ModelSerializer):
    building = serializers.CharField(source="building.name", read_only=True)
    floor = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = (
            "id",
            "name",
            "type",
            "building",
            "floor",
            "capacity",
            "current_occupancy",
            "is_available",
            "available",
        )

    def get_floor(self, obj):
        return None

    def get_is_available(self, obj):
        if not obj.capacity:
            return True
        return obj.current_occupancy < obj.capacity

    def get_available(self, obj):
        return self.get_is_available(obj)


class NodeSerializer(serializers.ModelSerializer):
    connectorType = serializers.CharField(source="connector_type", allow_blank=True)

    class Meta:
        model = Node
        fields = ("id", "lat", "lng", "floor", "building", "name", "kind", "connectorType")


class NodeEdgeSerializer(serializers.ModelSerializer):
    fromId = serializers.CharField(source="from_node_id")
    toId = serializers.CharField(source="to_node_id")

    class Meta:
        model = NodeEdge
        fields = ("fromId", "toId", "distance", "mode")


class GraphVersionSerializer(serializers.ModelSerializer):
    updatedAt = serializers.DateTimeField(source="updated_at")

    class Meta:
        model = GraphVersion
        fields = ("version", "updatedAt")


class NavigationSessionWriteSerializer(serializers.Serializer):
    startNodeId = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    endNodeId = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    preferenceMode = serializers.CharField(required=False, default="default")
    routeNodeIds = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
    )
    routeDistance = serializers.FloatField(required=False, min_value=0, default=0)
    durationSeconds = serializers.FloatField(required=False, min_value=0, default=0)
    completed = serializers.BooleanField(required=False, default=False)

    def create(self, validated_data):
        start_id = validated_data.get("startNodeId") or None
        end_id = validated_data.get("endNodeId") or None
        route_node_ids = validated_data.get("routeNodeIds", [])
        request = self.context.get("request")
        user = request.user if request and request.user.is_authenticated else None

        session = NavigationSession.objects.create(
            user=user,
            start_node=Node.objects.filter(pk=start_id).first() if start_id else None,
            end_node=Node.objects.filter(pk=end_id).first() if end_id else None,
            preference_mode=validated_data.get("preferenceMode", "default"),
            route_node_count=len(route_node_ids),
            route_distance=validated_data.get("routeDistance", 0),
            duration_seconds=validated_data.get("durationSeconds", 0),
            completed=validated_data.get("completed", False),
            route_node_ids=route_node_ids,
        )

        if route_node_ids:
            node_lookup = Node.objects.in_bulk(route_node_ids)
            node_hit_counts = Counter(route_node_ids)
            usage_rows = []

            for node_id, hits in node_hit_counts.items():
                node = node_lookup.get(node_id)
                if not node:
                    continue

                usage_rows.append(
                    NavigationSessionNodeUsage(
                        session=session,
                        node=node,
                        floor=node.floor,
                        is_connector=node.kind == Node.Kind.CONNECTOR,
                        hits=hits,
                    )
                )

            if usage_rows:
                NavigationSessionNodeUsage.objects.bulk_create(usage_rows)

        return session


class NavigationSessionSerializer(serializers.ModelSerializer):
    userId = serializers.IntegerField(source="user_id", allow_null=True)
    startNodeId = serializers.CharField(source="start_node_id", allow_null=True)
    endNodeId = serializers.CharField(source="end_node_id", allow_null=True)
    preferenceMode = serializers.CharField(source="preference_mode")
    routeNodeCount = serializers.IntegerField(source="route_node_count")
    routeDistance = serializers.FloatField(source="route_distance")
    durationSeconds = serializers.FloatField(source="duration_seconds")
    routeNodeIds = serializers.ListField(source="route_node_ids")
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = NavigationSession
        fields = (
            "id",
            "userId",
            "startNodeId",
            "endNodeId",
            "preferenceMode",
            "routeNodeCount",
            "routeDistance",
            "durationSeconds",
            "completed",
            "routeNodeIds",
            "createdAt",
        )
