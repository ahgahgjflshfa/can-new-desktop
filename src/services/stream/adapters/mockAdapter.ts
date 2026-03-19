import type { AdapterEvent, StreamAdapter, StreamAdapterConfig } from "./types";

export class MockAdapter implements StreamAdapter {
  start(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  stop(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  connect(config: StreamAdapterConfig): Promise<void> {
    throw new Error("Method not implemented.");
  }
  disconnect(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  attach(videoEl: HTMLVideoElement): void {
    throw new Error("Method not implemented.");
  }
  detach(): void {
    throw new Error("Method not implemented.");
  }
  onEvent(handler: (event: AdapterEvent) => void): () => void {
    throw new Error("Method not implemented.");
  }
}
