import React, { useContext } from 'react'
import { getTopVndbTags } from 'frontend/helpers/vndb'
import GameContext from '../../GameContext'
import { Badge } from 'frontend/components/UI'

type GenresProps = {
  genres: string[]
}

const Genres: React.FC<GenresProps> = ({ genres }) => {
  const { vndbMatch } = useContext(GameContext)
  const displayGenres =
    genres[0] === '' || genres.length === 0
      ? getTopVndbTags(vndbMatch?.tags, {
          category: 'cont',
          limit: 6
        }).map((tag) => tag.name)
      : genres

  if (!displayGenres.length) {
    return null
  }

  return (
    <span className="genres">
      {displayGenres.map((genre) => (
        <Badge key={genre} variant="accent" className="genre">
          {genre}
        </Badge>
      ))}
    </span>
  )
}

export default Genres
