function StickyTabs({ activeTab, onChange, tabs }) {
  const tabItems = Array.isArray(tabs) && tabs.length > 0
    ? tabs
    : [
        { id: "map", label: "MAP" },
        { id: "indoor", label: "INDOOR NAVIGATION" },
        { id: "classroom", label: "ROOM AVAILABILITY" },
        { id: "help", label: "HELP" },
      ]

  return (
    <header className="tabs-header">
      <nav className="tabs-nav" aria-label="Campus dashboard tabs">
        {tabItems.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab ? "tab-button active" : "tab-button"}
            onClick={() => onChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  )
}

export default StickyTabs
