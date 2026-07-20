import { invoke } from '@tauri-apps/api/core'
import type { ChargeLoginResponse } from '@/types/charge'

export const CHARGE_LOGIN_ERROR = '此帳號無法使用無線充故障系統'

export class ChargeLoginValidationError extends Error {
  constructor() {
    super(CHARGE_LOGIN_ERROR)
    this.name = 'ChargeLoginValidationError'
  }
}

export function isChargeLoginValidationError(error: unknown): error is ChargeLoginValidationError {
  return error instanceof ChargeLoginValidationError
}

export async function chargeLoginWithPassword(account: string, password: string): Promise<ChargeLoginResponse> {
  const response = await invoke<ChargeLoginResponse>('charge_login', { payload: { account, password } })
  const token = response?.token?.trim()
  const station = response?.user?.station?.trim()
  if (!token || !station || response?.user?.system !== 'charge') throw new ChargeLoginValidationError()
  return { ...response, token, user: { ...response.user, station } }
}
