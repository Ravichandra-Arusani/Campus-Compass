// src/indoor/pragathiGraph.js

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

  nodes[rooms.slot1.id] = { x: 260, y: 143, label: rooms.slot1.label, floor }
  nodes[rooms.slot2.id] = { x: 260, y: 278, label: rooms.slot2.label, floor }
  nodes[rooms.slot3.id] = { x: 260, y: 413, label: rooms.slot3.label, floor }

  if (rooms.slot4) nodes[rooms.slot4.id] = { x: 130, y: 548, label: rooms.slot4.label, floor }
  if (rooms.slot5) nodes[rooms.slot5.id] = { x: 375, y: 548, label: rooms.slot5.label, floor }

  const edges = {
    stairs: ["stairs_landing"],
    stairs_landing: ["stairs", "left_connector_corridor"],
    left_connector_corridor: ["stairs_landing", "bottom_corridor"],
    bottom_corridor: ["left_connector_corridor", "right_vertical_corridor", "wash_access"],
    right_vertical_corridor: ["bottom_corridor", "corridor_hod"],
    corridor_hod: ["right_vertical_corridor", "corridor_b"],
    corridor_b: ["corridor_hod", "corridor_c", rooms.slot3.id],
    corridor_c: ["corridor_b", "corridor_d", rooms.slot2.id],
    corridor_d: ["corridor_c", rooms.slot1.id],
    wash_access: ["bottom_corridor"],
  }

  if (rooms.slot5) {
    edges.corridor_hod.push(rooms.slot5.id)
    edges[rooms.slot5.id] = ["corridor_hod"]
  }
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
  slot1: { id: "class_301_p", label: "Classroom 301" },
  slot2: { id: "class_302_p", label: "Classroom 302" },
  slot3: { id: "comp_lab", label: "Computer Lab" },
  slot4: { id: "washroom_3p", label: "Washroom" },
  slot5: { id: "staff_3", label: "Staff Room" }
})

export const floor2 = createFloorTopology(2, {
  slot1: { id: "class_201_p", label: "Classroom 201" },
  slot2: { id: "class_202_p", label: "Classroom 202" },
  slot3: { id: "class_203_p", label: "Classroom 203" },
  slot4: { id: "washroom_2p", label: "Washroom" },
  slot5: { id: "seminar_hall", label: "Seminar Hall" }
})

export const floor1 = createFloorTopology(1, {
  slot1: { id: "class_101_p", label: "Classroom 101" },
  slot2: { id: "class_102_p", label: "Classroom 102" },
  slot3: { id: "accounts", label: "Accounts Dept" },
  slot4: { id: "washroom_1p", label: "Washroom" },
  slot5: { id: "admin_office", label: "Admin Office" }
})
