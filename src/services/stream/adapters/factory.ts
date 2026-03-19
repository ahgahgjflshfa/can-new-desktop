import type { StreamSourceType } from "@/types/stream";
import type { StreamAdapter } from "./types";
import { MockAdapter } from "./mockAdapter";
import { WebRTCAdapter } from "./webrtcAdapter";
import { HLSAdapter } from "./hlsAdapter";

export function AdapterFactory(sourceType: StreamSourceType): StreamAdapter {
  switch (sourceType) {
    case "mock":
      return new MockAdapter();
    case "webrtc":
      return new WebRTCAdapter();
    case "hls":
      return new HLSAdapter();
    default:
      throw new Error('unsupported adapter');
  }
}
