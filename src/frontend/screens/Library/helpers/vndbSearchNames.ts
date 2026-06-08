import type { GameInfo } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'

export function getGameVndbMatchKey(
  game: Pick<GameInfo, 'runner' | 'app_name'>
) {
  return `${game.runner}:${game.app_name}`
}

function getUniqueSearchNames(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ]
}

export function getVndbSearchNames(match: VndbGameMatch | undefined) {
  if (!match) {
    return []
  }

  return getUniqueSearchNames([
    match.title,
    match.vndbTitle,
    match.mainVndbTitle,
    match.mainRelation?.title,
    ...(match.aliases ?? []),
    ...(match.relations?.map((relation) => relation.title) ?? []),
    match.latestRelease?.title,
    ...(match.latestRelease?.languageTitles?.flatMap((title) => [
      title.title,
      title.latin
    ]) ?? []),
    ...(match.latestRelease?.vns.flatMap((vn) => [
      vn.title,
      ...(vn.aliases ?? []),
      ...vn.relations.map((relation) => relation.title)
    ]) ?? []),
    ...(match.releases?.flatMap((release) => [
      release.title,
      ...(release.languageTitles?.flatMap((title) => [
        title.title,
        title.latin
      ]) ?? []),
      ...release.vns.flatMap((vn) => [
        vn.title,
        ...(vn.aliases ?? []),
        ...vn.relations.map((relation) => relation.title)
      ])
    ]) ?? []),
    ...(match.releaseVns?.flatMap((vn) => [
      vn.title,
      ...(vn.aliases ?? []),
      ...vn.relations.map((relation) => relation.title)
    ]) ?? [])
  ])
}
