const mockClient = {
  clearToken: jest.fn(),
  setToken: jest.fn()
}
const mockSetSetting = jest.fn()
const mockEncryptSecret = jest.fn()
const mockDecryptSecret = jest.fn()
const mockIsEncryptedSecretValue = jest.fn()
let storedToken = ''

jest.mock('vndb-kana-api', () => ({
  VndbClient: jest.fn(() => mockClient)
}))
jest.mock('../../config')
jest.mock('../../utils/secureSecret', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: mockEncryptSecret,
  isEncryptedSecretValue: mockIsEncryptedSecretValue
}))
jest.mock('electron')

import {
  getDecryptedApiToken,
  refreshVndbClientApiToken,
  setStoredApiToken
} from '../client'
import { GlobalConfig } from '../../config'

describe('VNDB API token storage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    storedToken = ''
    jest.spyOn(GlobalConfig, 'get').mockReturnValue({
      getSettings: jest.fn(() => ({ vndbApiToken: storedToken })),
      setSetting: mockSetSetting
    } as unknown as ReturnType<typeof GlobalConfig.get>)
    mockEncryptSecret.mockImplementation(
      (value: string) => `encrypted:${value}`
    )
    mockDecryptSecret.mockReturnValue('decrypted-token')
    mockIsEncryptedSecretValue.mockImplementation((value: string) =>
      value.startsWith('encrypted:')
    )
  })

  it('trims and encrypts tokens before storing them', () => {
    setStoredApiToken('  raw-token  ')

    expect(mockEncryptSecret).toHaveBeenCalledWith('raw-token', 'vndb')
    expect(mockSetSetting).toHaveBeenCalledWith(
      'vndbApiToken',
      'encrypted:raw-token'
    )
    expect(mockClient.setToken).toHaveBeenCalledWith('raw-token')
  })

  it('clears stored and active tokens when given an empty value', () => {
    setStoredApiToken('   ')

    expect(mockSetSetting).toHaveBeenCalledWith('vndbApiToken', '')
    expect(mockClient.clearToken).toHaveBeenCalled()
    expect(mockClient.setToken).not.toHaveBeenCalled()
  })

  it('migrates a legacy plaintext token on first read', () => {
    storedToken = 'legacy-token'

    expect(getDecryptedApiToken()).toBe('legacy-token')
    expect(mockSetSetting).toHaveBeenCalledWith(
      'vndbApiToken',
      'encrypted:legacy-token'
    )
  })

  it('decrypts encrypted tokens and refreshes the client', () => {
    storedToken = 'encrypted:stored-token'

    refreshVndbClientApiToken()

    expect(mockDecryptSecret).toHaveBeenCalledWith(
      'encrypted:stored-token',
      'vndb'
    )
    expect(mockClient.setToken).toHaveBeenCalledWith('decrypted-token')
  })
})
