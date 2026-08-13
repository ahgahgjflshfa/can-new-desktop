import { invoke } from '@tauri-apps/api/core'
import type { ChargeHttpError, ChargeTask } from '@/types/charge'

function credentials(token: string, station: string) {
  if (!token.trim()) throw new Error('缺少無線充故障登入驗證資訊，請重新登入')
  return { token: token.trim(), station: station.trim() }
}

export function isChargeForbidden(error: unknown): error is ChargeHttpError {
  return typeof error === 'object' && error !== null && (error as ChargeHttpError).status === 403
}

export async function fetchChargeTasks(token: string, station: string): Promise<ChargeTask[]> {
  const args = credentials(token, station)
  const tasks = await invoke<ChargeTask[]>('charge_fetch_tasks', args)
  return args.station
    ? tasks.filter(task => typeof task.station === 'string' && task.station.trim() === args.station)
    : tasks
}

export async function updateChargeTask(token: string, station: string, serialNumber: number, isDone: boolean): Promise<void> {
  const args = credentials(token, station)
  await invoke('charge_complete_task', { ...args, serialNumber, isDone })
}
