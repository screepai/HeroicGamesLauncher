import { japaneseLocaleEnv } from 'common/japaneseLocale'

describe('japaneseLocaleEnv', () => {
  it('provides the Linux locale, Wine-GE host locale, and Japanese timezone', () => {
    expect(japaneseLocaleEnv).toEqual({
      LANG: 'ja_JP.UTF-8',
      LC_ALL: 'ja_JP.UTF-8',
      HOST_LC_ALL: 'ja_JP.UTF-8',
      TZ: 'Asia/Tokyo'
    })
  })
})
