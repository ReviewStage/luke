import {
  LID_STATE,
  type LidState,
  MICROPHONE_TRANSPORT,
  type MicrophoneRoute,
  type MicrophoneTransport,
} from "@repo/settings/microphone";
import { lineWatcher } from "./line-watcher";

const MICROPHONE_ROUTE_PROBE = "probe";

interface MicrophoneRouteEdges {
  onRoute(route: MicrophoneRoute): void;
  onUnavailable(): void;
}

export interface MicrophoneRouteWatch {
  start(): boolean;
  probe(): void;
  stop(): void;
}

export function microphoneRouteWatcher(options: MicrophoneRouteEdges): MicrophoneRouteWatch {
  const watch = lineWatcher<MicrophoneRoute>({
    binary: "mac-microphone-route",
    input: "pipe",
    parse: parseMicrophoneRouteLine,
    onState: options.onRoute,
    onUnavailable: options.onUnavailable,
  });

  return {
    start: () => watch.start(),
    probe: () => {
      watch.send(MICROPHONE_ROUTE_PROBE);
    },
    stop: () => watch.stop(),
  };
}

const TRANSPORT_WORDS: readonly MicrophoneTransport[] = Object.values(MICROPHONE_TRANSPORT);
const LID_WORDS: readonly LidState[] = Object.values(LID_STATE);

function parseMicrophoneRouteLine(line: string): MicrophoneRoute | undefined {
  const match = /^input transport=(\S+) lid=(\S+)(?: builtin=(.+))?$/.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  const transport = TRANSPORT_WORDS.find((word) => word === match[1]);
  const lid = LID_WORDS.find((word) => word === match[2]);
  if (!transport || !lid) return undefined;
  const builtInName = match[3]?.trim();
  return { defaultTransport: transport, lid, ...(builtInName ? { builtInName } : undefined) };
}
