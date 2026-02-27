const HELP_ITEMS = [
  {
    title: "Campus Security",
    detail: "+91 90000 00001",
    note: "24/7 security desk for safety incidents and escort requests.",
  },
  {
    title: "Medical Support",
    detail: "+91 90000 00002",
    note: "First-aid room and ambulance coordination.",
  },
  {
    title: "Transport Helpdesk",
    detail: "+91 90000 00003",
    note: "Bus timings, route updates, and lost-and-found support.",
  },
  {
    title: "IT Support",
    detail: "support@vbit.edu.in",
    note: "App access, account recovery, and technical issues.",
  },
]

function HelpPanel() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Emergency and Assistance</h2>
        <p>Critical contacts and support channels for rapid response.</p>
      </div>

      <div className="help-grid">
        {HELP_ITEMS.map((item) => (
          <article key={item.title} className="help-card">
            <h3>{item.title}</h3>
            <p className="help-detail">{item.detail}</p>
            <p className="help-note">{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default HelpPanel
