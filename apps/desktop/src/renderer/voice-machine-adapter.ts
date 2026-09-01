import { PRODUCT_EXCHANGE_KIND, type ProductExchangeKind } from "@sidecar/analytics";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import {
  selectDuckActive,
  selectExchangeKind,
  selectRealtimeStatus,
  VOICE_EXCHANGE_KIND,
  VOICE_MACHINE_EVENT,
  VOICE_MICROPHONE_PERMISSION,
  VOICE_PRESS_RELEASE,
  VOICE_TURN_ORIGIN,
  type VoiceExchangeKind,
  voiceMachine,
} from "@sidecar/voice-machine";
import { createActor, type InspectionEvent, type Observer } from "xstate";
import type { MicrophoneStatus } from "#shared/wire/audio";

export interface LegacyVoiceView {
  meetingQuiet: boolean;
  microphoneCall: boolean;
  microphoneStatus: MicrophoneStatus;
  outputSilent: boolean;
  status: RealtimeStatus;
  typedExchange: boolean;
}

export interface VoiceMachineParity {
  duckActive: boolean;
  status: RealtimeStatus;
}

export interface VoiceMachineAdapterOptions {
  inspect?: Observer<InspectionEvent>;
  onMismatch?: (legacy: LegacyVoiceView, chart: VoiceMachineParity) => void;
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

export class VoiceMachineShadowAdapter {
  readonly #actor;
  readonly #onMismatch: VoiceMachineAdapterOptions["onMismatch"];
  #view: LegacyVoiceView | undefined;

  constructor(options: VoiceMachineAdapterOptions = {}) {
    this.#onMismatch = options.onMismatch;
    this.#actor = createActor(voiceMachine, {
      input: {},
      ...(options.inspect ? { inspect: options.inspect } : undefined),
    }).start();
  }

  get snapshot() {
    return this.#actor.getSnapshot();
  }

  sync(next: LegacyVoiceView): VoiceMachineParity {
    const previous = this.#view;
    this.#view = next;
    if (previous?.meetingQuiet !== next.meetingQuiet) {
      this.#actor.send({
        type: VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED,
        active: next.meetingQuiet,
      });
    }
    if (previous?.outputSilent !== next.outputSilent) {
      this.#actor.send({
        type: VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED,
        silent: next.outputSilent,
      });
    }
    if (previous?.microphoneStatus !== next.microphoneStatus) {
      const permission = microphonePermission(next.microphoneStatus);
      if (permission !== undefined) {
        this.#actor.send({
          type: VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED,
          permission,
        });
      }
    }
    if (previous?.status !== next.status) this.#syncStatus(previous, next);

    const parity = {
      duckActive: selectDuckActive(this.snapshot),
      status: selectRealtimeStatus(this.snapshot),
    };
    const legacyDuck =
      next.status === REALTIME_STATUS.CONNECTING ||
      next.status === REALTIME_STATUS.LISTENING ||
      next.status === REALTIME_STATUS.RESPONDING;
    if (parity.status !== next.status || parity.duckActive !== legacyDuck) {
      this.#onMismatch?.(next, parity);
    }
    return parity;
  }

  stop(): void {
    this.#actor.stop();
  }

  #syncStatus(previous: LegacyVoiceView | undefined, next: LegacyVoiceView): void {
    switch (next.status) {
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
        this.#startExchange(next);
        return;
      case REALTIME_STATUS.LISTENING:
        if (previous?.status === REALTIME_STATUS.CONNECTING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
          return;
        }
        this.#actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
        return;
      case REALTIME_STATUS.RESPONDING:
        if (previous?.status === REALTIME_STATUS.CONNECTING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
          if (selectRealtimeStatus(this.snapshot) === REALTIME_STATUS.LISTENING) {
            this.#actor.send({
              type: VOICE_MACHINE_EVENT.PRESS_RELEASED,
              release: VOICE_PRESS_RELEASE.SEND,
            });
          }
          return;
        }
        if (previous?.status === REALTIME_STATUS.LISTENING) {
          this.#actor.send({
            type: VOICE_MACHINE_EVENT.PRESS_RELEASED,
            release: VOICE_PRESS_RELEASE.SEND,
          });
          return;
        }
        if (next.typedExchange) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });
        } else {
          this.#actor.send({
            type: VOICE_MACHINE_EVENT.SPEAK_LUKE,
            origin: VOICE_TURN_ORIGIN.PROACTIVE,
          });
        }
        return;
      case REALTIME_STATUS.READY:
        if (previous?.status === REALTIME_STATUS.RESPONDING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
        } else if (previous?.status === REALTIME_STATUS.CONNECTING) {
          this.#actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
          if (selectRealtimeStatus(this.snapshot) === REALTIME_STATUS.RESPONDING) {
            this.#actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
          }
        }
    }
  }

  #startExchange(view: LegacyVoiceView): void {
    if (view.typedExchange) {
      this.#actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });
      return;
    }
    if (view.microphoneCall) {
      this.#actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
      return;
    }
    this.#actor.send({
      type: VOICE_MACHINE_EVENT.SPEAK_LUKE,
      origin: VOICE_TURN_ORIGIN.PROACTIVE,
    });
  }
}

export function shadowExchangeKind(adapter: VoiceMachineShadowAdapter) {
  return productExchangeKind(selectExchangeKind(adapter.snapshot));
}
