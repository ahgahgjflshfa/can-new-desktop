import { invoke } from '@tauri-apps/api/core'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { logAppEvent } from '@/services/appLogger'
import { isTauriRuntime } from '@/tauri/window'

const LOG_SOURCE = 'camera-viewer'

function normalizeViewerUrl(url: string): string {
  return url.trim()
}

export async function openCameraViewer(url: string): Promise<void> {
  const normalizedUrl = normalizeViewerUrl(url)
  if (!normalizedUrl) {
    throw new Error('缺少攝影機觀看頁面網址')
  }

  if (!isTauriRuntime()) {
    logAppEvent('warn', LOG_SOURCE, 'tauri runtime unavailable, opening viewer in external browser', {
      url: normalizedUrl,
    })
    await openExternalViewer(normalizedUrl)
    return
  }

  try {
    logAppEvent('info', LOG_SOURCE, 'requesting camera viewer window open', { url: normalizedUrl })
    await invoke('open_camera_viewer', { url: normalizedUrl })
  } catch (err) {
    logAppEvent('warn', LOG_SOURCE, 'camera viewer window open failed, falling back to external browser', err)
    await openExternalViewer(normalizedUrl)
  }
}

async function openExternalViewer(url: string): Promise<void> {
  try {
    await openExternal(url)
  } catch (err) {
    logAppEvent('error', LOG_SOURCE, 'failed to open camera viewer in external browser', err)
    throw new Error('無法開啟攝影機觀看頁面')
  }
}
