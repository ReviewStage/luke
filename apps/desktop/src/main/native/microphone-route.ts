import {
  LID_STATE,
  type LidState,
  MICROPHONE_TRANSPORT,
  type MicrophoneRoute,
  type MicrophoneTransport,
} from "@luke/voice/audio";
import { lineWatcher } from "./line-watcher";

/** The one word the helper takes; its one line is read by the parser below. */
const MICROPHONE_ROUTE_PROBE = "probe";

interface MicrophoneRouteEdges {
  /** The route as read, on start, on every input change, and per probe. */
  onRoute(route: MicrophoneRoute): void;
  /** The route cannot be read — no helper, or the helper died. */
  onUnavailable(): void;
}

export interface MicrophoneRouteWatch {
  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable route — that arrives on the helper's first line.
   */
  start(): boolean;
  /**
   * Asks for a fresh read. The lid can close without any device changing, so
   * the app probes when a press is about to choose a device; the answer rides
   * the same line every change does.
   */
  probe(): void;
  /** Stops the helper. Nothing succeeds it during shutdown, so no one waits. */
  stop(): void;
}

/**
 * Watches where the developer's voice would be captured from: the default
 * input's transport, the built-in microphone's name, and the lid over it —
 * read by a helper that reads nothing else and can write nothing. What the
 * answer decides is bounded to one action: which device the renderer asks the
 * browser to open when a press takes a turn.
 */
export function microphoneRouteWatcher(options: MicrophoneRouteEdges): MicrophoneRouteWatch {
  const watch = lineWatcher<MicrophoneRoute>({
    binary: "mac-microphone-route",
    input: "pipe",
    parse: parseMicrophoneRouteLine,
    onState: options.onRoute,
    onUnavailable: options.onUnavailable,
    // The helper writes no refusal of its own; only its death withdraws a route.
    unavailableLineEnds: true,
  });

  // The watcher's own `send` stays off the caller-facing shape: the one word
  // ever written to this helper is the probe the build fixed.
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

/**
 * Reads one `input transport=<word> lid=<word> builtin=<name…>` line. The
 * name is the line's tail — it may contain spaces or anything else CoreAudio
 * lets a device be called — and a line that does not parse is dropped rather
 * than guessed at: the cost of missing one is the browser's default device,
 * which is exactly what no helper at all would mean.
 */
function parseMicrophoneRouteLine(line: string): MicrophoneRoute | undefined {
  const match = /^input transport=(\S+) lid=(\S+)(?: builtin=(.+))?$/.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  const transport = TRANSPORT_WORDS.find((word) => word === match[1]);
  const lid = LID_WORDS.find((word) => word === match[2]);
  if (!transport || !lid) return undefined;
  const builtInName = match[3]?.trim();
  return { defaultTransport: transport, lid, ...(builtInName ? { builtInName } : undefined) };
}
