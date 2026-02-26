import math

from django.core.management.base import BaseCommand
from django.utils import timezone

from navigation.models import (
    Building,
    Edge,
    GraphVersion,
    NavigationSession,
    Node,
    NodeEdge,
    Room,
)


class Command(BaseCommand):
    help = "Seed initial campus buildings, rooms, and navigation graph"

    def handle(self, *args, **kwargs):
        NavigationSession.objects.all().delete()
        NodeEdge.objects.all().delete()
        Node.objects.all().delete()
        GraphVersion.objects.all().delete()
        Room.objects.all().delete()
        Building.objects.all().delete()
        Edge.objects.all().delete()

        buildings_data = [
            ("Library", -4.4, 1.5, -3.2),
            ("Engineering", -1.5, 2, -2.2),
            ("Innovation", 2.1, 1.7, -3.6),
            ("Student Hub", 4.7, 1.1, -1.2),
            ("Medical", -4.2, 1.2, 1.9),
            ("Sports", -0.2, 1.4, 2.8),
            ("Admin", 4.3, 1.8, 2.4),
        ]

        building_map = {}
        for name, x, y, z in buildings_data:
            building_map[name] = Building.objects.create(name=name, x=x, y=y, z=z)

        building_connections = [
            ("Library", "Engineering"),
            ("Library", "Medical"),
            ("Engineering", "Innovation"),
            ("Engineering", "Sports"),
            ("Innovation", "Student Hub"),
            ("Innovation", "Admin"),
            ("Student Hub", "Admin"),
            ("Sports", "Medical"),
            ("Sports", "Admin"),
        ]

        def building_distance(from_building, to_building):
            return math.sqrt(
                (from_building.x - to_building.x) ** 2
                + (from_building.y - to_building.y) ** 2
                + (from_building.z - to_building.z) ** 2
            )

        for from_name, to_name in building_connections:
            from_building = building_map[from_name]
            to_building = building_map[to_name]
            distance = building_distance(from_building, to_building)
            Edge.objects.create(
                from_building=from_building,
                to_building=to_building,
                weight=distance,
            )
            Edge.objects.create(
                from_building=to_building,
                to_building=from_building,
                weight=distance,
            )

        rooms_by_building = {
            "Library": [("L101", 80, 26), ("L204", 40, 35), ("L310", 30, 18)],
            "Engineering": [("E201", 60, 22), ("E305", 45, 38), ("E408", 35, 12)],
            "Innovation": [("I110", 55, 16), ("I220", 25, 25), ("I405", 40, 19)],
            "Student Hub": [("S102", 100, 71), ("S208", 35, 14), ("S315", 50, 33)],
            "Medical": [("M120", 45, 41), ("M211", 30, 12), ("M330", 20, 8)],
            "Sports": [("SP1", 120, 68), ("SP2", 80, 75), ("SP3", 40, 17)],
            "Admin": [("A101", 30, 21), ("A210", 22, 9), ("A330", 18, 13)],
        }

        for building_name, room_data in rooms_by_building.items():
            for room_name, capacity, occupancy in room_data:
                Room.objects.create(
                    building=building_map[building_name],
                    name=room_name,
                    capacity=capacity,
                    current_occupancy=occupancy,
                )

        node_data = {
            "eng-e201": {
                "lat": 17.4457,
                "lng": 78.3494,
                "floor": 2,
                "building": "Engineering Block",
                "name": "E201",
                "kind": Node.Kind.ROOM,
                "connector_type": "",
            },
            "eng-e305": {
                "lat": 17.4462,
                "lng": 78.3501,
                "floor": 2,
                "building": "Engineering Block",
                "name": "E305",
                "kind": Node.Kind.ROOM,
                "connector_type": "",
            },
            "lib-l102": {
                "lat": 17.4449,
                "lng": 78.3486,
                "floor": 1,
                "building": "Central Library",
                "name": "L102",
                "kind": Node.Kind.ROOM,
                "connector_type": "",
            },
            "hub-h006": {
                "lat": 17.4452,
                "lng": 78.3508,
                "floor": 1,
                "building": "Student Hub",
                "name": "H006",
                "kind": Node.Kind.ROOM,
                "connector_type": "",
            },
            "med-m210": {
                "lat": 17.4443,
                "lng": 78.3497,
                "floor": 2,
                "building": "Medical Sciences",
                "name": "M210",
                "kind": Node.Kind.ROOM,
                "connector_type": "",
            },
            "adm-a111": {
                "lat": 17.4465,
                "lng": 78.3489,
                "floor": 1,
                "building": "Administration",
                "name": "A111",
                "kind": Node.Kind.ROOM,
                "connector_type": "",
            },
            "eng-stair-1f": {
                "lat": 17.4459,
                "lng": 78.3497,
                "floor": 1,
                "building": "Engineering Block",
                "name": "Engineering Stairs",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.STAIRS,
            },
            "eng-stair-2f": {
                "lat": 17.4459,
                "lng": 78.3497,
                "floor": 2,
                "building": "Engineering Block",
                "name": "Engineering Stairs",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.STAIRS,
            },
            "eng-lift-1f": {
                "lat": 17.4460,
                "lng": 78.3498,
                "floor": 1,
                "building": "Engineering Block",
                "name": "Engineering Lift",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.ELEVATOR,
            },
            "eng-lift-2f": {
                "lat": 17.4460,
                "lng": 78.3498,
                "floor": 2,
                "building": "Engineering Block",
                "name": "Engineering Lift",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.ELEVATOR,
            },
            "med-stair-1f": {
                "lat": 17.4445,
                "lng": 78.3496,
                "floor": 1,
                "building": "Medical Sciences",
                "name": "Medical Stairs",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.STAIRS,
            },
            "med-stair-2f": {
                "lat": 17.4445,
                "lng": 78.3496,
                "floor": 2,
                "building": "Medical Sciences",
                "name": "Medical Stairs",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.STAIRS,
            },
            "med-lift-1f": {
                "lat": 17.4446,
                "lng": 78.3498,
                "floor": 1,
                "building": "Medical Sciences",
                "name": "Medical Lift",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.ELEVATOR,
            },
            "med-lift-2f": {
                "lat": 17.4446,
                "lng": 78.3498,
                "floor": 2,
                "building": "Medical Sciences",
                "name": "Medical Lift",
                "kind": Node.Kind.CONNECTOR,
                "connector_type": Node.ConnectorType.ELEVATOR,
            },
        }

        node_map = {}
        for node_id, payload in node_data.items():
            node_map[node_id] = Node.objects.create(id=node_id, **payload)

        horizontal_edges = [
            ("eng-e201", "eng-e305"),
            ("eng-e201", "eng-stair-2f"),
            ("eng-e201", "eng-lift-2f"),
            ("eng-e305", "eng-stair-2f"),
            ("eng-e305", "eng-lift-2f"),
            ("med-m210", "med-stair-2f"),
            ("med-m210", "med-lift-2f"),
            ("lib-l102", "eng-stair-1f"),
            ("lib-l102", "eng-lift-1f"),
            ("lib-l102", "med-stair-1f"),
            ("lib-l102", "med-lift-1f"),
            ("lib-l102", "adm-a111"),
            ("hub-h006", "adm-a111"),
            ("hub-h006", "eng-stair-1f"),
            ("adm-a111", "eng-stair-1f"),
            ("adm-a111", "med-stair-1f"),
        ]

        vertical_edges = [
            ("eng-stair-1f", "eng-stair-2f", 9.0, NodeEdge.Mode.STAIRS),
            ("eng-lift-1f", "eng-lift-2f", 6.0, NodeEdge.Mode.ELEVATOR),
            ("med-stair-1f", "med-stair-2f", 9.0, NodeEdge.Mode.STAIRS),
            ("med-lift-1f", "med-lift-2f", 6.0, NodeEdge.Mode.ELEVATOR),
        ]

        def geo_distance(from_node, to_node):
            return (
                math.sqrt((from_node.lat - to_node.lat) ** 2 + (from_node.lng - to_node.lng) ** 2)
                * 111320
            )

        for from_id, to_id in horizontal_edges:
            from_node = node_map[from_id]
            to_node = node_map[to_id]
            distance = geo_distance(from_node, to_node)
            NodeEdge.objects.create(
                from_node=from_node,
                to_node=to_node,
                distance=distance,
                mode=NodeEdge.Mode.WALK,
            )

        for from_id, to_id, distance, mode in vertical_edges:
            from_node = node_map[from_id]
            to_node = node_map[to_id]
            NodeEdge.objects.create(
                from_node=from_node,
                to_node=to_node,
                distance=distance,
                mode=mode,
            )

        graph_version = GraphVersion.get_current()
        GraphVersion.objects.filter(pk=graph_version.pk).update(
            version=1,
            updated_at=timezone.now(),
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Database seeded successfully (buildings, rooms, navigation graph, version reset)."
            )
        )
