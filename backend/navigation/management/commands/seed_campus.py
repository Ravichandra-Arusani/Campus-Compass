"""
Management command: seed_campus
Usage: python manage.py seed_campus

Seeds the new campus graph models:
  - 4 CampusBuildings (VBIT coordinates)
  - 12 Classrooms across floors 1-3 in Aakash and Nirmithi blocks
  - CampusNodes: MAIN_GATE -> CENTRAL_PLAZA -> building entries -> corridors -> staircases -> rooms
  - CampusEdges connecting the full graph
"""

import math

from django.core.management.base import BaseCommand

from navigation.models import (
    CampusBuilding,
    CampusEdge,
    CampusNode,
    Classroom,
)

NT = CampusNode.NodeType


def haversine_m(lat1, lng1, lat2, lng2):
    """Return great-circle distance in metres."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class Command(BaseCommand):
    help = "Seed campus buildings, classrooms, nodes and edges for the navigation API"

    def handle(self, *args, **kwargs):
        self.stdout.write("Clearing existing campus data...")
        CampusEdge.objects.all().delete()
        CampusNode.objects.all().delete()
        Classroom.objects.all().delete()
        CampusBuilding.objects.all().delete()

        # ------------------------------------------------------------------
        # 1. Buildings
        # ------------------------------------------------------------------
        self.stdout.write("Creating buildings...")
        buildings_data = [
            ("Aakash Block",   17.4515, 78.5580, "AAKASH"),
            ("Nirmithi Block", 17.4520, 78.5590, "NIRMITHI"),
            ("Admin Block",    17.4510, 78.5575, "ADMIN"),
            ("Library",        17.4525, 78.5585, "LIB"),
        ]
        bmap = {}  # short_code -> CampusBuilding
        for name, lat, lng, code in buildings_data:
            b = CampusBuilding.objects.create(name=name, latitude=lat, longitude=lng, short_code=code)
            bmap[code] = b
            self.stdout.write(f"  Building: {name}")

        # ------------------------------------------------------------------
        # 2. Classrooms  (mix of available / occupied)
        # ------------------------------------------------------------------
        self.stdout.write("Creating classrooms...")
        classrooms_data = [
            # room_id, name, building_code, floor, capacity, status
            ("A101", "Aakash Room 101", "AAKASH",   1, 60, "available"),
            ("A102", "Aakash Room 102", "AAKASH",   1, 60, "occupied"),
            ("A201", "Aakash Room 201", "AAKASH",   2, 60, "available"),
            ("A202", "Aakash Room 202", "AAKASH",   2, 40, "occupied"),
            ("A301", "Aakash Room 301", "AAKASH",   3, 40, "available"),
            ("A302", "Aakash HOD Room", "AAKASH",   3, 20, "occupied"),
            ("N101", "Nirmithi Room 101", "NIRMITHI", 1, 60, "available"),
            ("N102", "Nirmithi Room 102", "NIRMITHI", 1, 60, "occupied"),
            ("N201", "Nirmithi Room 201", "NIRMITHI", 2, 60, "available"),
            ("N302", "Nirmithi Room 302", "NIRMITHI", 3, 40, "available"),
            ("N303", "Nirmithi HOD Room", "NIRMITHI", 3, 20, "occupied"),
            ("ADM1", "Admin Office",    "ADMIN",    1, 20, "occupied"),
        ]
        cmap = {}  # room_id -> Classroom
        for room_id, name, bcode, floor, cap, stat in classrooms_data:
            cls = Classroom.objects.create(
                room_id=room_id,
                name=name,
                building=bmap[bcode],
                floor=floor,
                capacity=cap,
                status=stat,
            )
            cmap[room_id] = cls
            self.stdout.write(f"  Classroom: {room_id} [{stat}]")

        # ------------------------------------------------------------------
        # 3. Campus Nodes
        # ------------------------------------------------------------------
        self.stdout.write("Creating campus nodes...")

        # Format: node_id, name, node_type, lat, lng, floor, building_code (or None)
        nodes_data = [
            # Outdoor / gate
            ("MAIN_GATE",      "Main Gate",            NT.OUTDOOR,   17.4505, 78.5565, None, None),
            ("CENTRAL_PLAZA",  "Central Plaza",        NT.OUTDOOR,   17.4510, 78.5572, None, None),
            # Aakash block
            ("AAKASH_ENTRY",   "Aakash Block Entry",   NT.ENTRY,     17.4515, 78.5580, 1,   "AAKASH"),
            ("AAKASH_CORR_F1", "Aakash Corridor F1",   NT.CORRIDOR,  17.4515, 78.5581, 1,   "AAKASH"),
            ("AAKASH_STAIR",   "Aakash Staircase",     NT.STAIRCASE, 17.4516, 78.5581, 1,   "AAKASH"),
            ("AAKASH_CORR_F2", "Aakash Corridor F2",   NT.CORRIDOR,  17.4516, 78.5581, 2,   "AAKASH"),
            ("AAKASH_CORR_F3", "Aakash Corridor F3",   NT.CORRIDOR,  17.4516, 78.5581, 3,   "AAKASH"),
            ("A101_NODE",      "Aakash Room 101",       NT.INDOOR,    None,    None,    1,   "AAKASH"),
            ("A102_NODE",      "Aakash Room 102",       NT.INDOOR,    None,    None,    1,   "AAKASH"),
            ("A201_NODE",      "Aakash Room 201",       NT.INDOOR,    None,    None,    2,   "AAKASH"),
            ("A202_NODE",      "Aakash Room 202",       NT.INDOOR,    None,    None,    2,   "AAKASH"),
            ("A301_NODE",      "Aakash Room 301",       NT.INDOOR,    None,    None,    3,   "AAKASH"),
            ("A302_NODE",      "Aakash HOD Room",       NT.INDOOR,    None,    None,    3,   "AAKASH"),
            # Nirmithi block
            ("NIRMITHI_ENTRY",   "Nirmithi Block Entry",  NT.ENTRY,     17.4520, 78.5590, 1,   "NIRMITHI"),
            ("NIRMITHI_CORR_F1", "Nirmithi Corridor F1",  NT.CORRIDOR,  17.4520, 78.5591, 1,   "NIRMITHI"),
            ("NIRMITHI_STAIR",   "Nirmithi Staircase",    NT.STAIRCASE, 17.4521, 78.5591, 1,   "NIRMITHI"),
            ("NIRMITHI_CORR_F2", "Nirmithi Corridor F2",  NT.CORRIDOR,  17.4521, 78.5591, 2,   "NIRMITHI"),
            ("NIRMITHI_CORR_F3", "Nirmithi Corridor F3",  NT.CORRIDOR,  17.4521, 78.5591, 3,   "NIRMITHI"),
            ("N101_NODE",      "Nirmithi Room 101",     NT.INDOOR,    None,    None,    1,   "NIRMITHI"),
            ("N102_NODE",      "Nirmithi Room 102",     NT.INDOOR,    None,    None,    1,   "NIRMITHI"),
            ("N201_NODE",      "Nirmithi Room 201",     NT.INDOOR,    None,    None,    2,   "NIRMITHI"),
            ("N302_NODE",      "Nirmithi Room 302",     NT.INDOOR,    None,    None,    3,   "NIRMITHI"),
            ("N303_NODE",      "Nirmithi HOD Room",     NT.INDOOR,    None,    None,    3,   "NIRMITHI"),
            # Admin block
            ("ADMIN_ENTRY",    "Admin Block Entry",     NT.ENTRY,     17.4510, 78.5575, 1,   "ADMIN"),
            ("ADM1_NODE",      "Admin Office",          NT.INDOOR,    None,    None,    1,   "ADMIN"),
            # Library
            ("LIB_ENTRY",      "Library Entry",         NT.ENTRY,     17.4525, 78.5585, 1,   "LIB"),
        ]

        nmap = {}  # node_id -> CampusNode
        for node_id, name, ntype, lat, lng, floor, bcode in nodes_data:
            bldg = bmap[bcode] if bcode else None
            n = CampusNode.objects.create(
                node_id=node_id,
                name=name,
                node_type=ntype,
                latitude=lat,
                longitude=lng,
                floor=floor,
                building=bldg,
            )
            nmap[node_id] = n
        self.stdout.write(f"  Created {len(nmap)} campus nodes")

        # ------------------------------------------------------------------
        # 4. Edges
        # ------------------------------------------------------------------
        self.stdout.write("Creating campus edges...")

        def dist(a, b):
            an, bn = nmap[a], nmap[b]
            if an.latitude and bn.latitude:
                return haversine_m(an.latitude, an.longitude, bn.latitude, bn.longitude)
            return 10.0  # indoor fixed

        # List of (from_id, to_id, bidirectional)
        edge_list = [
            # Outdoor spine
            ("MAIN_GATE",      "CENTRAL_PLAZA",    True),
            ("CENTRAL_PLAZA",  "AAKASH_ENTRY",     True),
            ("CENTRAL_PLAZA",  "NIRMITHI_ENTRY",   True),
            ("CENTRAL_PLAZA",  "ADMIN_ENTRY",      True),
            ("CENTRAL_PLAZA",  "LIB_ENTRY",        True),
            # Aakash indoor F1
            ("AAKASH_ENTRY",   "AAKASH_CORR_F1",  True),
            ("AAKASH_CORR_F1", "AAKASH_STAIR",    True),
            ("AAKASH_CORR_F1", "A101_NODE",        True),
            ("AAKASH_CORR_F1", "A102_NODE",        True),
            # Aakash F2
            ("AAKASH_STAIR",   "AAKASH_CORR_F2",  True),
            ("AAKASH_CORR_F2", "A201_NODE",        True),
            ("AAKASH_CORR_F2", "A202_NODE",        True),
            # Aakash F3
            ("AAKASH_CORR_F2", "AAKASH_CORR_F3",  True),
            ("AAKASH_CORR_F3", "A301_NODE",        True),
            ("AAKASH_CORR_F3", "A302_NODE",        True),
            # Nirmithi indoor F1
            ("NIRMITHI_ENTRY",   "NIRMITHI_CORR_F1", True),
            ("NIRMITHI_CORR_F1", "NIRMITHI_STAIR",   True),
            ("NIRMITHI_CORR_F1", "N101_NODE",         True),
            ("NIRMITHI_CORR_F1", "N102_NODE",         True),
            # Nirmithi F2
            ("NIRMITHI_STAIR",   "NIRMITHI_CORR_F2", True),
            ("NIRMITHI_CORR_F2", "N201_NODE",         True),
            # Nirmithi F3
            ("NIRMITHI_CORR_F2", "NIRMITHI_CORR_F3", True),
            ("NIRMITHI_CORR_F3", "N302_NODE",         True),
            ("NIRMITHI_CORR_F3", "N303_NODE",         True),
            # Admin
            ("ADMIN_ENTRY",    "ADM1_NODE",         True),
        ]

        created = 0
        for fid, tid, bidir in edge_list:
            d = dist(fid, tid)
            CampusEdge.objects.get_or_create(
                from_node=nmap[fid],
                to_node=nmap[tid],
                defaults={"distance": round(d, 2), "bidirectional": bidir},
            )
            created += 1

        self.stdout.write(f"  Created {created} campus edges")

        self.stdout.write(self.style.SUCCESS(
            "\n✅ seed_campus complete!\n"
            f"   Buildings : {CampusBuilding.objects.count()}\n"
            f"   Classrooms: {Classroom.objects.count()}\n"
            f"   Nodes     : {CampusNode.objects.count()}\n"
            f"   Edges     : {CampusEdge.objects.count()}\n"
            "\nTest: GET /api/navigate/?source=MAIN_GATE&destination=N302_NODE"
        ))
