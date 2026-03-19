import type { StreamConfig } from "@/types/stream";

export interface PlayerCore {
  load(config: StreamConfig): Promise<void>,
  play(): void,
  pause(): void,
  stop(): void,
  reconnect(): Promise<void>,
  dispose(): void,
}
