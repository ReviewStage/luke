import { PressAudioBuffer, REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import {
  assign,
  type EventObject,
  fromCallback,
  fromTransition,
  type SnapshotFrom,
  sendTo,
  setup,
  stateIn,
} from "xstate";

export const VOICE_MACHINE_EVENT = {
  AVAILABILITY_RESTORED: "availability.restored",
  CALL_CLOSED: "call.closed",
  CALL_CONNECTED: "call.connected",
  CALL_FAILED: "call.failed",
  INTRODUCTION_STARTED: "introduction.started",
  MEETING_QUIET_CHANGED: "meetingQuiet.changed",
  MICROPHONE_PERMISSION_CHANGED: "microphonePermission.changed",
  NOTICE_ENQUEUED: "notice.enqueued",
  OUTPUT_SILENCE_CHANGED: "outputSilence.changed",
  PRESS_DOWN: "press.down",
  PRESS_RELEASED: "press.released",
  QUOTA_SPENT: "quota.spent",
  REMOTE_QUIET: "remote.quiet",
  REPLY_STARTED: "reply.started",
  REPLY_SETTLED: "reply.settled",
  SPEAK_LUKE: "speak.luke",
  STOP: "stop",
  TYPED_ASK: "typedAsk.sent",
  VOICE_CHANGED: "voice.changed",
} as const;

export const VOICE_TURN_ORIGIN = {
  ARRIVAL: "arrival",
  DEVELOPER_SPOKEN: "developer-spoken",
  DEVELOPER_TYPED: "developer-typed",
  EVALUATOR: "evaluator",
  INTRODUCTION: "introduction",
  PROACTIVE: "proactive",
  TOOL_OUTCOME: "tool-outcome",
} as const;

export type VoiceTurnOrigin = (typeof VOICE_TURN_ORIGIN)[keyof typeof VOICE_TURN_ORIGIN];

export const VOICE_PRESS_RELEASE = {
  LATCH: "latch",
  SEND: "send",
} as const;

export type VoicePressRelease = (typeof VOICE_PRESS_RELEASE)[keyof typeof VOICE_PRESS_RELEASE];

export const VOICE_MICROPHONE_PERMISSION = {
  DENIED: "denied",
  GRANTED: "granted",
  UNKNOWN: "unknown",
} as const;

export type VoiceMicrophonePermission =
  (typeof VOICE_MICROPHONE_PERMISSION)[keyof typeof VOICE_MICROPHONE_PERMISSION];

export const VOICE_RESTART = {
  DROP: "drop",
  NONE: "none",
  RESTART: "restart",
  WAIT: "wait",
} as const;

export type VoiceRestart = (typeof VOICE_RESTART)[keyof typeof VOICE_RESTART];

export const VOICE_RESOURCE = {
  CAPTURE_STREAM: "capture-stream",
  IDLE_TIMER: "idle-timer",
  NOTICE_HOLD_QUEUE: "notice-hold-queue",
  PEER_CONNECTION: "peer-connection",
  PRESS_AUDIO_BUFFER: "press-audio-buffer",
  QUIET_TIMER: "quiet-timer",
} as const;

export type VoiceResource = (typeof VOICE_RESOURCE)[keyof typeof VOICE_RESOURCE];

export const PRESS_AUDIO_ACTOR_EVENT = {
  DRAIN: "pressAudio.drain",
  PUSH: "pressAudio.push",
} as const;

export type PressAudioActorEvent =
  | {
      type: typeof PRESS_AUDIO_ACTOR_EVENT.DRAIN;
      consume: (chunks: readonly Int16Array[]) => void;
    }
  | {
      type: typeof PRESS_AUDIO_ACTOR_EVENT.PUSH;
      chunk: Int16Array;
    };

export const VOICE_EXCHANGE_KIND = {
  ANNOUNCEMENT: "announcement",
  SPOKEN: "spoken",
  TYPED: "typed",
} as const;

export type VoiceExchangeKind = (typeof VOICE_EXCHANGE_KIND)[keyof typeof VOICE_EXCHANGE_KIND];

export interface VoiceResourceInput {
  resource: VoiceResource;
  onStart?: (resource: VoiceResource) => void;
  onStop?: (resource: VoiceResource) => void;
}

export interface NoticeQueueSnapshot {
  holding: boolean;
  held: readonly string[];
  ready: readonly string[];
}

export type NoticeQueueEvent =
  | {
      type: typeof VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED;
      active: boolean;
    }
  | {
      type: typeof VOICE_MACHINE_EVENT.NOTICE_ENQUEUED;
      noticeId: string;
    };

const EMPTY_NOTICE_QUEUE: NoticeQueueSnapshot = {
  holding: false,
  held: [],
  ready: [],
};

export const noticeHoldQueueActor = fromTransition(
  (snapshot: NoticeQueueSnapshot, event: NoticeQueueEvent): NoticeQueueSnapshot => {
    if (event.type === VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED) {
      if (event.active) return { ...snapshot, holding: true, ready: [] };
      return { holding: false, held: [], ready: snapshot.held };
    }
    if (!snapshot.holding) {
      return { ...snapshot, ready: [...snapshot.ready, event.noticeId] };
    }
    const withoutOlder = snapshot.held.filter((noticeId) => noticeId !== event.noticeId);
    return { ...snapshot, held: [...withoutOlder, event.noticeId] };
  },
  EMPTY_NOTICE_QUEUE,
);

export type VoiceMachineEvent =
  | { type: typeof VOICE_MACHINE_EVENT.AVAILABILITY_RESTORED }
  | { type: typeof VOICE_MACHINE_EVENT.CALL_CLOSED }
  | { type: typeof VOICE_MACHINE_EVENT.CALL_CONNECTED }
  | { type: typeof VOICE_MACHINE_EVENT.CALL_FAILED }
  | { type: typeof VOICE_MACHINE_EVENT.INTRODUCTION_STARTED }
  | {
      type: typeof VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED;
      active: boolean;
    }
  | {
      type: typeof VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED;
      permission: VoiceMicrophonePermission;
    }
  | { type: typeof VOICE_MACHINE_EVENT.NOTICE_ENQUEUED; noticeId: string }
  | { type: typeof VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED; silent: boolean }
  | { type: typeof VOICE_MACHINE_EVENT.PRESS_DOWN }
  | {
      type: typeof VOICE_MACHINE_EVENT.PRESS_RELEASED;
      release: VoicePressRelease;
    }
  | { type: typeof VOICE_MACHINE_EVENT.QUOTA_SPENT }
  | { type: typeof VOICE_MACHINE_EVENT.REMOTE_QUIET }
  | { type: typeof VOICE_MACHINE_EVENT.REPLY_STARTED }
  | { type: typeof VOICE_MACHINE_EVENT.REPLY_SETTLED }
  | {
      type: typeof VOICE_MACHINE_EVENT.SPEAK_LUKE;
      origin:
        | typeof VOICE_TURN_ORIGIN.ARRIVAL
        | typeof VOICE_TURN_ORIGIN.EVALUATOR
        | typeof VOICE_TURN_ORIGIN.PROACTIVE
        | typeof VOICE_TURN_ORIGIN.TOOL_OUTCOME;
    }
  | { type: typeof VOICE_MACHINE_EVENT.STOP }
  | { type: typeof VOICE_MACHINE_EVENT.TYPED_ASK }
  | { type: typeof VOICE_MACHINE_EVENT.VOICE_CHANGED; live: boolean };

interface VoiceMachineContext {
  onResourceStart: ((resource: VoiceResource) => void) | undefined;
  onResourceStop: ((resource: VoiceResource) => void) | undefined;
  onRestart: ((restart: VoiceRestart) => void) | undefined;
  turnOrigin: VoiceTurnOrigin | undefined;
}

export interface VoiceMachineInput {
  onResourceStart?: (resource: VoiceResource) => void;
  onResourceStop?: (resource: VoiceResource) => void;
  onRestart?: (restart: VoiceRestart) => void;
}

const resourceActor = fromCallback<EventObject, VoiceResourceInput>(({ input }) => {
  input.onStart?.(input.resource);
  return () => input.onStop?.(input.resource);
});

export const pressAudioBufferActor = fromCallback<PressAudioActorEvent, VoiceResourceInput>(
  ({ input, receive }) => {
    const buffer = new PressAudioBuffer();
    input.onStart?.(input.resource);
    receive((event) => {
      if (event.type === PRESS_AUDIO_ACTOR_EVENT.PUSH) {
        buffer.push(event.chunk);
        return;
      }
      event.consume(buffer.drain());
    });
    return () => input.onStop?.(input.resource);
  },
);

function resourceInput(resource: VoiceResource) {
  return ({ context }: { context: VoiceMachineContext }): VoiceResourceInput => ({
    resource,
    onStart: context.onResourceStart,
    onStop: context.onResourceStop,
  });
}

export const voiceMachine = setup({
  // SAFETY: These assertions are XState's compile-time declarations; every runtime
  // context, event, and input is constructed by the typed machine below.
  types: {
    context: {} as VoiceMachineContext,
    events: {} as VoiceMachineEvent,
    input: {} as VoiceMachineInput,
  },
  actors: {
    captureStream: resourceActor,
    idleTimer: resourceActor,
    noticeHoldQueue: noticeHoldQueueActor,
    peerConnection: resourceActor,
    pressAudioBuffer: pressAudioBufferActor,
    quietTimer: resourceActor,
  },
  guards: {
    microphoneGranted: stateIn("#voiceMicrophone.granted"),
    noticesReleased: stateIn("#voiceNotices.released"),
    releaseLatches: ({ event }) =>
      event.type === VOICE_MACHINE_EVENT.PRESS_RELEASED &&
      event.release === VOICE_PRESS_RELEASE.LATCH,
    releaseSends: ({ event }) =>
      event.type === VOICE_MACHINE_EVENT.PRESS_RELEASED &&
      event.release === VOICE_PRESS_RELEASE.SEND,
    toolsAllowed: ({ context }) =>
      context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_SPOKEN ||
      context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_TYPED,
  },
  actions: {
    clearOrigin: assign({ turnOrigin: () => undefined }),
    setIntroductionOrigin: assign({
      turnOrigin: () => VOICE_TURN_ORIGIN.INTRODUCTION,
    }),
    setLukeOrigin: assign({
      turnOrigin: ({ event }) =>
        event.type === VOICE_MACHINE_EVENT.SPEAK_LUKE ? event.origin : undefined,
    }),
    setSpokenOrigin: assign({
      turnOrigin: () => VOICE_TURN_ORIGIN.DEVELOPER_SPOKEN,
    }),
    setTypedOrigin: assign({
      turnOrigin: () => VOICE_TURN_ORIGIN.DEVELOPER_TYPED,
    }),
    reportRestart: ({ context }) => context.onRestart?.(VOICE_RESTART.RESTART),
    reportRestartDrop: ({ context }) => context.onRestart?.(VOICE_RESTART.DROP),
  },
}).createMachine({
  id: "voiceMachine",
  initial: "ordinary",
  context: ({ input }) => ({
    onResourceStart: input.onResourceStart,
    onResourceStop: input.onResourceStop,
    onRestart: input.onRestart,
    turnOrigin: undefined,
  }),
  states: {
    ordinary: {
      type: "parallel",
      invoke: {
        id: VOICE_RESOURCE.NOTICE_HOLD_QUEUE,
        src: "noticeHoldQueue",
      },
      on: {
        [VOICE_MACHINE_EVENT.NOTICE_ENQUEUED]: {
          actions: sendTo(VOICE_RESOURCE.NOTICE_HOLD_QUEUE, ({ event }) => event),
        },
      },
      states: {
        lifecycle: {
          id: "voiceLifecycle",
          initial: "idle",
          on: {
            [VOICE_MACHINE_EVENT.QUOTA_SPENT]: {
              target: ".unavailable",
              actions: "clearOrigin",
            },
            [VOICE_MACHINE_EVENT.CALL_FAILED]: {
              target: ".failed",
              actions: "clearOrigin",
            },
            [VOICE_MACHINE_EVENT.CALL_CLOSED]: {
              target: ".idle",
              actions: "clearOrigin",
            },
            [VOICE_MACHINE_EVENT.INTRODUCTION_STARTED]: {
              target: ".introduction.connecting",
              actions: "setIntroductionOrigin",
            },
          },
          states: {
            unavailable: {
              on: {
                [VOICE_MACHINE_EVENT.AVAILABILITY_RESTORED]: "idle",
              },
            },
            idle: {
              on: {
                [VOICE_MACHINE_EVENT.PRESS_DOWN]: [
                  {
                    guard: "microphoneGranted",
                    target: "developerCall.spoken.connectingHeld",
                    actions: "setSpokenOrigin",
                  },
                  {
                    target: "permissionPending",
                    actions: "setSpokenOrigin",
                  },
                ],
                [VOICE_MACHINE_EVENT.SPEAK_LUKE]: {
                  guard: "noticesReleased",
                  target: "speakOnlyCall.connecting",
                  actions: "setLukeOrigin",
                },
                [VOICE_MACHINE_EVENT.TYPED_ASK]: {
                  target: "developerCall.typedConnecting",
                  actions: "setTypedOrigin",
                },
              },
            },
            failed: {
              on: {
                [VOICE_MACHINE_EVENT.AVAILABILITY_RESTORED]: "idle",
                [VOICE_MACHINE_EVENT.PRESS_DOWN]: [
                  {
                    guard: "microphoneGranted",
                    target: "developerCall.spoken.connectingHeld",
                    actions: "setSpokenOrigin",
                  },
                  {
                    target: "permissionPending",
                    actions: "setSpokenOrigin",
                  },
                ],
                [VOICE_MACHINE_EVENT.TYPED_ASK]: {
                  target: "developerCall.typedConnecting",
                  actions: "setTypedOrigin",
                },
              },
            },
            permissionPending: {
              on: {
                [VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED]: [
                  {
                    guard: ({ event }) => event.permission === VOICE_MICROPHONE_PERMISSION.GRANTED,
                    target: "developerCall.spoken.connectingHeld",
                  },
                  {
                    target: "idle",
                    actions: "clearOrigin",
                  },
                ],
                [VOICE_MACHINE_EVENT.PRESS_RELEASED]: {
                  target: "idle",
                  actions: "clearOrigin",
                },
              },
            },
            developerCall: {
              invoke: {
                id: VOICE_RESOURCE.PEER_CONNECTION,
                src: "peerConnection",
                input: resourceInput(VOICE_RESOURCE.PEER_CONNECTION),
              },
              initial: "typedConnecting",
              states: {
                typedConnecting: {
                  on: {
                    [VOICE_MACHINE_EVENT.CALL_CONNECTED]: "typedResponding",
                  },
                },
                typedResponding: {
                  invoke: {
                    id: VOICE_RESOURCE.QUIET_TIMER,
                    src: "quietTimer",
                    input: resourceInput(VOICE_RESOURCE.QUIET_TIMER),
                  },
                  on: {
                    [VOICE_MACHINE_EVENT.REPLY_SETTLED]: {
                      target: "ready",
                      actions: "clearOrigin",
                    },
                    [VOICE_MACHINE_EVENT.REMOTE_QUIET]: {
                      target: "ready",
                      actions: "clearOrigin",
                    },
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: {
                      target: "spoken.listeningHeld",
                      actions: "setSpokenOrigin",
                    },
                  },
                },
                lukeResponding: {
                  invoke: {
                    id: VOICE_RESOURCE.QUIET_TIMER,
                    src: "quietTimer",
                    input: resourceInput(VOICE_RESOURCE.QUIET_TIMER),
                  },
                  on: {
                    [VOICE_MACHINE_EVENT.REPLY_SETTLED]: {
                      target: "ready",
                      actions: "clearOrigin",
                    },
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: {
                      target: "spoken.listeningHeld",
                      actions: "setSpokenOrigin",
                    },
                  },
                },
                ready: {
                  invoke: {
                    id: VOICE_RESOURCE.IDLE_TIMER,
                    src: "idleTimer",
                    input: resourceInput(VOICE_RESOURCE.IDLE_TIMER),
                  },
                  on: {
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: {
                      target: "spoken.listeningHeld",
                      actions: "setSpokenOrigin",
                    },
                    [VOICE_MACHINE_EVENT.SPEAK_LUKE]: {
                      guard: "noticesReleased",
                      target: "lukeResponding",
                      actions: "setLukeOrigin",
                    },
                    [VOICE_MACHINE_EVENT.STOP]: "#voiceLifecycle.idle",
                    [VOICE_MACHINE_EVENT.TYPED_ASK]: {
                      target: "typedResponding",
                      actions: "setTypedOrigin",
                    },
                  },
                },
                spoken: {
                  invoke: {
                    id: VOICE_RESOURCE.CAPTURE_STREAM,
                    src: "captureStream",
                    input: resourceInput(VOICE_RESOURCE.CAPTURE_STREAM),
                  },
                  initial: "connectingHeld",
                  states: {
                    connectingHeld: {
                      invoke: {
                        id: VOICE_RESOURCE.PRESS_AUDIO_BUFFER,
                        src: "pressAudioBuffer",
                        input: resourceInput(VOICE_RESOURCE.PRESS_AUDIO_BUFFER),
                      },
                      on: {
                        [VOICE_MACHINE_EVENT.CALL_CONNECTED]: "listeningHeld",
                        [VOICE_MACHINE_EVENT.PRESS_RELEASED]: [
                          {
                            guard: "releaseLatches",
                            target: "connectingLatched",
                          },
                          {
                            guard: "releaseSends",
                            target: "connectingReleased",
                          },
                        ],
                      },
                    },
                    connectingLatched: {
                      invoke: {
                        id: VOICE_RESOURCE.PRESS_AUDIO_BUFFER,
                        src: "pressAudioBuffer",
                        input: resourceInput(VOICE_RESOURCE.PRESS_AUDIO_BUFFER),
                      },
                      on: {
                        [VOICE_MACHINE_EVENT.CALL_CONNECTED]: "listeningLatched",
                        [VOICE_MACHINE_EVENT.PRESS_RELEASED]: {
                          guard: "releaseSends",
                          target: "connectingReleased",
                        },
                      },
                    },
                    connectingReleased: {
                      invoke: {
                        id: VOICE_RESOURCE.PRESS_AUDIO_BUFFER,
                        src: "pressAudioBuffer",
                        input: resourceInput(VOICE_RESOURCE.PRESS_AUDIO_BUFFER),
                      },
                      on: {
                        [VOICE_MACHINE_EVENT.CALL_CONNECTED]: "responding",
                      },
                    },
                    listeningHeld: {
                      on: {
                        [VOICE_MACHINE_EVENT.PRESS_RELEASED]: [
                          {
                            guard: "releaseLatches",
                            target: "listeningLatched",
                          },
                          {
                            guard: "releaseSends",
                            target: "responding",
                          },
                        ],
                      },
                    },
                    listeningLatched: {
                      on: {
                        [VOICE_MACHINE_EVENT.PRESS_RELEASED]: {
                          guard: "releaseSends",
                          target: "responding",
                        },
                      },
                    },
                    responding: {
                      invoke: {
                        id: VOICE_RESOURCE.QUIET_TIMER,
                        src: "quietTimer",
                        input: resourceInput(VOICE_RESOURCE.QUIET_TIMER),
                      },
                      on: {
                        [VOICE_MACHINE_EVENT.REPLY_SETTLED]: {
                          target: "#voiceLifecycle.developerCall.ready",
                          actions: "clearOrigin",
                        },
                        [VOICE_MACHINE_EVENT.REMOTE_QUIET]: {
                          target: "#voiceLifecycle.developerCall.ready",
                          actions: "clearOrigin",
                        },
                        [VOICE_MACHINE_EVENT.PRESS_DOWN]: {
                          target: "listeningHeld",
                          actions: "setSpokenOrigin",
                        },
                      },
                    },
                  },
                },
              },
            },
            speakOnlyCall: {
              invoke: {
                id: VOICE_RESOURCE.PEER_CONNECTION,
                src: "peerConnection",
                input: resourceInput(VOICE_RESOURCE.PEER_CONNECTION),
              },
              initial: "connecting",
              states: {
                connecting: {
                  on: {
                    [VOICE_MACHINE_EVENT.CALL_CONNECTED]: "responding",
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: {
                      target: "#voiceLifecycle.permissionPending",
                      actions: "setSpokenOrigin",
                    },
                  },
                },
                responding: {
                  invoke: {
                    id: VOICE_RESOURCE.QUIET_TIMER,
                    src: "quietTimer",
                    input: resourceInput(VOICE_RESOURCE.QUIET_TIMER),
                  },
                  on: {
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: [
                      {
                        guard: "microphoneGranted",
                        target: "#voiceLifecycle.developerCall.spoken.connectingHeld",
                        actions: "setSpokenOrigin",
                      },
                      {
                        target: "#voiceLifecycle.permissionPending",
                        actions: "setSpokenOrigin",
                      },
                    ],
                    [VOICE_MACHINE_EVENT.REPLY_SETTLED]: "ready",
                  },
                },
                ready: {
                  invoke: {
                    id: VOICE_RESOURCE.IDLE_TIMER,
                    src: "idleTimer",
                    input: resourceInput(VOICE_RESOURCE.IDLE_TIMER),
                  },
                  on: {
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: [
                      {
                        guard: "microphoneGranted",
                        target: "#voiceLifecycle.developerCall.spoken.connectingHeld",
                        actions: "setSpokenOrigin",
                      },
                      {
                        target: "#voiceLifecycle.permissionPending",
                        actions: "setSpokenOrigin",
                      },
                    ],
                    [VOICE_MACHINE_EVENT.SPEAK_LUKE]: {
                      target: "responding",
                      actions: "setLukeOrigin",
                    },
                    [VOICE_MACHINE_EVENT.STOP]: "#voiceLifecycle.idle",
                  },
                },
              },
            },
            introduction: {
              invoke: {
                id: VOICE_RESOURCE.PEER_CONNECTION,
                src: "peerConnection",
                input: resourceInput(VOICE_RESOURCE.PEER_CONNECTION),
              },
              initial: "connecting",
              states: {
                connecting: {
                  on: {
                    [VOICE_MACHINE_EVENT.CALL_CONNECTED]: "ready",
                  },
                },
                ready: {
                  on: {
                    [VOICE_MACHINE_EVENT.PRESS_DOWN]: "practice.listening",
                    [VOICE_MACHINE_EVENT.SPEAK_LUKE]: "responding",
                  },
                },
                practice: {
                  invoke: {
                    id: VOICE_RESOURCE.CAPTURE_STREAM,
                    src: "captureStream",
                    input: resourceInput(VOICE_RESOURCE.CAPTURE_STREAM),
                  },
                  initial: "listening",
                  states: {
                    listening: {
                      on: {
                        [VOICE_MACHINE_EVENT.PRESS_RELEASED]: "responding",
                      },
                    },
                    responding: {
                      invoke: {
                        id: VOICE_RESOURCE.QUIET_TIMER,
                        src: "quietTimer",
                        input: resourceInput(VOICE_RESOURCE.QUIET_TIMER),
                      },
                      on: {
                        [VOICE_MACHINE_EVENT.REPLY_SETTLED]: "#voiceLifecycle.introduction.ready",
                      },
                    },
                  },
                },
                responding: {
                  invoke: {
                    id: VOICE_RESOURCE.QUIET_TIMER,
                    src: "quietTimer",
                    input: resourceInput(VOICE_RESOURCE.QUIET_TIMER),
                  },
                  on: {
                    [VOICE_MACHINE_EVENT.REPLY_SETTLED]: "ready",
                  },
                },
              },
            },
          },
        },
        microphone: {
          id: "voiceMicrophone",
          initial: "unknown",
          states: {
            unknown: {
              on: {
                [VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED]: [
                  {
                    guard: ({ event }) => event.permission === VOICE_MICROPHONE_PERMISSION.GRANTED,
                    target: "granted",
                  },
                  { target: "denied" },
                ],
              },
            },
            denied: {
              on: {
                [VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED]: {
                  guard: ({ event }) => event.permission === VOICE_MICROPHONE_PERMISSION.GRANTED,
                  target: "granted",
                },
              },
            },
            granted: {
              on: {
                [VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED]: {
                  guard: ({ event }) => event.permission !== VOICE_MICROPHONE_PERMISSION.GRANTED,
                  target: "denied",
                },
              },
            },
          },
        },
        notices: {
          id: "voiceNotices",
          initial: "released",
          states: {
            released: {
              on: {
                [VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED]: {
                  guard: ({ event }) => event.active,
                  target: "held",
                  actions: sendTo(VOICE_RESOURCE.NOTICE_HOLD_QUEUE, ({ event }) => event),
                },
              },
            },
            held: {
              on: {
                [VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED]: {
                  guard: ({ event }) => !event.active,
                  target: "released",
                  actions: sendTo(VOICE_RESOURCE.NOTICE_HOLD_QUEUE, ({ event }) => event),
                },
              },
            },
          },
        },
        output: {
          id: "voiceOutput",
          initial: "audible",
          states: {
            audible: {
              on: {
                [VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED]: {
                  guard: ({ event }) => event.silent,
                  target: "silent",
                },
              },
            },
            silent: {
              on: {
                [VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED]: {
                  guard: ({ event }) => !event.silent,
                  target: "audible",
                },
              },
            },
          },
        },
        restart: {
          id: "voiceRestart",
          initial: "none",
          states: {
            none: {
              on: {
                [VOICE_MACHINE_EVENT.VOICE_CHANGED]: {
                  guard: ({ event }) => event.live,
                  target: "wait",
                },
              },
            },
            wait: {
              on: {
                [VOICE_MACHINE_EVENT.REPLY_SETTLED]: "restart",
                [VOICE_MACHINE_EVENT.CALL_CLOSED]: "drop",
                [VOICE_MACHINE_EVENT.CALL_FAILED]: "drop",
                [VOICE_MACHINE_EVENT.QUOTA_SPENT]: "drop",
              },
            },
            drop: {
              entry: "reportRestartDrop",
              always: "none",
            },
            restart: {
              entry: "reportRestart",
              always: "none",
            },
          },
        },
      },
    },
  },
});

export type VoiceMachineSnapshot = SnapshotFrom<typeof voiceMachine>;

export function selectRealtimeStatus(snapshot: VoiceMachineSnapshot): RealtimeStatus {
  if (snapshot.matches({ ordinary: { lifecycle: "unavailable" } })) {
    return REALTIME_STATUS.UNAVAILABLE;
  }
  if (snapshot.matches({ ordinary: { lifecycle: "failed" } })) return REALTIME_STATUS.FAILED;
  if (
    snapshot.matches({ ordinary: { lifecycle: { developerCall: "typedConnecting" } } }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "connectingHeld" } } },
    }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "connectingLatched" } } },
    }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "connectingReleased" } } },
    }) ||
    snapshot.matches({ ordinary: { lifecycle: { speakOnlyCall: "connecting" } } }) ||
    snapshot.matches({ ordinary: { lifecycle: { introduction: "connecting" } } })
  ) {
    return REALTIME_STATUS.CONNECTING;
  }
  if (
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "listeningHeld" } } },
    }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "listeningLatched" } } },
    }) ||
    snapshot.matches({
      ordinary: { lifecycle: { introduction: { practice: "listening" } } },
    })
  ) {
    return REALTIME_STATUS.LISTENING;
  }
  if (
    snapshot.matches({ ordinary: { lifecycle: { developerCall: "typedResponding" } } }) ||
    snapshot.matches({ ordinary: { lifecycle: { developerCall: "lukeResponding" } } }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "responding" } } },
    }) ||
    snapshot.matches({ ordinary: { lifecycle: { speakOnlyCall: "responding" } } }) ||
    snapshot.matches({
      ordinary: { lifecycle: { introduction: { practice: "responding" } } },
    }) ||
    snapshot.matches({ ordinary: { lifecycle: { introduction: "responding" } } })
  ) {
    return REALTIME_STATUS.RESPONDING;
  }
  if (
    snapshot.matches({ ordinary: { lifecycle: { developerCall: "ready" } } }) ||
    snapshot.matches({ ordinary: { lifecycle: { speakOnlyCall: "ready" } } }) ||
    snapshot.matches({ ordinary: { lifecycle: { introduction: "ready" } } })
  ) {
    return REALTIME_STATUS.READY;
  }
  return REALTIME_STATUS.IDLE;
}

export function selectToolsAllowed(snapshot: VoiceMachineSnapshot): boolean {
  return (
    snapshot.context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_SPOKEN ||
    snapshot.context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_TYPED
  );
}

export function selectDuckActive(snapshot: VoiceMachineSnapshot): boolean {
  if (snapshot.matches({ ordinary: { lifecycle: "introduction" } })) return false;
  const status = selectRealtimeStatus(snapshot);
  return (
    status === REALTIME_STATUS.CONNECTING ||
    status === REALTIME_STATUS.LISTENING ||
    status === REALTIME_STATUS.RESPONDING
  );
}

export function selectForcedCaptions(snapshot: VoiceMachineSnapshot): boolean {
  return (
    snapshot.matches({ ordinary: { output: "silent" } }) ||
    snapshot.context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_TYPED
  );
}

export function selectVoiceRestart(snapshot: VoiceMachineSnapshot): VoiceRestart {
  if (snapshot.matches({ ordinary: { restart: "wait" } })) return VOICE_RESTART.WAIT;
  if (snapshot.matches({ ordinary: { restart: "drop" } })) return VOICE_RESTART.DROP;
  if (snapshot.matches({ ordinary: { restart: "restart" } })) return VOICE_RESTART.RESTART;
  return VOICE_RESTART.NONE;
}

export function selectTalkOpening(snapshot: VoiceMachineSnapshot): boolean {
  return (
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "connectingHeld" } } },
    }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "connectingLatched" } } },
    }) ||
    snapshot.matches({
      ordinary: { lifecycle: { developerCall: { spoken: "connectingReleased" } } },
    })
  );
}

export function selectExchangeKind(snapshot: VoiceMachineSnapshot): VoiceExchangeKind | undefined {
  if (!selectDuckActive(snapshot)) return undefined;
  if (snapshot.context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_TYPED) {
    return VOICE_EXCHANGE_KIND.TYPED;
  }
  if (snapshot.context.turnOrigin === VOICE_TURN_ORIGIN.DEVELOPER_SPOKEN) {
    return VOICE_EXCHANGE_KIND.SPOKEN;
  }
  return VOICE_EXCHANGE_KIND.ANNOUNCEMENT;
}
