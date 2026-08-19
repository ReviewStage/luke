import type { UnparsedWireValue } from "@sidecar/core";
import { type BrowserWindow, globalShortcut, type WebContents } from "electron";
import { channels, type WindowMode } from "./shared/contracts";
import {
  askHotkeyCandidates,
  stopHotkeyCandidates,
  voiceHotkeyCandidates,
} from "./shared/voice-hotkey";
import { type TalkKeyEdges, TalkKeyWatcher } from "./talk-key";

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
 * The panel surface the keys talk to: the voice host answers a press, and
 * every window is told which chord to teach when one of them moves.
 */
export interface HotkeyHost {
  voiceHost(): BrowserWindow | undefined;
  displayIdFor(sender: WebContents): number | undefined;
  setMode(displayId: number, mode: WindowMode, requestFocus: boolean): void;
  broadcast(channel: string, payload: UnparsedWireValue): void;
}

export interface HotkeyRegistrarOptions {
  host: HotkeyHost;
  /** A capture run drives the panel itself and must not grab a system key. */
  registersGlobalKeys: boolean;
  hasCredentials: () => boolean;
  shortcut?: ShortcutSurface;
  createTalkKeyWatcher?: (edges: TalkKeyEdges) => TalkKeyHandle;
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
  readonly #hasCredentials: () => boolean;
  readonly #shortcut: ShortcutSurface;
  readonly #createTalkKeyWatcher: (edges: TalkKeyEdges) => TalkKeyHandle;

  #talk: string | undefined;
  #chosenTalk: string | undefined;
  #talkKeyWatcher: TalkKeyHandle | undefined;
  /**
   * Whether the key reports being let go of. The helper does and the Electron
   * fallback cannot, and that is the difference between holding a turn and
   * toggling one — so the panel is told which key it actually has rather than
   * describing the one it hoped for.
   */
  #held = true;

  #ask: string | undefined;
  #chosenAsk: string | undefined;
  #stop: string | undefined;
  #chosenStop: string | undefined;

  constructor(options: HotkeyRegistrarOptions) {
    this.#host = options.host;
    this.#registersGlobalKeys = options.registersGlobalKeys;
    this.#hasCredentials = options.hasCredentials;
    this.#shortcut = options.shortcut ?? globalShortcut;
    this.#createTalkKeyWatcher =
      options.createTalkKeyWatcher ?? ((edges) => new TalkKeyWatcher(edges));
  }

  get talk(): string | undefined {
    return this.#talk;
  }

  get held(): boolean {
    return this.#held;
  }

  get ask(): string | undefined {
    return this.#ask;
  }

  get stop(): string | undefined {
    return this.#stop;
  }

  /** The stored choice for a rank, absent while the defaults stand. */
  setChosen(rank: HotkeyRank, chord: string | undefined): void {
    if (rank === HOTKEY_RANK.TALK) this.#chosenTalk = chord;
    else if (rank === HOTKEY_RANK.ASK) this.#chosenAsk = chord;
    else this.#chosenStop = chord;
  }

  /**
   * Whether `chord` is spoken for by a key that outranks `forKey`. Talk's
   * whole candidate list is reserved, not just the chord it holds now: its
   * helper may fall back to any of them on a later launch. Ask's candidates
   * are reserved the same way for the stop key.
   */
  reserve(chord: string, forKey: HotkeyRank): HotkeyRank | undefined {
    if (forKey !== HOTKEY_RANK.TALK && this.#talkOwns(chord)) return HOTKEY_RANK.TALK;
    if (forKey === HOTKEY_RANK.STOP && this.#askOwns(chord)) return HOTKEY_RANK.ASK;
    return undefined;
  }

  /**
   * Re-registers from `fromRank` down the pecking order. Talk lets everything
   * go — `unregisterAll` takes the lower keys down with it — then ask and
   * stop are taken afresh once it has settled. Ask lets only itself and stop
   * go; stop lets only itself go, because nothing yields to it.
   */
  async reapply(fromRank: HotkeyRank): Promise<void> {
    if (fromRank === HOTKEY_RANK.TALK) {
      await this.#applyTalk();
      return;
    }
    if (fromRank === HOTKEY_RANK.ASK) {
      this.#applyAsk();
      return;
    }
    this.#applyStop();
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

  #talkOwns(chord: string): boolean {
    return voiceHotkeyCandidates(this.#chosenTalk).includes(chord) || chord === this.#talk;
  }

  #askOwns(chord: string): boolean {
    return askHotkeyCandidates(this.#chosenAsk, []).includes(chord) || chord === this.#ask;
  }

  #send(webContents: WebContents | undefined, channel: string, payload?: UnparsedWireValue): void {
    if (!webContents) return;
    if (payload === undefined) webContents.send(channel);
    else webContents.send(channel, payload);
  }

  #voiceHostContents(): WebContents | undefined {
    return this.#host.voiceHost()?.webContents;
  }

  /**
   * Registers the talk key with the system so it answers from whatever app is
   * frontmost. Electron reports only the press and never the release, so the key
   * is a toggle rather than a hold — which is also what lets one key interrupt a
   * reply that is already playing.
   */
  #registerTalk(): void {
    if (!this.#registersGlobalKeys) return;
    // Taking a system-wide key for a feature that cannot run would make every
    // press somewhere else in macOS do nothing, visibly.
    if (!this.#hasCredentials()) return;
    // The helper first, because it is the only one of the two that reports the
    // key being let go of, and a key you hold is the whole point.
    this.#talkKeyWatcher = this.#createTalkKeyWatcher({
      onPress: () => this.#send(this.#voiceHostContents(), channels.voiceHotkeyPress),
      onRelease: () => this.#send(this.#voiceHostContents(), channels.voiceHotkeyRelease),
      onRegistered: (accelerator) => {
        this.#talk = accelerator;
        this.#sendTalk();
      },
      onUnavailable: () => {
        this.#talkKeyWatcher = undefined;
        this.#registerToggle();
        this.#sendTalk();
      },
    });
    if (this.#talkKeyWatcher.start(voiceHotkeyCandidates(this.#chosenTalk))) return;
    this.#talkKeyWatcher = undefined;
    this.#registerToggle();
  }

  /**
   * The talk key without a release: a press toggles the turn instead of holding
   * it. This is what answers when the helper cannot — another platform, a build
   * without it — and it is a lesser thing rather than a broken one, so it is
   * worth standing up rather than leaving the user with no key at all.
   */
  #registerToggle(): void {
    for (const accelerator of voiceHotkeyCandidates(this.#chosenTalk)) {
      const registered = this.#shortcut.register(accelerator, () => {
        this.#send(this.#voiceHostContents(), channels.voiceHotkeyPress);
        // A toggle has only the one edge, so it reports a release immediately and
        // one short enough to read as a tap. Every press then latches or ends a
        // turn.
        this.#send(this.#voiceHostContents(), channels.voiceHotkeyRelease);
      });
      if (!registered) continue;
      this.#talk = accelerator;
      this.#held = false;
      return;
    }
  }

  /**
   * Registers the key that summons the ask field from whatever app is frontmost,
   * on the talk key's own terms: never during a capture run, and never for a
   * conversation that cannot open — a system-wide key that answers nothing is a
   * key taken from every other app for no reason. Electron's registration is
   * enough here, because a summons has no release edge to hear.
   *
   * The press does two things in order: stands the panel up focused, then asks
   * the renderer to put the caret in the field — or, when the caret is already
   // SAFETY: The preceding check establishes the asserted contract.
   * there, the renderer reads the same press as the dismissal, so one key
   * summons and puts away like every launcher does. The panel that answers is
   * the voice host's, the same window every other app-level ask lands in.
   */
  #registerAsk(): void {
    // Re-runnable: moving the talk key lets everything go and registers afresh,
    // and a key that could not be re-taken must not still be claimed anywhere.
    this.#ask = undefined;
    if (!this.#registersGlobalKeys) return;
    if (!this.#hasCredentials()) return;
    // Every chord the talk key could sit on is taken, not just the one it has
    // announced: its helper falls back through its own candidates after this
    // runs, so a chord it merely might take is already not the ask key's to
    // have — the two Luke keys must never compete.
    for (const accelerator of askHotkeyCandidates(this.#chosenAsk, [
      ...voiceHotkeyCandidates(this.#chosenTalk),
      this.#talk,
    ])) {
      const registered = this.#shortcut.register(accelerator, () => {
        const host = this.#host.voiceHost();
        const displayId = host ? this.#host.displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        this.#host.setMode(displayId, "expanded", true);
        this.#send(host?.webContents, channels.lifecycle, "ask:focus");
      });
      if (!registered) continue;
      this.#ask = accelerator;
      return;
    }
  }

  /**
   * Registers the key that stops a reply mid-sentence from whatever app is
   * frontmost, on the ask key's exact terms: never during a capture run, never
   * without a credential, and never on a chord the other two Luke keys could
   * sit on — three keys must not compete any more than two, and the stop key
   * is the one that yields, because it alone has Escape standing behind it.
   * Electron's registration is enough here, because a stop has no release edge
   * to hear. The press carries no decision of its own: the renderer's session
   // SAFETY: The preceding check establishes the asserted contract.
   * answers whether there is a reply to stop, exactly as it answers Escape.
   */
  #registerStop(): void {
    // Re-runnable on the ask key's terms: moving another key registers afresh,
    // and a chord that could not be re-taken must not still be claimed anywhere.
    this.#stop = undefined;
    if (!this.#registersGlobalKeys) return;
    if (!this.#hasCredentials()) return;
    // Every chord the other two keys could sit on is taken, not just the ones
    // they have announced: the talk key's helper falls back through its own
    // candidates on its own clock, and the ask key re-registers behind it.
    for (const accelerator of stopHotkeyCandidates(this.#chosenStop, [
      ...voiceHotkeyCandidates(this.#chosenTalk),
      this.#talk,
      ...askHotkeyCandidates(this.#chosenAsk, []),
      this.#ask,
    ])) {
      const registered = this.#shortcut.register(accelerator, () => {
        this.#send(this.#voiceHostContents(), channels.stopHotkeyPress);
      });
      if (!registered) continue;
      this.#stop = accelerator;
      return;
    }
  }

  /**
   * Tells every renderer the ask key it should be teaching, whenever that
   // SAFETY: The preceding check establishes the asserted contract.
   * changes. The raw accelerator travels, as in bootstrap: the renderer needs
   * both its spellings, and an absent key clears the hint rather than leaving a
   * keycap up for a chord that answers nothing.
   */
  #sendAsk(): void {
    this.#host.broadcast(channels.askHotkeyChanged, this.#ask);
  }

  /**
   * Tells every renderer the stop key it should be describing, whenever that
   * changes. An absence travels too, for the guide's sake: a chord that answers
   * nothing must not be one Luke claims to have.
   */
  #sendStop(): void {
    this.#host.broadcast(channels.stopHotkeyChanged, this.#stop);
  }

  /**
   * Tells every renderer the key it should be showing, whenever that changes.
   * The accelerator rather than its label, on the ask key's terms: the renderer
   // SAFETY: The preceding check establishes the asserted contract.
   * draws the chord as its separate keys and says it as one word, and only the
   * accelerator produces both.
   */
  #sendTalk(): void {
    this.#host.broadcast(channels.voiceHotkeyChanged, {
      ...(this.#talk ? { hotkey: this.#talk } : undefined),
      held: this.#held,
    });
  }

  /**
   * Moves the talk key to whatever the stored choice now says, while the app
   * is running. The old key is let go of in full before the new one is asked
   * for, so the two can never race for the same chord — and letting everything
   * go takes the ask key down with it, because `unregisterAll` is exactly that,
   * so the ask key is registered afresh once the talk key has settled. Letting
   * go means waiting: the system releases the old helper's chord when its
   * process exits, not when the kill is asked for, and the defaults sit in both
   * helpers' candidate lists — a successor that starts too early is refused the
   * very fallback it was promised. The panel keeps showing the old key until
   * the new one actually answers: the helper announces its own registration
   * over stdout, and every path without a helper is decided by the time
   * `#registerTalk` returns.
   */
  async #applyTalk(): Promise<void> {
    const released = this.#talkKeyWatcher?.stop();
    this.#talkKeyWatcher = undefined;
    this.#shortcut.unregisterAll();
    await released;
    this.#talk = undefined;
    this.#held = true;
    this.#registerTalk();
    if (!this.#talkKeyWatcher) this.#sendTalk();
    // The ask key went down with `unregisterAll`, and the chord it can have may
    // itself have changed — the talk key may have moved onto or off of one of
    // its candidates — so it is re-taken now and the panel told what it teaches.
    this.#registerAsk();
    this.#sendAsk();
    // The stop key went down with it and yields to both, so it goes last: a
    // talk key moving onto Option-S must win the chord, and one moving off must
    // give it back.
    this.#registerStop();
    this.#sendStop();
  }

  /**
   * Moves the ask key to whatever the stored choice now says, while the app is
   * running. Only the ask key's own chord is let go of — the talk key's
   * registration must not flicker for a change that is none of its business —
   * and unlike the talk key there is no helper exit to wait for: Electron
   * releases a chord the moment it is asked to. The stop key is let go of and
   * re-taken behind it, because the chord it may have is decided by where the
   * ask key lands: an ask key moving onto Option-S must win it, and one moving
   * off must give it back.
   */
  #applyAsk(): void {
    if (this.#ask) this.#shortcut.unregister(this.#ask);
    if (this.#stop) this.#shortcut.unregister(this.#stop);
    this.#registerAsk();
    this.#sendAsk();
    this.#registerStop();
    this.#sendStop();
  }

  /**
   * Moves the stop key to whatever the stored choice now says, while the app
   * is running. Only its own chord is let go of: the stop key is the bottom of
   * the pecking order, so where it lands is decided by the other two keys and
   * moving it can never oblige either of them to move.
   */
  #applyStop(): void {
    if (this.#stop) this.#shortcut.unregister(this.#stop);
    this.#registerStop();
    this.#sendStop();
  }
}
