import { describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { chargeLoginWithPassword, CHARGE_LOGIN_ERROR } from '@/services/chargeAuthService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('chargeAuthService', () => {
  test('accepts and normalizes a valid charge session', async () => {
    vi.mocked(invoke).mockResolvedValue({
      token: ' token ',
      user: { account: 'a', name: 'A', station: ' S1 ', system: 'charge' },
    })
    await expect(chargeLoginWithPassword('a', 'p')).resolves.toMatchObject({ token: 'token', user: { station: 'S1' } })
    expect(invoke).toHaveBeenCalledWith('charge_login', { payload: { account: 'a', password: 'p' } })
  })

  test('rejects non-charge or incomplete responses', async () => {
    vi.mocked(invoke).mockResolvedValue({ token: 'token', user: { station: 'S1', system: 'can' } })
    await expect(chargeLoginWithPassword('a', 'p')).rejects.toThrow(CHARGE_LOGIN_ERROR)
  })
})
