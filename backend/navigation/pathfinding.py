import math

from .models import Building, Edge

WALKING_SPEED_M_PER_S = 1.4
# Coordinates in this demo are map units, so scale them to a practical walking distance.
MAP_UNIT_TO_METERS = 15.0


def euclidean_distance(a, b):
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def reconstruct_path(came_from, current):
    path = [current]
    while current in came_from:
        current = came_from[current]
        path.insert(0, current)
    return path


def to_meters(map_distance):
    return map_distance * MAP_UNIT_TO_METERS


def estimate_time_minutes(distance_meters):
    return distance_meters / WALKING_SPEED_M_PER_S / 60


def find_shortest_path(start_name, end_name):
    try:
        start = Building.objects.get(name=start_name)
        end = Building.objects.get(name=end_name)
    except Building.DoesNotExist:
        return {"path": [], "distance": 0.0, "estimated_time_minutes": 0.0}

    open_set = [start]
    came_from = {}

    buildings = list(Building.objects.all())
    g_score = {b: float("inf") for b in buildings}
    f_score = {b: float("inf") for b in buildings}

    g_score[start] = 0
    f_score[start] = euclidean_distance(start, end)

    while open_set:
        open_set.sort(key=lambda b: f_score[b])
        current = open_set.pop(0)

        if current == end:
            path = [b.name for b in reconstruct_path(came_from, current)]
            distance = to_meters(g_score[current])
            eta_minutes = estimate_time_minutes(distance)
            return {
                "path": path,
                "distance": round(distance, 1),
                "estimated_time_minutes": round(eta_minutes, 1),
            }

        edges = Edge.objects.filter(from_building=current).select_related("to_building")

        for edge in edges:
            neighbor = edge.to_building
            tentative_g = g_score[current] + edge.weight

            if tentative_g < g_score[neighbor]:
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g
                f_score[neighbor] = tentative_g + euclidean_distance(neighbor, end)

                if neighbor not in open_set:
                    open_set.append(neighbor)

    return {"path": [], "distance": 0.0, "estimated_time_minutes": 0.0}
