export function astar(nodes, edges, start, goal) {
  const open = new Set([start]);
  const cameFrom = {};
  const gScore = {};
  const fScore = {};

  Object.keys(nodes).forEach((key) => {
    gScore[key] = Infinity;
    fScore[key] = Infinity;
  });

  gScore[start] = 0;
  fScore[start] = heuristic(nodes[start], nodes[goal]);

  while (open.size > 0) {
    let current = [...open].reduce((a, b) =>
      fScore[a] < fScore[b] ? a : b
    );

    if (current === goal) {
      return reconstructPath(cameFrom, current);
    }

    open.delete(current);

    for (let neighbor of edges[current]) {
      const tentative = gScore[current] + 1;

      if (tentative < gScore[neighbor]) {
        cameFrom[neighbor] = current;
        gScore[neighbor] = tentative;
        fScore[neighbor] =
          tentative + heuristic(nodes[neighbor], nodes[goal]);
        open.add(neighbor);
      }
    }
  }

  return [];
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(cameFrom, current) {
  const path = [current];
  while (cameFrom[current]) {
    current = cameFrom[current];
    path.unshift(current);
  }
  return path;
}
