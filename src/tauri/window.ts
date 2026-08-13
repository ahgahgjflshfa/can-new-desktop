import { getCurrentWindow } from '@tauri-apps/api/window'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

export async function minimizeCurrentWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await getCurrentWindow().minimize()
}

export async function hideCurrentWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await getCurrentWindow().hide()
}

export async function installMinimizeOnClose(shouldMinimize: () => boolean): Promise<() => void> {
  if (!isTauriRuntime()) return () => {}

  const win = getCurrentWindow()
  const unlisten = await win.onCloseRequested(async event => {
    if (!shouldMinimize()) return
    event.preventDefault()
    await win.hide()
  })

  return unlisten
}
