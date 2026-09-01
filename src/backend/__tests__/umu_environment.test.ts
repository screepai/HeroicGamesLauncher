import { getUmuEnvironment } from '../utils/umu_environment'

describe('getUmuEnvironment', () => {
  it('does not change UMU network behavior while online', () => {
    expect(getUmuEnvironment(false, {})).toEqual({})
  })

  it('disables UMU runtime updates and bounds failed HTTP probes', () => {
    expect(getUmuEnvironment(true, {})).toEqual({
      UMU_RUNTIME_UPDATE: '0',
      UMU_HTTP_RETRIES: '0',
      UMU_HTTP_TIMEOUT: '1'
    })
  })

  it('preserves existing environment overrides', () => {
    expect(
      getUmuEnvironment(true, {
        UMU_RUNTIME_UPDATE: '1',
        UMU_HTTP_RETRIES: '2',
        UMU_HTTP_TIMEOUT: '10'
      })
    ).toEqual({
      UMU_RUNTIME_UPDATE: '1',
      UMU_HTTP_RETRIES: '2',
      UMU_HTTP_TIMEOUT: '10'
    })
  })
})
