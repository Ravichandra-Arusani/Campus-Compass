
function HelpPanel() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Emergency and Assistance</h2>
        <p>Critical contacts and support channels for rapid response.</p>
      </div>

      <div className="help-grid">
        >
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

