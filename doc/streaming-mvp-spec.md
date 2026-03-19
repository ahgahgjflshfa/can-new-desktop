# Streaming MVP Spec

## 0. 文件目的（Purpose）

這份文件用來對齊 MVP 範圍、工程切分與驗收標準，避免「先寫一堆程式，後面才發現需求不一致」。

## 1. 目標（Goal）

在沒有真實監視器伺服器的情況下，完成可演示、可測試、可替換資料來源的播放器 MVP：

- 可播放 mock 影片
- 可模擬斷線與重連
- 可顯示清楚狀態（connecting/live/reconnecting/error）
- 未來可替換成 WebRTC/HLS，不重寫 UI 或 store

## 2. 非目標（Non-Goals）

本階段不做：

- 真實 RTSP/WebRTC 伺服器串接
- 正式鑑權（JWT）與 TLS
- 錄影回放系統
- 大規模效能優化與多路監控牆

## 3. 使用情境（User Scenarios）

1. 使用者開啟畫面後，先看到 connecting，2 秒內進入 live。
2. 播放中發生斷線時，自動重連（最多 3 次）。
3. 超過重連次數時，顯示 error 並提供手動重試。
4. 使用者按下重試後，狀態能回到 connecting 並重新建立連線。

## 4. MVP 功能範圍（In Scope）

- Stream 狀態管理（Pinia）
- PlayerCore 介面（統一對外 API）
- StreamAdapter 介面（mock/webrtc/hls 共用契約）
- MockStreamAdapter（本地 mp4 + 故障注入）
- 基本控制：play/pause/mute
- 錯誤提示與重連按鈕

## 5. 狀態機（State Machine）

### 5.1 狀態集合

`idle | connecting | live | buffering | reconnecting | error | stopped`

### 5.2 允許的狀態轉移

- idle -> connecting
- connecting -> live
- connecting -> error
- live -> buffering
- buffering -> live
- live -> reconnecting
- reconnecting -> live
- reconnecting -> error
- error -> connecting（手動重試）
- live -> stopped

### 5.3 禁止情境

- 不允許從 idle 直接跳到 live（必須經過 connecting）
- 不允許在 stopped 狀態仍持續發送 stats 事件

## 6. 型別與錯誤碼（Contracts）

### 6.1 StreamSourceType

`mock | webrtc | hls`

### 6.2 StreamErrorCode

`network_timeout | source_unavailable | auth_failed | unsupported_format | unknown`

### 6.3 StreamError 最小欄位

- `code: StreamErrorCode`
- `message: string`
- `retryable: boolean`
- `timestamp: number`

### 6.4 StreamStats 最小欄位

- `startupTimeMs: number`
- `reconnectCount: number`
- `bufferCount: number`

## 7. 重連策略（Reconnect Policy）

- 最大重試次數：3 次
- 退避時間：1s -> 2s -> 4s（指數退避）
- `network_timeout` / `source_unavailable`：可重試
- `auth_failed` / `unsupported_format`：不可重試，直接進入 error

## 8. Phase 1 交付範圍（Contracts First）

### 8.1 必做檔案

- `src/types/stream.ts`
- `src/services/stream/playerCore.ts`
- `src/services/stream/adapters/types.ts`

### 8.2 Phase 1 必做內容

- 完成 StreamStatus / StreamSourceType / StreamErrorCode 型別
- 完成 PlayerCore 介面（load/play/pause/stop/reconnect/dispose）
- 完成 StreamAdapter 介面（connect/disconnect/attach/detach）
- 完成事件命名（status/error/stats）
- 先不接真實串流，僅定義 contract

### 8.3 Phase 1 完成定義（Definition of Done）

- UI 和 store 不直接依賴底層 `<video>` 或第三方 SDK
- 所有新增 contract 皆通過 `pnpm type-check`
- 至少有 1 個假實作（stub）可正確實作 interface

## 9. 驗收標準（Acceptance Criteria）

- 啟動後可進入 live 狀態並顯示畫面（mock）
- 可模擬斷線並自動重連成功
- 重連失敗超過 3 次後進入 error
- 點擊「重試」可重新走 connecting -> live
- `pnpm type-check` 與 `pnpm test` 通過（至少核心流程測試）

## 10. Traceability Matrix（Spec 對齊表）

| Spec Item                      | Implementation                           | Test                                 | Status |
| ------------------------------ | ---------------------------------------- | ------------------------------------ | ------ |
| connecting -> live             | `src/stores/streamStore.ts`              | `tests/unit/streamStore.test.ts`     | TODO   |
| auto reconnect max 3           | `src/services/stream/reconnectPolicy.ts` | `tests/unit/reconnectPolicy.test.ts` | TODO   |
| show error + retry button      | `src/components/stream/StreamPlayer.vue` | `tests/unit/streamPlayer.spec.ts`    | TODO   |
| source abstraction via adapter | `src/services/stream/adapters/types.ts`  | `tests/unit/adapterContract.test.ts` | TODO   |

## 11. 風險與後續（Risks / Next）

- 風險：真實 WebRTC 行為與 mock 事件序可能不同
- 對策：Phase 2 只新增 adapter 實作，不改 PlayerCore 對外 API
- 下一步：新增 WebRTCAdapter，沿用同一介面接入真實來源
