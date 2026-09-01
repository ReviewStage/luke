import { PRODUCT_EXCHANGE_KIND, type ProductExchangeKind } from "@sidecar/analytics";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import {
  PRESS_AUDIO_ACTOR_EVENT,
  selectDuckActive,
  selectExchangeKind,
  selectMicrophoneCall,
  selectRealtimeStatus,
  selectTalkLatched,
  selectTalkOpening,
  selectToolsAllowed,
  selectTypedTurn,
  VOICE_EXCHANGE_KIND,
  VOICE_MACHINE_EVENT,
  VOICE_MICROPHONE_PERMISSION,
  VOICE_PRESS_RELEASE,
  VOICE_RESOURCE,
  VOICE_TURN_ORIGIN,
  type VoiceExchangeKind,
  type VoiceMachineSnapshot,
  type VoiceNoticeIdentity,
  type VoicePressRelease,
  type VoiceResource,
  type VoiceRestart,
  type VoiceTurnOrigin,
  voiceMachine,
} from "@sidecar/voice-machine";
import { createActor, type InspectionEvent, type Observer, type Subscription } from "xstate";
import type { MicrophoneStatus } from "#shared/wire/audio";

export interface VoiceMachineControllerOptions {
  inspect?: Observer<InspectionEvent>;
  onRestart?: (restart: VoiceRestart) => void;
  onResourceStart?: (resource: VoiceResource) => (() => void) | void;
  onResourceStop?: (resource: VoiceResource) => void;
}

export interface VoiceMachinePressAudioBuffer {
  push(chunk: Int16Array): void;
  drain(): readonly Int16Array[];
  readonly bufferedMs: number;
  readonly droppedMs: number;
  readonly isEmpty: boolean;
}

const PRODUCT_KIND_BY_VOICE_KIND = {
  [VOICE_EXCHANGE_KIND.ANNOUNCEMENT]: PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT,
  [VOICE_EXCHANGE_KIND.SPOKEN]: PRODUCT_EXCHANGE_KIND.SPOKEN,
  [VOICE_EXCHANGE_KIND.TYPED]: PRODUCT_EXCHANGE_KIND.TYPED,
} satisfies Readonly<Record<VoiceExchangeKind, ProductExchangeKind>>;

export function productExchangeKind(
  kind: VoiceExchangeKind | undefined,
): ProductExchangeKind | undefined {
  return kind === undefined ? undefined : PRODUCT_KIND_BY_VOICE_KIND[kind];
}

function microphonePermission(
  status: MicrophoneStatus,
):
  | typeof VOICE_MICROPHONE_PERMISSION.GRANTED
  | typeof VOICE_MICROPHONE_PERMISSION.DENIED
  | undefined {
  if (status === "not-determined") return undefined;
  return status === "granted"
    ? VOICE_MICROPHONE_PERMISSION.GRANTED
    : VOICE_MICROPHONE_PERMISSION.DENIED;
}

export class VoiceMachineController {
  readonly #actor;

  constructor(options: VoiceMachineControllerOptions = {}) {
    this.#actor = createActor(voiceMachine, {
      input: {
        onRestart: options.onRestart,
        onResourceStart: options.onResourceStart,
        onResourceStop: options.onResourceStop,
      },
      ...(options.inspect ? { inspect: options.inspect } : undefined),
    }).start();
  }

  get snapshot(): VoiceMachineSnapshot {
    return this.#actor.getSnapshot();
  }

  get status(): RealtimeStatus {
    return selectRealtimeStatus(this.snapshot);
  }

  get duckActive(): boolean {
    return selectDuckActive(this.snapshot);
  }

  get exchangeKind(): ProductExchangeKind | undefined {
    return productExchangeKind(selectExchangeKind(this.snapshot));
  }

  get microphoneCall(): boolean {
    return selectMicrophoneCall(this.snapshot);
  }

  get talkLatched(): boolean {
    return selectTalkLatched(this.snapshot);
  }

  get talkOpening(): boolean {
    return selectTalkOpening(this.snapshot);
  }

  get toolsAllowed(): boolean {
    return selectToolsAllowed(this.snapshot);
  }

  get typedTurn(): boolean {
    return selectTypedTurn(this.snapshot);
  }

  subscribe(observer: () => void): Subscription {
    return this.#actor.subscribe(observer);
  }

  setAvailable(available: boolean): void {
    this.#actor.send({
      type: available ? VOICE_MACHINE_EVENT.AVAILABILITY_RESTORED : VOICE_MACHINE_EVENT.QUOTA_SPENT,
    });
  }

  setMeetingQuiet(active: boolean): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED, active });
  }

  setMicrophoneStatus(status: MicrophoneStatus): void {
    const permission = microphonePermission(status);
    if (permission === undefined) return;
    this.#actor.send({
      type: VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED,
      permission,
    });
  }

  setOutputSilent(silent: boolean): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED, silent });
  }

  enqueueNotice(notice: VoiceNoticeIdentity): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.NOTICE_ENQUEUED, notice });
  }

  pressDown(): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
  }

  pressReleased(release: VoicePressRelease): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.PRESS_RELEASED, release });
  }

  pressDiscarded(): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DISCARDED });
  }

  createPressAudioBuffer(): VoiceMachinePressAudioBuffer {
    const read = () => {
      let snapshot = { bufferedMs: 0, droppedMs: 0, isEmpty: true };
      this.#sendToPressAudio({
        type: PRESS_AUDIO_ACTOR_EVENT.READ,
        consume: (next) => {
          snapshot = next;
        },
      });
      return snapshot;
    };
    return {
      push: (chunk) => {
        this.#sendToPressAudio({ type: PRESS_AUDIO_ACTOR_EVENT.PUSH, chunk });
      },
      drain: () => {
        let chunks: readonly Int16Array[] = [];
        this.#sendToPressAudio({
          type: PRESS_AUDIO_ACTOR_EVENT.DRAIN,
          consume: (next) => {
            chunks = next;
          },
        });
        return chunks;
      },
      get bufferedMs() {
        return read().bufferedMs;
      },
      get droppedMs() {
        return read().droppedMs;
      },
      get isEmpty() {
        return read().isEmpty;
      },
    };
  }

  typedAsk(): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });
  }

  speakLuke(
    origin: Exclude<VoiceTurnOrigin, "developer-spoken" | "developer-typed" | "introduction">,
  ): boolean {
    const before = this.snapshot;
    this.#actor.send({ type: VOICE_MACHINE_EVENT.SPEAK_LUKE, origin });
    return this.snapshot !== before;
  }

  introductionStarted(): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.INTRODUCTION_STARTED });
  }

  introductionSpeak(): void {
    this.#actor.send({
      type: VOICE_MACHINE_EVENT.SPEAK_LUKE,
      origin: VOICE_TURN_ORIGIN.PROACTIVE,
    });
  }

  voiceChanged(live: boolean): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.VOICE_CHANGED, live });
  }

  restartDeveloperCall(): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_RESTARTED });
  }

  stop(): void {
    this.#actor.send({ type: VOICE_MACHINE_EVENT.STOP });
  }

  observeSessionStatus(status: RealtimeStatus): void {
    switch (status) {
      case REALTIME_STATUS.UNAVAILABLE:
        this.#actor.send({ type: VOICE_MACHINE_EVENT.QUOTA_SPENT });
        return;
      case REALTIME_STATUS.FAILED:
        this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_FAILED });
        return;
      case REALTIME_STATUS.IDLE:
        this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CLOSED });
        return;
      case REALTIME_STATUS.CONNECTING:
        return;
      case REALTIME_STATUS.LISTENING:
        if (this.status === REALTIME_STATUS.CONNECTING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
        } else if (this.status !== REALTIME_STATUS.LISTENING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
        }
        return;
      case REALTIME_STATUS.RESPONDING:
        if (this.status === REALTIME_STATUS.CONNECTING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
        }
        return;
      case REALTIME_STATUS.READY:
        if (this.status === REALTIME_STATUS.CONNECTING) {
          if (this.talkOpening) return;
          this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
        } else if (this.status === REALTIME_STATUS.RESPONDING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
        }
    }
  }

  stopActor(): void {
    this.#actor.stop();
  }

  #sendToPressAudio(
    event:
      | {
          type: typeof PRESS_AUDIO_ACTOR_EVENT.PUSH;
          chunk: Int16Array;
        }
      | {
          type: typeof PRESS_AUDIO_ACTOR_EVENT.DRAIN;
          consume: (chunks: readonly Int16Array[]) => void;
        }
      | {
          type: typeof PRESS_AUDIO_ACTOR_EVENT.READ;
          consume: (snapshot: { bufferedMs: number; droppedMs: number; isEmpty: boolean }) => void;
        },
  ): void {
    const actor = this.snapshot.children[VOICE_RESOURCE.PRESS_AUDIO_BUFFER];
    if (!actor) throw new Error("The current voice state owns no press audio buffer.");
    actor.send(event);
  }
}

export const VOICE_MACHINE_RELEASE = {
  LATCH: VOICE_PRESS_RELEASE.LATCH,
  SEND: VOICE_PRESS_RELEASE.SEND,
} as const;

export const VOICE_MACHINE_ORIGIN = {
  ARRIVAL: VOICE_TURN_ORIGIN.ARRIVAL,
  EVALUATOR: VOICE_TURN_ORIGIN.EVALUATOR,
  PROACTIVE: VOICE_TURN_ORIGIN.PROACTIVE,
  TOOL_OUTCOME: VOICE_TURN_ORIGIN.TOOL_OUTCOME,
} as const;
