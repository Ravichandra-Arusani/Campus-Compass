import { useEffect, useId, useMemo, useRef, useState } from "react"
import Fuse from "fuse.js"

function buildSearchText(option) {
  if (!option) {
    return ""
  }

  const label = option.label || ""
  const searchText = option.searchText || ""
  return `${label} ${searchText}`.trim().toLowerCase()
}

function DestinationSearch({
  label,
  placeholder = "Search destination...",
  options = [],
  value = "",
  onChange,
  disabled = false,
  emptyMessage = "No results found",
  className = "",
  ariaLabel,
}) {
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()

  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedOption = useMemo(() => {
    return options.find((option) => option.id === value) || null
  }, [options, value])

  const fuse = useMemo(() => {
    return new Fuse(options, {
      keys: ["label", "searchText"],
      threshold: 0.3, // 0.0 is exact match, 1.0 is match anything. 0.3 handles typos well.
      ignoreLocation: true,
    })
  }, [options])

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      return options
    }

    return fuse.search(normalizedQuery).map(result => result.item)
  }, [options, query, fuse])

  function getActiveIndexForQuery(nextQuery, selectedValue = value) {
    const normalizedQuery = nextQuery.trim()

    const nextFilteredOptions = normalizedQuery
      ? fuse.search(normalizedQuery).map(result => result.item)
      : options

    if (nextFilteredOptions.length === 0) {
      return -1
    }

    const selectedIndex = nextFilteredOptions.findIndex((option) => option.id === selectedValue)
    return selectedIndex >= 0 ? selectedIndex : 0
  }

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current || rootRef.current.contains(event.target)) {
        return
      }

      setOpen(false)
      setActiveIndex(-1)
      if (selectedOption) {
        setQuery(selectedOption.label)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [selectedOption])

  function commitSelection(option) {
    setQuery(option.label)
    setOpen(false)
    setActiveIndex(-1)
    onChange?.(option.id, option)
  }

  function clearSelection() {
    setQuery("")
    setOpen(true)
    setActiveIndex(getActiveIndexForQuery("", ""))
    onChange?.("", null)
    inputRef.current?.focus()
  }

  function handleKeyDown(event) {
    if (disabled) {
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()

      if (!open) {
        setActiveIndex(getActiveIndexForQuery(query))
        setOpen(true)
        return
      }

      setActiveIndex((previousIndex) => {
        if (filteredOptions.length === 0) {
          return -1
        }
        if (previousIndex < 0) {
          return 0
        }
        return Math.min(previousIndex + 1, filteredOptions.length - 1)
      })
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()

      if (!open) {
        setActiveIndex(getActiveIndexForQuery(query))
        setOpen(true)
        return
      }

      setActiveIndex((previousIndex) => {
        if (filteredOptions.length === 0) {
          return -1
        }
        if (previousIndex < 0) {
          return filteredOptions.length - 1
        }
        return Math.max(previousIndex - 1, 0)
      })
      return
    }

    if (event.key === "Enter") {
      if (!open) {
        setOpen(true)
        return
      }

      event.preventDefault()
      const targetOption =
        (activeIndex >= 0 && filteredOptions[activeIndex]) || filteredOptions[0] || null
      if (targetOption) {
        commitSelection(targetOption)
      }
      return
    }

    if (event.key === "Escape") {
      if (!open) {
        return
      }

      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
      setQuery(selectedOption?.label || "")
    }
  }

  const rootClassName = className
    ? `destination-search ${className}`
    : "destination-search"

  const resolvedActiveIndex =
    open && filteredOptions.length > 0
      ? Math.min(Math.max(activeIndex, 0), filteredOptions.length - 1)
      : -1

  const activeDescendant =
    open && resolvedActiveIndex >= 0 && filteredOptions[resolvedActiveIndex]
      ? `${listId}-${filteredOptions[resolvedActiveIndex].id}`
      : undefined

  return (
    <div className={rootClassName} ref={rootRef}>
      {label ? <p className="destination-search-label">{label}</p> : null}

      <div className="destination-search-shell">
        <span className="destination-search-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="M8.5 3.5a5 5 0 1 1 0 10a5 5 0 0 1 0-10Z" />
            <path d="m12.25 12.25 4.25 4.25" />
          </svg>
        </span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          className="destination-search-input"
          aria-label={ariaLabel || label || placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          onFocus={() => {
            const nextQuery = selectedOption?.label || ""
            setQuery(nextQuery)
            setActiveIndex(getActiveIndexForQuery(nextQuery))
            setOpen(true)
          }}
          onChange={(event) => {
            const nextQuery = event.target.value
            setQuery(nextQuery)
            setActiveIndex(getActiveIndexForQuery(nextQuery))
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />

        {(query || value) && !disabled ? (
          <button
            type="button"
            className="destination-search-clear"
            onClick={clearSelection}
            aria-label="Clear selected destination"
          >
            x
          </button>
        ) : null}

        <div
          id={listId}
          className={`destination-search-dropdown${open ? " open" : ""}`}
          role="listbox"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const normalizedIsActive = index === resolvedActiveIndex
              const optionIsSelected = option.id === value
              const optionClassName = [
                "destination-search-option",
                normalizedIsActive ? "is-active" : "",
                optionIsSelected ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")

              return (
                <button
                  id={`${listId}-${option.id}`}
                  type="button"
                  key={option.id}
                  role="option"
                  aria-selected={optionIsSelected}
                  className={optionClassName}
                  onMouseEnter={() => {
                    setActiveIndex(index)
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    commitSelection(option)
                  }}
                >
                  {option.label}
                </button>
              )
            })
          ) : (
            <p className="destination-search-empty">{emptyMessage}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default DestinationSearch
