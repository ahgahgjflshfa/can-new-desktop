import { invoke } from '@tauri-apps/api/core'
import type { ChargeHttpError, ChargeTask } from '@/types/charge'

function credentials(token: string, station: string) {
  const cleanStation = station.trim()
  if (!token.trim() || !cleanStation) throw new Error('缺少無線充故障登入驗證資訊，請重新登入')
  return { token: token.trim(), station: cleanStation }
}
export function isChargeForbidden(error: unknown): error is ChargeHttpError {
  return typeof error === 'object' && error !== null && (error as ChargeHttpError).status === 403
}
export async function fetchChargeTasks(token: string, station: string): Promise<ChargeTask[]> {
  const args = credentials(token, station)
  const tasks = await invoke<ChargeTask[]>('charge_fetch_tasks', args)
  return tasks.filter(task => typeof task.station === 'string' && task.station.trim() === args.station)
}
export async function completeChargeTask(token: string, station: string, serialNumber: number): Promise<void> {
  const args = credentials(token, station)
  await invoke('charge_complete_task', { ...args, serialNumber })
}
