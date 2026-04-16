const APP_LOG_STORAGE_KEY = 'tauri-app:logs'
const MAX_LOG_ENTRIES = 500

export type AppLogLevel = 'info' | 'warn' | 'error'

export interface AppLogEntry {
  id: string
  timestamp: string
  level: AppLogLevel
  source: string
  message: string
  details?: string
}

function createLogId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toDetailString(details: unknown): string | undefined {
  if (details === undefined || details === null) return undefined
  if (details instanceof Error) {
    return details.stack ?? details.message
  }
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        }
      }

      return value
    })
  } catch {
    return String(details)
  }
}

function loadEntries(): AppLogEntry[] {
  if (typeof localStorage === 'undefined') return []
  if (typeof localStorage.getItem !== 'function') return []

  const raw = localStorage.getItem(APP_LOG_STORAGE_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLogEntry)
  } catch (err) {
    console.warn('failed to parse stored app logs', err)
    return []
  }
}

function saveEntries(entries: AppLogEntry[]) {
  if (typeof localStorage === 'undefined') return
  if (typeof localStorage.setItem !== 'function') return

  try {
    localStorage.setItem(APP_LOG_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_LOG_ENTRIES)))
  } catch (err) {
    console.warn('failed to persist app logs', err)
  }
}

function isLogEntry(value: unknown): value is AppLogEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.timestamp === 'string' &&
    (record.level === 'info' || record.level === 'warn' || record.level === 'error') &&
    typeof record.source === 'string' &&
    typeof record.message === 'string'
  )
}

export function logAppEvent(level: AppLogLevel, source: string, message: string, details?: unknown) {
  const entry: AppLogEntry = {
    id: createLogId(),
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    details: toDetailString(details),
  }

  const entries = loadEntries()
  entries.push(entry)
  saveEntries(entries)

  const prefix = `[App][${source}] ${message}`
  if (level === 'error') {
    console.error(prefix, details ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, details ?? '')
  } else {
    console.log(prefix, details ?? '')
  }

  return entry
}

export function getAppLogs(): AppLogEntry[] {
  return loadEntries()
}

export function clearAppLogs() {
  saveEntries([])
}

export function formatAppLogs(entries = getAppLogs()): string {
  return entries
    .map(entry => {
      const base = `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`
      return entry.details ? `${base}\n  ${entry.details}` : base
    })
    .join('\n')
}
