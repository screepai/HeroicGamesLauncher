import './index.scss'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faSpinner,
  faSearch,
  faTimes,
  faArrowLeft
} from '@fortawesome/free-solid-svg-icons'
import CachedImage from 'frontend/components/UI/CachedImage'
import TextInputWithIconField from 'frontend/components/UI/TextInputWithIconField'
import { SGDBGame, SGDBGrid } from 'common/types'
import type { VndbSearchResult } from 'common/types/vndb'

type VndbImageResult = VndbSearchResult & { imageUrl: string }

interface Props {
  initialTitle: string
  onSelect: (url: string) => void
  onClose: () => void
  mode?: 'grids' | 'heroes'
  dimensions?: string[]
  styles?: string[]
  includeVndb?: boolean
  enableSteamGridDb?: boolean
}

const DEFAULT_GRID_DIMENSIONS = ['600x900', '342x482', '660x930']
const DEFAULT_GRID_STYLES = ['material', 'alternate', 'blurred']

export default function SteamGridDBPicker({
  initialTitle,
  onSelect,
  onClose,
  mode = 'grids',
  dimensions,
  styles,
  includeVndb = false,
  enableSteamGridDb = true
}: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(initialTitle)
  const [games, setGames] = useState<SGDBGame[]>([])
  const [grids, setGrids] = useState<SGDBGrid[]>([])
  const [vndbResults, setVndbResults] = useState<VndbImageResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [steamGridError, setSteamGridError] = useState<string | null>(null)
  const [vndbError, setVndbError] = useState<string | null>(null)

  const handleSelectGame = useCallback(
    async (gameId: number) => {
      setSelectedGameId(gameId)
      setLoading(true)
      setSteamGridError(null)
      setGrids([])
      try {
        const fetcher =
          mode === 'heroes'
            ? window.api.steamgriddb.getHeroes
            : window.api.steamgriddb.getGrids
        const fetchDims =
          dimensions ?? (mode === 'heroes' ? [] : DEFAULT_GRID_DIMENSIONS)
        const fetchStyles =
          styles ?? (mode === 'heroes' ? [] : DEFAULT_GRID_STYLES)
        const results = await fetcher({
          gameId,
          styles: fetchStyles,
          dimensions: fetchDims
        })
        setGrids(results)
        if (results.length === 0) {
          setSteamGridError(
            t('steamgriddb.error.no-grids', 'No covers found for this game.')
          )
        }
      } catch (err) {
        setSteamGridError(t('steamgriddb.error.grids', 'Failed to fetch grids'))
        console.error(err)
      } finally {
        setLoading(false)
      }
    },
    [t, mode, dimensions, styles]
  )

  const searchGames = useCallback(
    async (searchQuery: string) => {
      const normalizedQuery = searchQuery.trim()
      if (!normalizedQuery) return

      setLoading(true)
      setSteamGridError(null)
      setVndbError(null)
      setGrids([])
      setGames([])
      setVndbResults([])
      setSelectedGameId(null)

      try {
        const [steamGridResult, vndbResult] = await Promise.allSettled([
          enableSteamGridDb
            ? window.api.steamgriddb.searchGame(normalizedQuery)
            : Promise.resolve([]),
          includeVndb
            ? window.api.vndb.searchVisualNovels({
                query: normalizedQuery,
                limit: 20
              })
            : Promise.resolve([])
        ])

        if (vndbResult.status === 'fulfilled') {
          const imageResults = vndbResult.value.filter(
            (result): result is VndbImageResult => Boolean(result.imageUrl)
          )
          setVndbResults(imageResults)

          if (includeVndb && !enableSteamGridDb && imageResults.length === 0) {
            setVndbError(
              t('vndb.image-picker.no-results', 'No VNDB covers found.')
            )
          }
        } else {
          setVndbError(
            t('vndb.image-picker.error', 'Failed to search VNDB for covers.')
          )
          const message =
            vndbResult.reason instanceof Error
              ? vndbResult.reason.message
              : String(vndbResult.reason)
          window.api.logError(`VNDB cover search failed: ${message}`)
        }

        if (steamGridResult.status === 'fulfilled') {
          const results = steamGridResult.value
          setGames(results)

          if (results.length === 1) {
            await handleSelectGame(results[0].id)
          } else if (
            enableSteamGridDb &&
            results.length === 0 &&
            (vndbResult.status !== 'fulfilled' ||
              !vndbResult.value.some((result) => result.imageUrl))
          ) {
            setSteamGridError(
              t('steamgriddb.error.no-games', 'No games found.')
            )
          }
        } else {
          setSteamGridError(
            t(
              'steamgriddb.error.search',
              'Failed to search for games, please check your SteamGridDB API key and try again'
            )
          )
          console.error(steamGridResult.reason)
        }
      } finally {
        setLoading(false)
      }
    },
    [enableSteamGridDb, handleSelectGame, includeVndb, t]
  )

  const goBack = () => {
    setSelectedGameId(null)
    setGrids([])
    setSteamGridError(null)
  }

  useEffect(() => {
    if (initialTitle) {
      void searchGames(initialTitle)
    }
  }, [initialTitle, searchGames])

  return (
    <div className={`SteamGridDBPicker SteamGridDBPicker--${mode}`}>
      <div className="SteamGridDBPicker__header">
        <div className="SteamGridDBPicker__title-group">
          {selectedGameId && (
            <button className="button is-ghost" onClick={goBack}>
              <FontAwesomeIcon icon={faArrowLeft} />
            </button>
          )}
          <h3>
            {includeVndb
              ? t('cover-picker.title', 'Cover Search')
              : t('steamgriddb.picker.title', 'SteamGridDB Covers')}
          </h3>
        </div>
        <button className="button is-ghost" onClick={onClose}>
          <FontAwesomeIcon icon={faTimes} />
        </button>
      </div>

      {!selectedGameId && (
        <TextInputWithIconField
          htmlId="steamgriddb-search"
          label={
            includeVndb
              ? t('cover-picker.search', 'Search Covers')
              : t('steamgriddb.picker.search', 'Search Game')
          }
          value={query}
          onChange={setQuery}
          icon={<FontAwesomeIcon icon={faSearch} />}
          onIconClick={() => void searchGames(query)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void searchGames(query)
            }
          }}
        />
      )}

      {loading && (
        <div className="SteamGridDBPicker__loading">
          <FontAwesomeIcon icon={faSpinner} spin size="2x" />
        </div>
      )}

      {steamGridError && (
        <div className="SteamGridDBPicker__error">{steamGridError}</div>
      )}
      {vndbError && <div className="SteamGridDBPicker__error">{vndbError}</div>}

      {!loading && enableSteamGridDb && games.length > 1 && !selectedGameId && (
        <div className="SteamGridDBPicker__games">
          <h4>{t('steamgriddb.picker.select-game', 'Select a Game:')}</h4>
          <ul>
            {games.map((game) => (
              <li key={game.id} onClick={() => void handleSelectGame(game.id)}>
                {game.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && (grids.length > 0 || vndbResults.length > 0) && (
        <div className="SteamGridDBPicker__grids">
          {grids.map((grid) => (
            <div
              key={grid.id}
              className="SteamGridDBPicker__grid-item"
              onClick={() => onSelect(grid.url)}
            >
              <CachedImage src={grid.thumb} />
              {includeVndb && (
                <span className="SteamGridDBPicker__source">SteamGridDB</span>
              )}
            </div>
          ))}
          {vndbResults.map((result) => (
            <div
              key={`${result.source}:${result.id}`}
              className="SteamGridDBPicker__grid-item"
              title={result.title}
              onClick={() => onSelect(result.imageUrl)}
            >
              <CachedImage src={result.imageUrl} />
              <span className="SteamGridDBPicker__source">VNDB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
