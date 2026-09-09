import { LINE_UNAVAILABLE, type LineWatcher, lineWatcher, type ParsedLine } from "./line-watcher";
import type { NativeHelperProcess } from "./native-helper";

/**
 * What the helper says about itself on its first line, and what it streams
 * afterwards. Parsed rather than assumed: a helper that failed to register is
 * the difference between hold-to-talk and no talk key at all, and the app has a
 * fallback to reach for if it says so.
 */
export const TALK_KEY_EVENT = {
  REGISTERED: "registered",
  DOWN: "down",
  UP: "up",
  UNAVAILABLE: "unavailable",
} as const;

/** One thing the helper reported about the chord it was given. */
export type TalkKeyEdge =
  | { kind: "down" }
  | { kind: "up" }
  | { kind: "registered"; accelerator: string };

export interface TalkKeyEdges {
  onPress(): void;
  onRelease(): void;
  /** The accelerator that registered, once the helper reports one. */
  onRegistered(accelerator: string): void;
  /**
   * The talk key cannot be watched — either it never registered or the helper
   * has since stopped. Called at most once, and never for a stop the app asked
   * for.
   */
  onUnavailable(): void;
}

export interface TalkKeyWatcherOptions extends TalkKeyEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: (candidates: readonly string[]) => NativeHelperProcess;
}

export interface TalkKeyWatch {
  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * here is not yet a registered key — that arrives on the helper's first line,
   * through `onRegistered`.
   */
  start(candidates: readonly string[]): boolean;
  /**
   * Stops the helper, reporting when its process is actually gone. The answer
   * matters to a successor — the system releases the chord with the process,
   * not with the kill that asked for it, so a new helper that claims a chord
   * this one still holds would be refused.
   */
  stop(): Promise<void>;
}

/**
 * Longer than a SIGTERM takes to land, far shorter than a user notices. The
 * wait for a stopped helper's exit is capped so a process that ignores the
 * signal cannot wedge every later change of the talk key.
 */
const EXIT_WAIT_MS = 1000;

export function parseTalkKeyLine(line: string): ParsedLine<TalkKeyEdge> {
  if (line === TALK_KEY_EVENT.DOWN) return { kind: "down" };
  if (line === TALK_KEY_EVENT.UP) return { kind: "up" };
  if (line.startsWith(`${TALK_KEY_EVENT.REGISTERED} `)) {
    return { kind: "registered", accelerator: line.slice(TALK_KEY_EVENT.REGISTERED.length + 1) };
  }
  if (line.startsWith(TALK_KEY_EVENT.UNAVAILABLE)) return LINE_UNAVAILABLE;
  return undefined;
}

/**
 * Watches the talk key being held down and let go of, from whatever app is
 * frontmost.
 *
 * Electron registers a global accelerator through the same system API this
 * helper uses, but reports only the press — so a key that means "while I am
 * holding this" cannot be built on it. The helper exists for the release, and
 * for nothing else: it is told one chord and can see no other key, which is
 * what keeps hold-to-talk from costing the user an Accessibility grant.
 */
export function talkKeyWatcher(options: TalkKeyWatcherOptions): TalkKeyWatch {
  let watch: LineWatcher | undefined;

  return {
    start(candidates: readonly string[]): boolean {
      const { spawnHelper } = options;
      watch = lineWatcher<TalkKeyEdge>({
        binary: "mac-talk-key",
        arguments: candidates,
        parse: parseTalkKeyLine,
        onState: (edge) => {
          if (edge.kind === "down") options.onPress();
          else if (edge.kind === "up") options.onRelease();
          else options.onRegistered(edge.accelerator);
        },
        onUnavailable: options.onUnavailable,
        unavailableLineEnds: true,
        exitWaitMs: EXIT_WAIT_MS,
        ...(spawnHelper ? { spawnProcess: () => spawnHelper(candidates) } : undefined),
      });
      return watch.start();
    },
    stop(): Promise<void> {
      return watch?.stop() ?? Promise.resolve();
    },
  };
}
