import { campusClassrooms } from "../data/campusData"

function ClassroomSignal() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Classroom Signal</h2>
        <p>Live occupancy signals with fast visual availability status.</p>
      </div>

      <div className="signal-grid">
        {campusClassrooms.map((room) => {
          const ratio = room.currentOccupancy / room.capacity
          const available = ratio < 0.8

          return (
            <article className="signal-card" key={room.id}>
              <header className="signal-title-row">
                <h3>{room.name}</h3>
                <span className={available ? "signal-dot available" : "signal-dot busy"} />
              </header>
              <p className="signal-building">{room.building}</p>

              <div className="signal-metrics">
                <span>{room.currentOccupancy} occupied</span>
                <span>{room.capacity} capacity</span>
              </div>

              <div className="signal-bar-track" role="presentation">
                <div
                  className={available ? "signal-bar-fill available" : "signal-bar-fill busy"}
                  style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                />
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default ClassroomSignal
