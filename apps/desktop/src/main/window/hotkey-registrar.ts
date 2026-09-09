import { PRODUCT_EVENT, PRODUCT_PANEL_SOURCE, type RecordProductEvent } from "@sidecar/analytics";
import {
  askHotkeyCandidates,
  stopHotkeyCandidates,
  voiceHotkeyCandidates,
} from "@sidecar/settings";
import type { UnparsedWireValue } from "@sidecar/wire";
import { type BrowserWindow, globalShortcut, type WebContents } from "electron";
import { channels } from "#shared/bridge";
import type { WindowMode } from "#shared/messages/session";
import { type TalkKeyEdges, talkKeyWatcher } from "../native/talk-key";

/**
 * The three Luke keys, in the order they outrank one another. Talk takes any
 * chord it can sit on; ask yields to talk; stop yields to both — it alone has
 * Escape standing behind it.
 */
export const HOTKEY_RANK = {
  TALK: "talk",
  ASK: "ask",
  STOP: "stop",
} as const;

export type HotkeyRank = (typeof HOTKEY_RANK)[keyof typeof HOTKEY_RANK];

/**
 * The pecking order, stated once. Every operation below reads it rather than
 * spelling out who yields to whom.
 */
const RANK_ORDER: readonly HotkeyRank[] = [HOTKEY_RANK.TALK, HOTKEY_RANK.ASK, HOTKEY_RANK.STOP];

/** Only the shortcut surface this needs, so a test can supply one. */
export interface ShortcutSurface {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

export interface TalkKeyHandle {
  start(candidates: readonly string[]): boolean;
  stop(): Promise<void> | undefined;
}

/**
 * The windows the keys talk to: the voice host answers a talk or stop press,
 * the primary panel is what the ask key summons, and every window is told
 * which chord to teach when one of them moves.
 */
export interface HotkeyHost {
  voiceHost(): BrowserWindow | undefined;
  /** The one drawn panel an ask press summons; the voice host draws nothing. */
  primaryPanel(): BrowserWindow | undefined;
  displayIdFor(sender: WebContents): number | undefined;
  /** How the panel stands now, so a key that summons into an open one knows. */
  modeFor(displayId: number): WindowMode;
  setMode(displayId: number, mode: WindowMode, requestFocus: boolean): void;
  /**
   * One key's registration moved, so what the renderers are teaching is
   * written again. The raw accelerator is what travels, as in bootstrap: the
   * renderer draws the chord as its separate keys and says it as one word,
   * and only the accelerator produces both. An absence travels too, for the
   * guide's sake: a chord that answers nothing must not be one Luke claims
   * to have. Announced per rank rather than as the three together, because
   * the talk key's own reapply leaves it unregistered while its helper
   * starts: a whole-set announcement would tell every panel the chord had
   * gone and tell it back a moment later.
   */
  hotkeyChanged(rank: HotkeyRank): void;
}

export interface HotkeyRegistrarOptions {
  host: HotkeyHost;
  /** A capture run drives the panel itself and must not grab a system key. */
  registersGlobalKeys: boolean;
  /**
   * Whether the named key currently has something to serve. Answered per rank
   * because the ranks can diverge: the introduction holds a voice for the talk
   * key alone, and claiming the ask and stop chords beside it would take two
   * system keys from every other app for nothing.
   */
  hasCredentials: (rank: HotkeyRank) => boolean;
  recordProductEvent: RecordProductEvent;
  shortcut?: ShortcutSurface;
  createTalkKeyWatcher?: (edges: TalkKeyEdges) => TalkKeyHandle;
}

/** One Luke key: the chords it may sit on, what a press does, what moves say. */
interface KeyState {
  /**
   * `taken` is the exclusion list the registrar assembles from the ranks above
   * this one. The talk key's own function takes no such argument: nothing
   * outranks talk.
   */
  readonly candidates: (
    chosen: string | undefined,
    taken: readonly (string | undefined)[],
  ) => readonly string[];
  readonly onPress: () => void;
  /**
   * The stored choice: a chord, the none token for a key deleted outright, or
   * absent while the defaults stand. The token needs no reading here — it
   * empties the rank's candidate list at the source, so registration finds
   * nothing to try and reservation nothing to defend.
   */
  chosen: string | undefined;
  accelerator: string | undefined;
}

/**
 * Owns the talk, ask, and stop keys and the pecking order between them.
 *
 * The registered chord, the stored choice, and the talk-key helper are one
 * reservation table here: `reserve` is the answer the settings
 * handlers ask instead of re-deriving who sits on a chord, and `reapply`
 * is the one operation that knows `unregisterAll` takes the lower keys down
 * and puts them back in rank order.
 */
export class HotkeyRegistrar {
  readonly #host: HotkeyHost;
  readonly #registersGlobalKeys: boolean;
  readonly #hasCredentials: (rank: HotkeyRank) => boolean;
  readonly #recordProductEvent: RecordProductEvent;
  readonly #shortcut: ShortcutSurface;
  readonly #createTalkKeyWatcher: (edges: TalkKeyEdges) => TalkKeyHandle;

  readonly #keys: Map<HotkeyRank, KeyState>;

  #talkKeyWatcher: TalkKeyHandle | undefined;
  /**
   * Whether the key reports being let go of. The helper does and the Electron
   * fallback cannot, and that is the difference between holding a turn and
   * toggling one — so the panel is told which key it actually has rather than
   * describing the one it hoped for.
   */
  #held = true;

  /**
   * True while a settings row is recording a chord. Both Luke keys stay
   * registered through a recording — the recording is how one gets replaced —
   * so a press of a current chord landing then is held here rather than
   * opening the microphone, or stopping a reply, under the field being typed
   * into. Only presses defer: a release always lands, so a hold opened before
   * the recording began still ends when the key comes up.
   */
  #shortcutCapturing = false;

  constructor(options: HotkeyRegistrarOptions) {
    this.#host = options.host;
    this.#registersGlobalKeys = options.registersGlobalKeys;
    this.#hasCredentials = options.hasCredentials;
    this.#recordProductEvent = options.recordProductEvent;
    this.#shortcut = options.shortcut ?? globalShortcut;
    this.#createTalkKeyWatcher = options.createTalkKeyWatcher ?? talkKeyWatcher;
    this.#keys = new Map<HotkeyRank, KeyState>([
      [
        HOTKEY_RANK.TALK,
        {
          candidates: voiceHotkeyCandidates,
          onPress: () => {
            this.#sendPress(channels.onVoiceHotkeyPress);
            // A toggle has only the one edge, so it reports a release immediately
            // and one short enough to read as a tap. Every press then latches or
            // ends a turn.
            this.#sendTo(this.#voiceHostContents(), channels.onVoiceHotkeyRelease);
          },
          chosen: undefined,
          accelerator: undefined,
        },
      ],
      [
        HOTKEY_RANK.ASK,
        {
          candidates: askHotkeyCandidates,
          onPress: () => this.#summonAskField(),
          chosen: undefined,
          accelerator: undefined,
        },
      ],
      [
        HOTKEY_RANK.STOP,
        {
          candidates: stopHotkeyCandidates,
          onPress: () => this.#sendPress(channels.onStopHotkeyPress),
          chosen: undefined,
          accelerator: undefined,
        },
      ],
    ]);
  }

  get talk(): string | undefined {
    return this.#key(HOTKEY_RANK.TALK).accelerator;
  }

  get held(): boolean {
    return this.#held;
  }

  get ask(): string | undefined {
    return this.#key(HOTKEY_RANK.ASK).accelerator;
  }

  get stop(): string | undefined {
    return this.#key(HOTKEY_RANK.STOP).accelerator;
  }

  setShortcutCapturing(capturing: boolean): void {
    this.#shortcutCapturing = capturing;
  }

  setChosen(rank: HotkeyRank, chord: string | undefined): void {
    this.#key(rank).chosen = chord;
  }

  /**
   * Whether `chord` is spoken for by a key that outranks `forKey`. A rank's
   * whole candidate list is reserved, not just the chord it holds now: the talk
   * key's helper may fall back to any of them on a later launch, and the ask
   * key re-registers behind it.
   */
  reserve(chord: string, forKey: HotkeyRank): HotkeyRank | undefined {
    return this.#above(forKey).find((rank) => this.#owns(rank, chord));
  }

  /**
   * Re-registers `fromRank` and every rank below it, in order. Moving the talk
   * key lets everything go, because `unregisterAll` is exactly that; a lower
   * rank lets go only of itself and the ranks under it, so a change that is
   * none of the talk key's business cannot make its registration flicker — and
   * stop lets only itself go, because nothing yields to it. Each rank is then
   * taken afresh from the top down, because the chord a lower key may have is
   * decided by where the higher ones landed: a talk key moving onto Option-S
   * must win it, and one moving off must give it back.
   */
  async reapply(fromRank: HotkeyRank): Promise<void> {
    const ranks = RANK_ORDER.slice(RANK_ORDER.indexOf(fromRank));
    if (fromRank === HOTKEY_RANK.TALK) {
      const released = this.#talkKeyWatcher?.stop();
      this.#talkKeyWatcher = undefined;
      this.#shortcut.unregisterAll();
      // The system releases the old helper's chord when its process exits, not
      // when the kill is asked for, and the defaults sit in both helpers'
      // candidate lists — a successor that starts too early is refused the very
      // fallback it was promised.
      await released;
      this.#key(HOTKEY_RANK.TALK).accelerator = undefined;
      this.#held = true;
    } else {
      for (const rank of ranks) {
        const accelerator = this.#key(rank).accelerator;
        if (accelerator) this.#shortcut.unregister(accelerator);
      }
    }
    for (const rank of ranks) {
      this.#register(rank);
      // The panel keeps showing the old talk key until the new one actually
      // answers: the helper announces its own registration over stdout, and
      // every path without a helper is decided by the time `#register` returns.
      if (rank === HOTKEY_RANK.TALK && this.#talkKeyWatcher) continue;
      this.#host.hotkeyChanged(rank);
    }
  }

  /**
   * The helper is a process of Luke's own, so it does not outlive the app that
   * spawned it and leave a key registered against nothing. Nothing succeeds it
   * during quit, so its exit is not waited on.
   */
  release(): void {
    this.#shortcut.unregisterAll();
    void this.#talkKeyWatcher?.stop();
    this.#talkKeyWatcher = undefined;
  }

  #key(rank: HotkeyRank): KeyState {
    const state = this.#keys.get(rank);
    // SAFETY: the map is built over RANK_ORDER, which is total over HotkeyRank.
    if (!state) throw new Error(`No hotkey state for ${rank}`);
    return state;
  }

  #above(rank: HotkeyRank): readonly HotkeyRank[] {
    return RANK_ORDER.slice(0, RANK_ORDER.indexOf(rank));
  }

  /**
   * Every chord the ranks above `rank` could sit on, not just the ones they
   * have announced: the talk key's helper falls back through its own candidates
   * on its own clock and the ask key re-registers behind it, so a chord a
   * higher rank merely might take is already not this one's to have — the Luke
   * keys must never compete.
   */
  #taken(rank: HotkeyRank): readonly (string | undefined)[] {
    return this.#above(rank).flatMap((above) => {
      const state = this.#key(above);
      return [...state.candidates(state.chosen, []), state.accelerator];
    });
  }

  #owns(rank: HotkeyRank, chord: string): boolean {
    const state = this.#key(rank);
    return state.candidates(state.chosen, []).includes(chord) || chord === state.accelerator;
  }

  #sendTo(
    webContents: WebContents | undefined,
    channel: string,
    payload?: UnparsedWireValue,
  ): void {
    if (!webContents) return;
    if (payload === undefined) webContents.send(channel);
    else webContents.send(channel, payload);
  }

  #voiceHostContents(): WebContents | undefined {
    return this.#host.voiceHost()?.webContents;
  }

  /** A press the recording row is owed rather than the voice host. */
  #sendPress(channel: string): void {
    if (this.#shortcutCapturing) return;
    this.#sendTo(this.#voiceHostContents(), channel);
  }

  /**
   * The panel stands up focused, then the renderer is asked to put the caret in
   * the field — or, when the caret is already there, it reads the same press as
   * the dismissal, so one key summons and puts away like every launcher does.
   * The panel is the primary one, where every other app-level action lands.
   */
  #summonAskField(): void {
    const host = this.#host.primaryPanel();
    const displayId = host ? this.#host.displayIdFor(host.webContents) : undefined;
    if (displayId === undefined) return;
    const opening = this.#host.modeFor(displayId) !== "expanded";
    this.#host.setMode(displayId, "expanded", true);
    this.#sendTo(host?.webContents, channels.onLifecycle, "ask:focus");
    // The key summons the field wherever the panel already stood, so only the
    // press that actually opened one is an opening.
    if (opening) {
      this.#recordProductEvent(PRODUCT_EVENT.PANEL_OPEN, {
        panel_source: PRODUCT_PANEL_SOURCE.HOTKEY,
      });
    }
  }

  /**
   * Takes the named key from the system so it answers from whatever app is
   * frontmost, re-runnably: the chord is dropped first, because a key that
   * could not be re-taken must not still be claimed anywhere.
   *
   * Taking a system-wide key for a feature that cannot run would make every
   * press somewhere else in macOS do nothing, visibly, so a capture run and a
   * rank with no credential take nothing at all. The talk key asks its helper
   * before Electron, because the helper is the only one of the two that reports
   * the key being let go of, and a key you hold is the whole point; a summons
   * and a stop have no release edge to hear, so Electron is enough for them.
   */
  #register(rank: HotkeyRank): void {
    const state = this.#key(rank);
    state.accelerator = undefined;
    if (!this.#registersGlobalKeys) return;
    if (!this.#hasCredentials(rank)) return;
    if (rank === HOTKEY_RANK.TALK && this.#startTalkHelper()) return;
    this.#registerWithElectron(rank);
  }

  /**
   * The candidate loop against Electron. For the talk key it is a toggle rather
   * than a hold, because Electron reports only the press: a lesser thing than
   * the helper rather than a broken one, and what lets one key interrupt a
   * reply already playing.
   */
  #registerWithElectron(rank: HotkeyRank): void {
    const state = this.#key(rank);
    for (const accelerator of state.candidates(state.chosen, this.#taken(rank))) {
      if (!this.#shortcut.register(accelerator, state.onPress)) continue;
      state.accelerator = accelerator;
      if (rank === HOTKEY_RANK.TALK) this.#held = false;
      return;
    }
  }

  /**
   * Spawns the talk key's helper, answering whether it stood up. A deleted key
   * has no candidates, so there is nothing to spawn one for: the honest answer
   * is the absence the panel already shows.
   */
  #startTalkHelper(): boolean {
    const state = this.#key(HOTKEY_RANK.TALK);
    const candidates = state.candidates(state.chosen, this.#taken(HOTKEY_RANK.TALK));
    if (candidates.length === 0) return false;
    this.#talkKeyWatcher = this.#createTalkKeyWatcher({
      onPress: () => this.#sendPress(channels.onVoiceHotkeyPress),
      onRelease: () => this.#sendTo(this.#voiceHostContents(), channels.onVoiceHotkeyRelease),
      onRegistered: (accelerator) => {
        state.accelerator = accelerator;
        this.#host.hotkeyChanged(HOTKEY_RANK.TALK);
      },
      onUnavailable: () => {
        this.#talkKeyWatcher = undefined;
        this.#registerWithElectron(HOTKEY_RANK.TALK);
        this.#host.hotkeyChanged(HOTKEY_RANK.TALK);
      },
    });
    if (this.#talkKeyWatcher.start(candidates)) return true;
    this.#talkKeyWatcher = undefined;
    return false;
  }
}
