import type { RealtimeStatus } from "@sidecar/realtime";
import { voiceExchangeActive } from "@sidecar/realtime";
import type { ConversationEntry } from "@sidecar/session";

/**
 * What a panel needs to draw the live conversation and cannot derive or read
 * elsewhere. Reported whole on every edge; the main process writes it to the
 * document every panel reads.
 */
export interface VoiceViewReport {
  voiceStatus: RealtimeStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  talkOpening: boolean;
  lukeCaptions: readonly string[] | undefined;
  liveConversationEntries: readonly ConversationEntry[];
}

/**
 * Who opened the exchange this edge began, as facts rather than as the
 * counted name: Luke's own speak-only call has no microphone, and only the
 * composer says typed in advance.
 */
export interface VoiceExchangeOpening {
  microphoneCall: boolean;
  typedAsk: boolean;
}

export interface VoiceViewReporterOptions {
  /** The view as it stands, read only when a report is being weighed. */
  compose(): VoiceViewReport;
  /** Who opened the exchange, asked only on the edge that opened one. */
  opening(): VoiceExchangeOpening;
  report(view: VoiceViewReport, exchange: VoiceExchangeOpening | undefined): void;
}

/** Whether two reports say the same thing, which is when neither is worth sending. */
function sameVoiceView(left: VoiceViewReport, right: VoiceViewReport): boolean {
  return (
    left.voiceStatus === right.voiceStatus &&
    left.voiceError === right.voiceError &&
    left.voiceNotice === right.voiceNotice &&
    left.talkOpening === right.talkOpening &&
    left.lukeCaptions === right.lukeCaptions &&
    left.liveConversationEntries === right.liveConversationEntries
  );
}

/**
 * What leaves the voice window for every panel to draw, and the two rules
 * about when.
 *
 * Two facts moving together are one report rather than two, because the
 * report is deferred to a microtask and folded until it drains. And a view
 * that did not move is not reported at all: the report becomes a version of
 * the document this same window reads, so one the view did not move would be
 * answered by a delivery asking for another, and the two would never stop.
 *
 * The count of exchanges rides the same report, on the opening edge alone —
 * a turn walking from connecting through responding is one exchange, and
 * this is the only place that knows who opened it.
 */
export class VoiceViewReporter {
  readonly #options: VoiceViewReporterOptions;
  #reported: VoiceViewReport | undefined;
  /** Whether the exchange the count last saw was still standing. */
  #counted = false;
  #queued = false;
  #stopped = false;

  constructor(options: VoiceViewReporterOptions) {
    this.#options = options;
  }

  /** Something moved; whether it was the view is settled when this drains. */
  touch(): void {
    if (this.#stopped || this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (!this.#stopped) this.#flush();
    });
  }

  stop(): void {
    this.#stopped = true;
  }

  #flush(): void {
    const view = this.#options.compose();
    if (this.#reported !== undefined && sameVoiceView(this.#reported, view)) return;
    this.#reported = view;
    const active = voiceExchangeActive(view.voiceStatus);
    const rising = active && !this.#counted;
    this.#counted = active;
    this.#options.report(view, rising ? this.#options.opening() : undefined);
  }
}
