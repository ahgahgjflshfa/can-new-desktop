import { invoke } from '@tauri-apps/api/core'
import { formatAppLogs, getAppLogs, logAppEvent } from '@/services/appLogger'

export async function exportAppLogs(): Promise<string> {
  const payload = formatAppLogs(getAppLogs())
  logAppEvent('info', 'settings', 'requesting application log export', {
    entryCount: getAppLogs().length,
  })

  const path = await invoke<string>('export_app_logs', {
    contents: payload.length > 0 ? payload : `${new Date().toISOString()} [INFO] system: no log entries recorded`,
  })

  logAppEvent('info', 'settings', 'exported application logs', { path })
  return path
}
