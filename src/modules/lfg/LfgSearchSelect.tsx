import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

export type LfgSearchOption = {
  id: string
  label: string
  /** Secondary line in the dropdown. */
  detail?: string
  /** Value written into the controlled input on select. */
  value: string
  /** Extra payload for parent handlers. */
  meta?: Record<string, unknown>
}

type Props = {
  label: string
  value: string
  options: LfgSearchOption[]
  placeholder?: string
  emptyHint?: string
  disabled?: boolean
  onChange: (value: string) => void
  onSelect?: (option: LfgSearchOption) => void
}

export function LfgSearchSelect({
  label,
  value,
  options,
  placeholder,
  emptyHint = 'No matches',
  disabled,
  onChange,
  onSelect,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState(value)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = !q
      ? options
      : options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q) ||
            (o.detail || '').toLowerCase().includes(q),
        )
    return list.slice(0, 40)
  }, [options, query])

  const customValue = query.trim()
  const showUseCustom =
    customValue.length >= 2 &&
    !filtered.some(
      (o) =>
        o.value.toLowerCase() === customValue.toLowerCase() ||
        o.label.toLowerCase() === customValue.toLowerCase(),
    )

  useEffect(() => {
    setActive(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (option: LfgSearchOption) => {
    onChange(option.value)
    setQuery(option.value)
    onSelect?.(option)
    setOpen(false)
  }

  const pickCustom = () => {
    onChange(customValue)
    setQuery(customValue)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const customOffset = showUseCustom ? 1 : 0
    const total = filtered.length + customOffset
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(total - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (showUseCustom && active === 0) {
        pickCustom()
        return
      }
      const idx = showUseCustom ? active - 1 : active
      if (filtered[idx]) pick(filtered[idx])
      else if (customValue.length >= 2) pickCustom()
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <label className="field lfg-search-select" ref={rootRef}>
      <span>{label}</span>
      <div className="lfg-search-select__wrap">
        <input
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        {open ? (
          <ul id={listId} className="lfg-search-select__list" role="listbox">
            {showUseCustom ? (
              <li role="option" aria-selected={active === 0}>
                <button
                  type="button"
                  className={`lfg-search-select__option lfg-search-select__option--custom ${
                    active === 0 ? 'is-active' : ''
                  }`}
                  onMouseEnter={() => setActive(0)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={pickCustom}
                >
                  <span className="lfg-search-select__label">Use “{customValue}”</span>
                  <span className="lfg-search-select__detail">Custom mission / node</span>
                </button>
              </li>
            ) : null}
            {filtered.length === 0 && !showUseCustom ? (
              <li className="lfg-search-select__empty">{emptyHint}</li>
            ) : (
              filtered.map((o, i) => {
                const rowActive = showUseCustom ? i + 1 : i
                return (
                  <li key={o.id} role="option" aria-selected={rowActive === active}>
                    <button
                      type="button"
                      className={`lfg-search-select__option ${
                        rowActive === active ? 'is-active' : ''
                      }`}
                      onMouseEnter={() => setActive(rowActive)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      <span className="lfg-search-select__label">{o.label}</span>
                      {o.detail ? (
                        <span className="lfg-search-select__detail">{o.detail}</span>
                      ) : null}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        ) : null}
      </div>
    </label>
  )
}
