import heapq
import random
import time
from statistics import mean

from django.core.management.base import BaseCommand, CommandError

from navigation.models import Node, NodeEdge


def dijkstra(adjacency_list, start_id, end_id):
    if start_id not in adjacency_list or end_id not in adjacency_list:
        return []

    distances = {node_id: float("inf") for node_id in adjacency_list}
    previous = {node_id: None for node_id in adjacency_list}
    distances[start_id] = 0.0
    heap = [(0.0, start_id)]

    while heap:
        current_distance, current_node = heapq.heappop(heap)
        if current_distance > distances[current_node]:
            continue

        if current_node == end_id:
            break

        for neighbor_id, weight in adjacency_list[current_node].items():
            tentative_distance = current_distance + weight
            if tentative_distance >= distances[neighbor_id]:
                continue

            distances[neighbor_id] = tentative_distance
            previous[neighbor_id] = current_node
            heapq.heappush(heap, (tentative_distance, neighbor_id))

    if distances[end_id] == float("inf"):
        return []

    path = []
    cursor = end_id
    while cursor is not None:
        path.append(cursor)
        cursor = previous[cursor]
    path.reverse()
    return path


def percentile(values, p):
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = int(round((len(sorted_values) - 1) * p))
    return sorted_values[index]


class Command(BaseCommand):
    help = "Benchmark navigation graph hydration and Dijkstra route compute performance."

    def add_arguments(self, parser):
        parser.add_argument(
            "--runs",
            type=int,
            default=100,
            help="Number of routing runs for benchmark mode (default: 100).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=42,
            help="Random seed for route pair sampling.",
        )
        parser.add_argument("--start-node", type=str, default="", help="Fixed start node ID.")
        parser.add_argument("--end-node", type=str, default="", help="Fixed end node ID.")

    def handle(self, *args, **options):
        runs = max(1, options["runs"])
        random.seed(options["seed"])

        hydration_start = time.perf_counter()
        nodes = list(Node.objects.only("id"))
        edges = list(NodeEdge.objects.only("from_node_id", "to_node_id", "distance"))

        adjacency_list = {node.id: {} for node in nodes}
        for edge in edges:
            adjacency_list[edge.from_node_id][edge.to_node_id] = edge.distance
        hydration_ms = (time.perf_counter() - hydration_start) * 1000

        node_ids = list(adjacency_list.keys())
        if len(node_ids) < 2:
            raise CommandError("Need at least 2 nodes to benchmark navigation routing.")

        start_node_id = (options["start_node"] or "").strip()
        end_node_id = (options["end_node"] or "").strip()

        if bool(start_node_id) != bool(end_node_id):
            raise CommandError("Provide both --start-node and --end-node together.")

        if start_node_id and end_node_id:
            if start_node_id not in adjacency_list or end_node_id not in adjacency_list:
                raise CommandError("Provided start/end node IDs do not exist in the graph.")
            route_pairs = [(start_node_id, end_node_id)]
        else:
            route_pairs = []
            while len(route_pairs) < runs:
                start_id, end_id = random.sample(node_ids, 2)
                route_pairs.append((start_id, end_id))

        compute_times_ms = []
        path_lengths = []
        no_path_count = 0

        for start_id, end_id in route_pairs:
            run_start = time.perf_counter()
            path = dijkstra(adjacency_list, start_id, end_id)
            compute_times_ms.append((time.perf_counter() - run_start) * 1000)

            if len(path) < 2:
                no_path_count += 1
                continue
            path_lengths.append(len(path))

        average_ms = mean(compute_times_ms)
        p95_ms = percentile(compute_times_ms, 0.95)
        max_ms = max(compute_times_ms)
        average_path_length = mean(path_lengths) if path_lengths else 0.0

        self.stdout.write(self.style.SUCCESS("Navigation benchmark complete."))
        self.stdout.write(f"Graph hydration: {hydration_ms:.2f} ms")
        self.stdout.write(f"Nodes: {len(nodes)}")
        self.stdout.write(f"Directed edges: {len(edges)}")
        self.stdout.write(f"Runs: {len(route_pairs)}")
        self.stdout.write(f"Route compute avg: {average_ms:.3f} ms")
        self.stdout.write(f"Route compute p95: {p95_ms:.3f} ms")
        self.stdout.write(f"Route compute max: {max_ms:.3f} ms")
        self.stdout.write(f"No-path results: {no_path_count}")
        self.stdout.write(f"Average path node count: {average_path_length:.2f}")
