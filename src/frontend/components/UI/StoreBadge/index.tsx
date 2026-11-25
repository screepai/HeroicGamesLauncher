import classNames from 'classnames'
import { Runner } from 'common/types'
import vndbFavicon from 'frontend/assets/vndb-favicon.ico'
import StoreLogos from '../StoreLogos'
import './index.css'

interface StoreBadgeProps {
  runner: Runner
  title?: string
  className?: string
  /** Show the VNDB mark instead of the store logo (game is linked to VNDB). */
  vndb?: boolean
}

export default function StoreBadge({
  runner,
  title,
  className,
  vndb = false
}: StoreBadgeProps) {
  return (
    <span
      className={classNames(
        'StoreBadge',
        { 'StoreBadge--vndb': vndb },
        className
      )}
      title={title}
    >
      {vndb ? (
        <img src={vndbFavicon} alt="VNDB" className="StoreBadge__favicon" />
      ) : (
        <StoreLogos runner={runner} className="StoreBadge__logo" />
      )}
    </span>
  )
}
