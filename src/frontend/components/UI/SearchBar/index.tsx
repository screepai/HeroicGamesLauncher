import {
  cloneElement,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import './index.scss'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  suggestionsListItems?: ReactElement<HTMLAttributes<HTMLElement>>[]
  onInputChanged: (text: string) => void
  value: string
  placeholder: string
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'ref'
  >
  suggestionsListProps?: HTMLAttributes<HTMLUListElement>
}

interface Selection {
  value: string
  index: number
}

export default function SearchBar({
  suggestionsListItems,
  onInputChanged,
  value,
  placeholder,
  inputProps,
  suggestionsListProps
}: Props) {
  const { t } = useTranslation()
  const autocompleteId = useId()
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        input.current?.focus()
      } else if (
        e.key === 'Escape' &&
        document.activeElement === input.current
      ) {
        input.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const onClear = useCallback(() => {
    onInputChanged('')
    setSelection({ value: '', index: -1 })
    input.current?.focus()
  }, [onInputChanged])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (inputProps?.onKeyDown) {
      inputProps.onKeyDown(event)
      return
    }
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
      <Search
        className="searchButton"
        size={22}
        strokeWidth={1.75}
        aria-hidden
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
        {...inputProps}
        value={value}
        aria-label={inputProps?.['aria-label'] ?? placeholder}
        aria-autocomplete={
          inputProps?.['aria-autocomplete'] ??
          (hasSuggestions ? 'list' : undefined)
        }
        aria-controls={
          inputProps?.['aria-controls'] ??
          (hasSuggestions ? autocompleteId : undefined)
        }
        aria-activedescendant={
          inputProps?.['aria-activedescendant'] ??
          (selectedSuggestion >= 0
            ? `${autocompleteId}-option-${selectedSuggestion}`
            : undefined)
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
            id={autocompleteId}
            className="autoComplete"
            role={hasSuggestions ? 'listbox' : undefined}
            {...suggestionsListProps}
          >
            {suggestionsListItems &&
              suggestionsListItems.length > 0 &&
              suggestionsListItems.map((li, index) => {
                const { className = '', onMouseEnter } = li.props
                if (inputProps?.onKeyDown) return li
                return cloneElement(li, {
                  id: `${autocompleteId}-option-${index}`,
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
            aria-label={t('generic.clear', 'Clear')}
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}
