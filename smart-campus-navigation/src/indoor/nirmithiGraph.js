// src/indoor/nirmithiGraph.js

export function createFloorTopology(floor, rooms) {
  const nodes = {
    stairs: { x: 100, y: 695, label: "Stairs", floor },
    stairs_landing: { x: 100, y: 620, label: "Corridor", floor },
    left_connector_corridor: { x: 160, y: 620, label: "Corridor", floor },
    bottom_corridor: { x: 260, y: 620, label: "Corridor", floor },
    right_vertical_corridor: { x: 560, y: 620, label: "Corridor", floor },
    corridor_hod: { x: 560, y: 548, label: "Corridor", floor },
    corridor_b: { x: 560, y: 413, label: "Corridor", floor },
    corridor_c: { x: 560, y: 278, label: "Corridor", floor },
    corridor_d: { x: 560, y: 143, label: "Corridor", floor },
    wash_access: { x: 130, y: 620, label: "Corridor", floor },
  }

  // Inject room nodes mapped to standard slots
  // Slot 1: top classroom, Slot 2: mid classroom, Slot 3: bottom classroom, Slot 4: washroom, Slot 5: office
  nodes[rooms.slot1.id] = { x: 260, y: 143, label: rooms.slot1.label, floor }
  nodes[rooms.slot2.id] = { x: 260, y: 278, label: rooms.slot2.label, floor }
  nodes[rooms.slot3.id] = { x: 260, y: 413, label: rooms.slot3.label, floor }

  if (rooms.slot4) {
    nodes[rooms.slot4.id] = { x: 130, y: 548, label: rooms.slot4.label, floor }
  }

  nodes[rooms.slot5.id] = { x: 375, y: 548, label: rooms.slot5.label, floor }

  const edges = {
    stairs: ["stairs_landing"],
    stairs_landing: ["stairs", "left_connector_corridor"],
    left_connector_corridor: ["stairs_landing", "bottom_corridor"],
    bottom_corridor: ["left_connector_corridor", "right_vertical_corridor", "wash_access"],
    right_vertical_corridor: ["bottom_corridor", "corridor_hod"],

    corridor_hod: ["right_vertical_corridor", "corridor_b", rooms.slot5.id],
    corridor_b: ["corridor_hod", "corridor_c", rooms.slot3.id],
    corridor_c: ["corridor_b", "corridor_d", rooms.slot2.id],
    corridor_d: ["corridor_c", rooms.slot1.id],

    wash_access: ["bottom_corridor"],
  }

  // Room entries
  edges[rooms.slot5.id] = ["corridor_hod"]
  if (rooms.slot4) {
    edges.wash_access.push(rooms.slot4.id)
    edges[rooms.slot4.id] = ["wash_access"]
  }

  edges[rooms.slot3.id] = ["corridor_b"]
  edges[rooms.slot2.id] = ["corridor_c"]
  edges[rooms.slot1.id] = ["corridor_d"]

  return { nodes, edges }
}

export const floor3 = createFloorTopology(3, {
  slot1: { id: "class_305", label: "Classroom 305" },
  slot2: { id: "lab_304", label: "Lab 304" },
  slot3: { id: "class_303", label: "Classroom 303" },
  slot4: { id: "washroom", label: "Boys Washroom" },
  slot5: { id: "hod_302", label: "HOD Office (302)" }
})

export const floor2 = createFloorTopology(2, {
  slot1: { id: "class_205", label: "Classroom 205" },
  slot2: { id: "class_202", label: "Classroom 202" },
  slot3: { id: "lab_2", label: "Lab" },
  slot4: { id: "girls_washroom", label: "Girls Washroom" },
  slot5: { id: "staff_room", label: "Staff Room" }
})

export const floor1 = createFloorTopology(1, {
  slot1: { id: "class_105", label: "Classroom 105" },
  slot2: { id: "lab_102", label: "Lab 102" },
  slot3: { id: "class_101", label: "Classroom 101" },
  slot4: null, // Merged into Staff Room
  slot5: { id: "staff_room_f1", label: "Staff Room" }
})

export const nodes = floor3.nodes;
export const edges = floor3.edges;
