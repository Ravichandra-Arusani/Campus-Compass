
const HELP_STEPS = [
  "Select start building, floor, and room in Indoor Navigation.",
  "Choose destination building, floor, and room, then compute route.",
  "Follow indoor path guidance and use outdoor transition map for cross-building travel.",
  "Use Room Availability to check room occupancy before reaching destination.",
]

const HELP_LEGEND = [
  { key: "Cyan Route Line", value: "Active shortest path" },
  { key: "White Nodes", value: "Reachable graph nodes" },
  { key: "Green Signal", value: "Room available" },
  { key: "Red Signal", value: "Room near/full occupancy" },
]

export default function Help() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Help</h2>
        <p>Navigation usage guide, route legend, and emergency contact channels.</p>
      </div>

      <section className="help-howto">
        <h3>How To Use</h3>
        <ol>
          {HELP_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="help-legend">
        <h3>Route Legend</h3>
        <ul>
          {HELP_LEGEND.map((item) => (
            <li key={item.key}>
              <span>{item.key}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      </section></section>
  )
}


