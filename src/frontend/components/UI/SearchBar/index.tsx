import {
  cloneElement,
  HTMLAttributes,
  KeyboardEvent,
  ReactElement,
  useCallback,
  useRef,
  useState
} from 'react'
import './index.scss'
import { faSearch, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

interface Props {
  suggestionsListItems?: ReactElement<HTMLAttributes<HTMLElement>>[]
  onInputChanged: (text: string) => void
  value: string
  placeholder: string
}

interface Selection {
  value: string
  index: number
}

export default function SearchBar({
  suggestionsListItems,
  onInputChanged,
  value,
  placeholder
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const suggestionsList = useRef<HTMLUListElement>(null)
  const [selection, setSelection] = useState<Selection>({ value, index: -1 })
  const suggestionCount = suggestionsListItems?.length ?? 0
  const hasSuggestions = value.length > 0 && suggestionCount > 0
  const selectedSuggestion =
    selection.value === value && selection.index < suggestionCount
      ? selection.index
      : -1

  const selectSuggestion = (index: number) => {
    setSelection({ value, index })
    const suggestion = suggestionsList.current?.children[index] as
      | HTMLElement
      | undefined
    suggestion?.scrollIntoView?.({ block: 'nearest' })
  }

  const onClear = useCallback(() => {
    onInputChanged('')
    setSelection({ value: '', index: -1 })
    input.current?.focus()
  }, [onInputChanged])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!hasSuggestions) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const nextSuggestion =
        event.key === 'ArrowDown'
          ? (selectedSuggestion + 1) % suggestionCount
          : selectedSuggestion <= 0
            ? suggestionCount - 1
            : selectedSuggestion - 1
      selectSuggestion(nextSuggestion)
      return
    }

    if (event.key === 'Enter' && selectedSuggestion >= 0) {
      event.preventDefault()
      const suggestion = suggestionsList.current?.children[
        selectedSuggestion
      ] as HTMLElement | undefined
      const interactiveElement = suggestion?.querySelector<HTMLElement>(
        'button, a, [role="button"]'
      )
      ;(interactiveElement ?? suggestion)?.click()
    } else if (event.key === 'Escape') {
      setSelection({ value, index: -1 })
    }
  }

  return (
    <div className="SearchBar" data-testid="searchBar">
      <FontAwesomeIcon
        className="searchButton"
        style={{ padding: 'var(--space-2xs) var(--space-sm)' }}
        tabIndex={-1}
        icon={faSearch}
      />
      <input
        ref={input}
        data-testid="searchInput"
        placeholder={placeholder}
        // this id is used for the virtualkeyboard, don't change it,
        // if this must be changed, reflect the change in src/helpers/virtualKeyboard.ts#searchInput
        // and in src/helpers/gamepad.ts#isSearchInput
        id="search"
        className="searchBarInput"
        value={value}
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-controls="search-autocomplete"
        aria-activedescendant={
          selectedSuggestion >= 0
            ? `search-autocomplete-option-${selectedSuggestion}`
            : undefined
        }
        onChange={(event) => {
          const nextValue = event.currentTarget.value
          setSelection({ value: nextValue, index: -1 })
          onInputChanged(nextValue)
        }}
        onKeyDown={onKeyDown}
      />
      {value.length > 0 && (
        <>
          <ul
            ref={suggestionsList}
            id="search-autocomplete"
            className="autoComplete"
          >
            {suggestionsListItems &&
              suggestionsListItems.length > 0 &&
              suggestionsListItems.map((li, index) => {
                const { className = '', onMouseEnter } = li.props
                return cloneElement(li, {
                  id: `search-autocomplete-option-${index}`,
                  role: 'option',
                  'aria-selected': selectedSuggestion === index,
                  className: `${className}${
                    selectedSuggestion === index ? ' selected' : ''
                  }`.trim(),
                  onMouseEnter: (event) => {
                    onMouseEnter?.(event)
                    selectSuggestion(index)
                  }
                })
              })}
          </ul>

          <button
            type="button"
            className="clearSearchButton"
            onClick={onClear}
            tabIndex={-1}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </>
      )}
    </div>
  )
}
