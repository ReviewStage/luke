import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_MINT_OUTCOME, VOICE_LIST_OUTCOME } from "@sidecar/speech";
import type { IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { SpeechTokenAnswer, SpeechVoicesAnswer } from "#shared/contracts";
import type { PanelManager } from "../window/panel-manager";
import { registerVoiceRuntimeIpc, type VoiceRuntimeIpcDependencies } from "./voice-runtime";

const SPEECH_KEY = "sk_elevenlabs_secret";

/** The two answers these tests invoke for; the module's other handlers stay unread. */
type SpeechAnswer = SpeechVoicesAnswer | SpeechTokenAnswer;

type RecordedHandler = (event: IpcMainInvokeEvent) => Promise<SpeechAnswer>;

function fakeIpcMain() {
  const handlers = new Map<string, RecordedHandler>();
  return {
    handlers,
    ipcMain: {
      handle(channel: string, handler: RecordedHandler) {
        handlers.set(channel, handler);
      },
      on() {
        // The speech reads are invokes; the sends this module also registers
        // are not what these tests exercise.
      },
    },
  };
}

function register(
  overrides: {
    apiKey?: string | undefined;
    reachesNetwork?: boolean;
    fetch?: VoiceRuntimeIpcDependencies["fetch"];
  } = {},
) {
  const { handlers, ipcMain } = fakeIpcMain();
  const opened: string[] = [];
  registerVoiceRuntimeIpc({
    // SAFETY: The recorder answers `handle` and `on`, which is the whole of the
    // IpcMain surface this module uses.
    ipcMain: ipcMain as unknown as VoiceRuntimeIpcDependencies["ipcMain"],
    trustedSender: () => true,
    // SAFETY: These tests exercise the speech handlers alone, which reach for
    // none of the panel surface the other handlers use.
    panels: {} as PanelManager,
    openExternal: async (url) => {
      opened.push(url);
    },
    chooseRealtimeCredentials: () => undefined,
    unavailableDiagnostics: () => {
      throw new Error("not exercised");
    },
    hostedUsageReader: () => undefined,
    recordProductEvent: () => undefined,
    recordAgentTrace: () => undefined,
    readSpeechApiKey: async () => ("apiKey" in overrides ? overrides.apiKey : SPEECH_KEY),
    speechReachesNetwork: () => overrides.reachesNetwork ?? true,
    ...(overrides.fetch ? { fetch: overrides.fetch } : undefined),
  });
  const invoke = async (channel: string): Promise<SpeechAnswer> => {
    const handler = handlers.get(channel);
    assert.ok(handler, channel);
    // SAFETY: The speech handlers read nothing off the invoke event; the bridge
    // reads the sender, and `trustedSender` above already answered for it.
    return handler({} as IpcMainInvokeEvent);
  };
  return { invoke, opened };
}

test("the long-lived key authenticates the reads and never crosses the bridge", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const { invoke } = register({
    fetch: async (url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify(
          url.includes("single-use-token")
            ? { token: "single-use" }
            : { voices: [{ voice_id: "v1", name: "Ada" }] },
        ),
        { status: 200 },
      );
    },
  });

  const voices = await invoke(BRIDGE.listSpeechVoices.channel);
  const token = await invoke(BRIDGE.mintSpeechToken.channel);

  // The key was used, in the header ElevenLabs documents and nowhere else.
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(new Headers(request.init.headers).get("xi-api-key"), SPEECH_KEY);
    assert.equal(request.url.includes(SPEECH_KEY), false);
  }
  // And nothing that came back carries it.
  assert.equal(JSON.stringify(voices).includes(SPEECH_KEY), false);
  assert.equal(JSON.stringify(token).includes(SPEECH_KEY), false);
  assert.deepEqual(voices, {
    outcome: VOICE_LIST_OUTCOME.OK,
    voices: [{ id: "v1", name: "Ada" }],
  });
  assert.deepEqual(token, { outcome: TOKEN_MINT_OUTCOME.OK, token: "single-use" });
});

test("no key connected reads nothing and mints nothing", async () => {
  let asked = false;
  const { invoke } = register({
    apiKey: undefined,
    fetch: async () => {
      asked = true;
      return new Response("{}", { status: 200 });
    },
  });

  assert.deepEqual(await invoke(BRIDGE.listSpeechVoices.channel), {
    outcome: VOICE_LIST_OUTCOME.UNAUTHORIZED,
    voices: [],
    explanation: "No ElevenLabs key is connected, so there are no voices to read.",
  });
  assert.deepEqual(await invoke(BRIDGE.mintSpeechToken.channel), {
    outcome: TOKEN_MINT_OUTCOME.UNAUTHORIZED,
    explanation: "No ElevenLabs key is connected, so Luke cannot speak through it.",
  });
  assert.equal(asked, false);
});

test("a run that reaches no network never reads the key at all", async () => {
  let asked = false;
  const { invoke } = register({
    reachesNetwork: false,
    fetch: async () => {
      asked = true;
      return new Response("{}", { status: 200 });
    },
  });

  const voices = await invoke(BRIDGE.listSpeechVoices.channel);
  assert.deepEqual(voices, {
    outcome: VOICE_LIST_OUTCOME.UNAUTHORIZED,
    voices: [],
    explanation: "No ElevenLabs key is connected, so there are no voices to read.",
  });
  assert.equal(asked, false);
});

test("a failed read answers with its own sentence and an empty list", async () => {
  const { invoke } = register({ fetch: async () => new Response("", { status: 401 }) });
  const voices = await invoke(BRIDGE.listSpeechVoices.channel);
  assert.deepEqual(voices, {
    outcome: VOICE_LIST_OUTCOME.UNAUTHORIZED,
    voices: [],
    explanation:
      "ElevenLabs refused the key. It may have been revoked, or it may not carry the Voices read permission.",
  });
});
