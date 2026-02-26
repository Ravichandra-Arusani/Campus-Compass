// src/indoor/nirmithiGraph.js
// Nirmithi Block - 3rd Floor (CSBS Dept)
// Topology aligned to drawing:
// - stairs at bottom-left zone
// - landing + left connector feed into bottom corridor
// - bottom corridor joins the right vertical corridor spine
// - room access uses door-anchor nodes for clean orthogonal rendering

export const nodes = {
  // Start point (bottom-left stairs zone)
  stairs:                  { x: 100, y: 695, label: "Stairs",           floor: 3 },
  stairs_landing:          { x: 100, y: 620, label: "Corridor",         floor: 3 },
  left_connector_corridor: { x: 160, y: 620, label: "Corridor",         floor: 3 },
  bottom_corridor:         { x: 260, y: 620, label: "Corridor",         floor: 3 },
  right_vertical_corridor: { x: 560, y: 620, label: "Corridor",         floor: 3 },

  // Main vertical corridor spine on the right side
  corridor_b:              { x: 560, y: 413, label: "Corridor",         floor: 3 },
  corridor_c:              { x: 560, y: 278, label: "Corridor",         floor: 3 },
  corridor_d:              { x: 560, y: 143, label: "Corridor",         floor: 3 },

  // Door anchors on bottom corridor (prevents routes crossing room centers)
  hod_access:              { x: 375, y: 620, label: "Corridor",         floor: 3 },
  wash_access:             { x: 130, y: 620, label: "Corridor",         floor: 3 },

  // Destination nodes (aligned to room block centers)
  hod_302:                 { x: 375, y: 548, label: "HOD Office (302)", floor: 3 },
  washroom:                { x: 130, y: 548, label: "Boys Washroom",    floor: 3 },
  class_303:               { x: 260, y: 413, label: "Classroom 303",    floor: 3 },
  lab_304:                 { x: 260, y: 278, label: "Lab 304",          floor: 3 },
  class_305:               { x: 260, y: 143, label: "Classroom 305",    floor: 3 },
}

export const edges = {
  // Circulation path: stairs -> landing -> connector -> bottom -> right vertical
  stairs:                  ["stairs_landing"],
  stairs_landing:          ["stairs", "left_connector_corridor"],
  left_connector_corridor: ["stairs_landing", "bottom_corridor"],
  bottom_corridor:         ["left_connector_corridor", "right_vertical_corridor", "hod_access", "wash_access"],
  right_vertical_corridor: ["bottom_corridor", "corridor_b"],

  // Vertical corridor spine
  corridor_b:              ["right_vertical_corridor", "corridor_c", "class_303"],
  corridor_c:              ["corridor_b", "corridor_d", "lab_304"],
  corridor_d:              ["corridor_c", "class_305"],

  // Room entries
  hod_access:              ["bottom_corridor", "hod_302"],
  wash_access:             ["bottom_corridor", "washroom"],
  hod_302:                 ["hod_access"],
  washroom:                ["wash_access"],

  class_303:               ["corridor_b"],
  lab_304:                 ["corridor_c"],
  class_305:               ["corridor_d"],
}
