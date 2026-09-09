import assert from "node:assert/strict";
import test from "node:test";
import type { RealtimeConnection } from "@sidecar/hosted";
import {
  ARRIVAL_SPEECH_KIND,
  ASK_BRAIN_TOOL,
  BRIEFING_SPEECH_KIND,
  type BriefingSpeech,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  realtimeSessionConfig,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS, isRecord, type WireRecord } from "@sidecar/wire";
import type { JsonValue, ParsedJsonObject } from "@sidecar/wire/testing";
import {
  asMediaTrack,
  asPeerConnection,
  type MockMediaTrack,
  type MockPeerConnection,
} from "#testing/realtime-fixtures";
import type { SdkRealtimeTransport, SdkTransportFactoryOptions } from "./agents-realtime-transport";
import {
  REPLY_KIND,
  type ReplyKind,
  SPEAK_ONLY_SESSION_CONFIG,
  SpeakOnlyCall,
} from "./speak-only-call";

const CONNECTION: RealtimeConnection = {
  value: "ek_test_secret",
  expiresAt: 1_800_000_060_000,
  model: "gpt-realtime-2.1",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
};

interface Harness {
  call: SpeakOnlyCall;
  /** Every event the call sent over the channel, in order. */
  sent: ParsedJsonObject[];
  /** Each caption emission: one text per stacked response, or a clear. */
  captions: (readonly string[] | undefined)[];
  /** The words each ended reply left behind, with its kind. */
  replyEndings: { texts: readonly string[]; kind: ReplyKind | undefined }[];
  /** Every track handed to the negotiated sender, which a speak-only call never touches. */
  replacedTracks: (MockMediaTrack | null)[];
  /** The session document the SDK transport was built with. */
  sessionConfig: () => SdkTransportFactoryOptions["sessionConfig"];
  /** The SDK's tool bridge, as the service would reach it. */
  executeTool: (name: string) => Promise<WireRecord>;
  emit: (event: JsonValue) => void;
  closeChannel: () => void;
}

function harness(): Harness {
  const sent: ParsedJsonObject[] = [];
  const captions: (readonly string[] | undefined)[] = [];
  const replyEndings: { texts: readonly string[]; kind: ReplyKind | undefined }[] = [];
  const replacedTracks: (MockMediaTrack | null)[] = [];
  const silenceTrack: MockMediaTrack = { kind: "audio" };
  const peer: MockPeerConnection = {
    connectionState: "connected",
    getSenders: () => [
      {
        track: silenceTrack,
        replaceTrack: async (next: MockMediaTrack | null) => {
          replacedTracks.push(next);
        },
      },
    ],
    addEventListener: () => undefined,
  };
  let sdkOptions: SdkTransportFactoryOptions | undefined;
  let sdkStatus: SdkRealtimeTransport["status"] = "disconnected";

  const call = new SpeakOnlyCall({
    requestConnection: async () => CONNECTION,
    createSdkTransport: (options) => {
      sdkOptions = options;
      return {
        get status() {
          return sdkStatus;
        },
        connect: async () => {
          sdkStatus = "connecting";
          // SAFETY: Fixture values match the narrowed runtime shapes this call reads.
          options.onPeerConnection(asPeerConnection(peer), asMediaTrack(silenceTrack));
          sdkStatus = "connected";
          options.onConnectionChange(sdkStatus);
        },
        sendEvent: (event) => sent.push(JSON.parse(JSON.stringify(event))),
        sendMessage: () => undefined,
        close: () => {
          sdkStatus = "disconnected";
          options.onConnectionChange(sdkStatus);
        },
      };
    },
    onStatus: () => undefined,
    onRemoteStream: () => undefined,
    onError: () => undefined,
    onCaption: (texts) => captions.push(texts),
    onReplyEnded: (texts, kind) => replyEndings.push({ texts, kind }),
  });

  return {
    call,
    sent,
    captions,
    replyEndings,
    replacedTracks,
    sessionConfig: () => {
      const config = sdkOptions?.sessionConfig;
      assert.ok(config, "the call built no SDK transport");
      return config;
    },
    executeTool: (name) => {
      assert.ok(sdkOptions, "the call built no SDK transport");
      return sdkOptions.executeTool(name, {
        toolCall: { type: "function_call", callId: "call-1", name, arguments: "{}" },
      });
    },
    emit: (event) => sdkOptions?.onTransportEvent(JSON.parse(JSON.stringify(event))),
    closeChannel: () => {
      sdkStatus = "disconnected";
      sdkOptions?.onConnectionChange(sdkStatus);
    },
  };
}

function settleReply(context: Harness): void {
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
}

/** One briefing the brain decided, worded about one session, decided a moment ago. */
function briefingAbout(id: string, briefing = `Claude Code finished ${id}.`): BriefingSpeech {
  return { kind: BRIEFING_SPEECH_KIND, briefing, decidedAt: Date.now() };
}

test("a speak-only call declares no tools", async () => {
  const context = harness();
  await context.call.connect();

  // The whole of "carries no tools": the document the call is configured with
  // declares an empty list, and the choice cannot pick from it. There is no
  // other document this class can be built with.
  assert.deepEqual(context.sessionConfig().tools, []);
  assert.equal(context.sessionConfig().tool_choice, "none");
});

test("the speak-only document is the conversation's with its tools taken away", async () => {
  const context = harness();
  await context.call.connect();

  // Everything else about the call — the instructions, the audio format, the
  // voice, the truncation — is the conversation's own, so the narrowing is
  // exactly the tools and nothing quietly beside them.
  assert.deepEqual(context.sessionConfig(), {
    ...realtimeSessionConfig({ model: CONNECTION.model }),
    ...SPEAK_ONLY_SESSION_CONFIG,
  });
});

test("a speak-only call has no way to open the microphone", () => {
  const context = harness();

  // The guarantee is the shape rather than a flag: there is no member here to
  // take a turn with, so no press, no transcription, and no reply to a typed
  // ask can reach a capture device on a call Luke opened for himself.
  for (const member of [
    "beginTurn",
    "endTurn",
    "startListening",
    "stopListening",
    "dropPendingTurn",
    "turnPending",
    "speakReply",
  ]) {
    assert.equal(member in context.call, false, member);
  }
  assert.equal(context.call.microphoneCall, false);
});

test("connecting a speak-only call opens no capture device", async () => {
  const context = harness();

  assert.equal(await context.call.connect(), true);

  assert.equal(context.call.status, REALTIME_STATUS.READY);
  // There is no member here that could ask for the device, so there is no
  // permission to ask for and no indicator to light: the SDK's synthetic
  // silent track is all the sender ever carries.
  assert.deepEqual(context.replacedTracks, []);
  assert.equal(context.call.microphoneCall, false);
});

test("a tool call on a speak-only call is refused before anything can act", async () => {
  const context = harness();
  await context.call.connect();

  // Nothing can reach here — the session declared no tools — so a call that
  // does is malformed and is answered as such rather than performed.
  assert.deepEqual(await context.executeTool(ASK_BRAIN_TOOL.name), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "This call carries no tools.",
  });
});

test("a briefing is read out once the call is open", async () => {
  const context = harness();
  await context.call.connect();
  const sentAfterConnect = context.sent.length;

  assert.equal(context.call.speak(briefingAbout("session-a")), true);

  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  settleReply(context);
  assert.equal(context.call.status, REALTIME_STATUS.READY);
});

test("a briefing's reply hands its kind back with the words", async () => {
  const context = harness();
  await context.call.connect();

  context.call.speak(briefingAbout("session-a", "Claude Code finished checkout-service."));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "Claude Code finished checkout-service.",
  });
  context.call.stopSpeaking();

  // The kind rides along so the caller can record the spoken transcript as a
  // briefing rather than an answer.
  assert.deepEqual(context.replyEndings, [
    {
      texts: ["Claude Code finished checkout-service."],
      kind: REPLY_KIND.BRIEFING,
    },
  ]);
});

test("an onboarding beat hands its words back as plain words", async () => {
  const context = harness();
  await context.call.connect();

  assert.equal(
    context.call.speak({
      kind: ARRIVAL_SPEECH_KIND,
      sessionTitle: "Claude Code: checkout-service",
      talkKeyLabel: "the right Option key",
      decidedAt: Date.now(),
    }),
    true,
  );
  // The beat's turn is opened with no tools.
  const response = context.sent.at(-1)?.response;
  assert.ok(isRecord(response));
  assert.equal(response.tool_choice, "none");
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "You're all set.",
  });
  settleReply(context);
  assert.deepEqual(context.replyEndings, [{ texts: ["You're all set."], kind: undefined }]);

  // The calendar beat keeps the same terms.
  assert.equal(
    context.call.speak({ kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: Date.now() }),
    true,
  );
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Your calendar can quiet me.",
  });
  settleReply(context);
  assert.deepEqual(context.replyEndings.at(-1), {
    texts: ["Your calendar can quiet me."],
    kind: undefined,
  });
});

test("a stop cuts the reply where it stands and opens nothing in its place", async () => {
  const context = harness();
  await context.call.connect();
  context.call.speak(briefingAbout("session-a"));
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "response-1" } });
  const sentBeforeStop = context.sent.length;

  assert.equal(context.call.stopSpeaking(), true);

  // Cancelled and cleared, and nothing asked for over the quiet.
  assert.deepEqual(
    context.sent.slice(sentBeforeStop).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.RESPONSE_CANCEL, REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR],
  );
  assert.equal(context.call.status, REALTIME_STATUS.READY);
  // A stop over silence is not this call's to answer.
  assert.equal(context.call.stopSpeaking(), false);
});

test("a failed briefing delivery leaves no transcript for History", async () => {
  const context = harness();
  await context.call.connect();
  context.call.speak(briefingAbout("session-a", "Checkout finished."));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Checkout finished.",
  });

  context.closeChannel();

  assert.deepEqual(context.replyEndings, []);
  assert.deepEqual(context.captions.at(-1), undefined);
});
