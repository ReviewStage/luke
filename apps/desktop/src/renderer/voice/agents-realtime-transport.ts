import {
  backgroundResult,
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  type RealtimeClientMessage,
  RealtimeSession,
  type RealtimeSessionConfig,
  type RealtimeTransportLayer,
  type TransportError,
  type TransportEvent,
  type TransportToolCallEvent,
  tool,
} from "@openai/agents-realtime";
import type { realtimeSessionConfig } from "@sidecar/realtime";
import { isRecord, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

export type BuiltRealtimeSessionConfig = ReturnType<typeof realtimeSessionConfig>;

export interface SdkToolCallDetails {
  toolCall?: {
    type?: string;
    callId?: string;
    name?: string;
    arguments?: string;
  };
}

export interface SdkRealtimeTransport {
  readonly status: "connecting" | "connected" | "disconnected" | "disconnecting";
  connect(options: { apiKey: string; model: string; url: string }): Promise<void>;
  sendEvent(event: WireRecord): void;
  sendMessage(message: string): void;
  close(): void;
}

export interface SdkTransportFactoryOptions {
  sessionConfig: BuiltRealtimeSessionConfig;
  audioElement: HTMLAudioElement | undefined;
  onPeerConnection(peer: RTCPeerConnection, silenceTrack: MediaStreamTrack): void;
  onTransportEvent(event: UnparsedWireValue): void;
  onClientEvent(event: WireRecord): void;
  onToolOutputSent(callId: string): void;
  onConnectionChange(status: SdkRealtimeTransport["status"]): void;
  onError(message: string): void;
  executeTool(name: string, details: SdkToolCallDetails | undefined): Promise<WireRecord>;
}

export type SdkTransportFactory = (options: SdkTransportFactoryOptions) => SdkRealtimeTransport;

interface SdkErrorRecord {
  readonly type?: TransportError["error"];
  readonly error?: TransportError["error"];
  readonly message?: TransportError["error"];
}

function sdkErrorRecord(value: TransportError["error"]): SdkErrorRecord | undefined {
  if (value === null || value === undefined) return undefined;
  if (Object.prototype.toString.call(value) !== "[object Object]") return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  // SAFETY: The runtime checks establish a plain object whose fields remain untrusted below.
  return value as SdkErrorRecord;
}

function sdkErrorText(value: TransportError["error"]): string | undefined {
  if (Object.prototype.toString.call(value) !== "[object String]") return undefined;
  // SAFETY: The runtime tag above establishes a string before its content is normalized.
  const normalized = (value as string).trim();
  return normalized || undefined;
}

export function agentsRealtimeErrorMessage(error: TransportError["error"]): string {
  try {
    if (error instanceof Error) return error.message;
    const record = sdkErrorRecord(error);
    if (record) {
      const nested = sdkErrorRecord(record.error);
      return sdkErrorText(nested?.message) ?? sdkErrorText(record.message) ?? String(error);
    }
    return String(error);
  } catch {
    return "The voice connection failed.";
  }
}

function sdkSessionConfig(config: BuiltRealtimeSessionConfig): Partial<RealtimeSessionConfig> {
  return {
    model: config.model,
    reasoning: config.reasoning,
    instructions: config.instructions,
    toolChoice: config.tool_choice,
    outputModalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: config.audio.input.format.rate },
        transcription: config.audio.input.transcription,
        turnDetection: config.audio.input.turn_detection,
      },
      output: {
        voice: config.audio.output.voice,
        speed: config.audio.output.speed,
      },
    },
    providerData: { truncation: config.truncation },
  };
}

class LukeRealtimeWebRTC extends OpenAIRealtimeWebRTC {
  readonly #onClientEvent: (event: WireRecord) => void;
  readonly #onToolOutputSent: (callId: string) => void;

  constructor(
    options: ConstructorParameters<typeof OpenAIRealtimeWebRTC>[0],
    onClientEvent: (event: WireRecord) => void,
    onToolOutputSent: (callId: string) => void,
  ) {
    super(options);
    this.#onClientEvent = onClientEvent;
    this.#onToolOutputSent = onToolOutputSent;
  }

  override sendEvent(event: RealtimeClientMessage): void {
    super.sendEvent(event);
    if (isRecord(event)) this.#onClientEvent(event);
  }

  override sendFunctionCallOutput(
    toolCall: TransportToolCallEvent,
    output: string,
    startResponse = true,
  ): void {
    super.sendFunctionCallOutput(toolCall, output, startResponse);
    this.#onToolOutputSent(toolCall.callId);
  }
}

/**
 * Owns the Agents SDK objects and the browser resources created solely for
 * their WebRTC transport. Tests may supply the SDK's scripted transport; the
 * production path creates the real WebRTC transport and its silent sender.
 */
export function createAgentsRealtimeTransport(
  options: SdkTransportFactoryOptions,
  injectedTransport?: RealtimeTransportLayer,
): SdkRealtimeTransport {
  const report = (error: TransportError["error"]): void => {
    try {
      options.onError(agentsRealtimeErrorMessage(error));
    } catch {
      // Closing a call must not be defeated by an error reporter.
    }
  };

  let releaseOwnedResources: (() => void) | undefined;
  const transport =
    injectedTransport ??
    (() => {
      const silenceContext = new AudioContext();
      const silenceStream = silenceContext.createMediaStreamDestination().stream;
      const [silenceTrack] = silenceStream.getAudioTracks();
      if (!silenceTrack) {
        try {
          void silenceContext.close().catch(report);
        } catch (error) {
          report(error);
        }
        throw new Error("Could not create a silent audio track.");
      }
      releaseOwnedResources = () => {
        let tracks: readonly MediaStreamTrack[] = [];
        try {
          tracks = silenceStream.getTracks();
        } catch (error) {
          report(error);
        }
        for (const track of tracks) {
          try {
            track.stop();
          } catch (error) {
            report(error);
          }
        }
        try {
          void silenceContext.close().catch(report);
        } catch (error) {
          report(error);
        }
      };
      return new LukeRealtimeWebRTC(
        {
          mediaStream: silenceStream,
          audioElement: options.audioElement,
          changePeerConnection: (peer) => {
            options.onPeerConnection(peer, silenceTrack);
            return peer;
          },
        },
        options.onClientEvent,
        options.onToolOutputSent,
      );
    })();

  const tools = options.sessionConfig.tools.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      parameters: {
        ...definition.parameters,
        required: [...definition.parameters.required],
        // Omission means true in JSON Schema; spelling it lets the SDK keep
        // the build's non-strict validation behavior without widening it.
        additionalProperties: true as const,
      },
      strict: false,
      execute: async (_input, _context, details) =>
        backgroundResult(await options.executeTool(definition.name, details)),
    }),
  );
  const agent = new RealtimeAgent({
    name: "Luke",
    instructions: options.sessionConfig.instructions,
    voice: options.sessionConfig.audio.output.voice,
    tools,
  });
  const session = new RealtimeSession(agent, {
    transport,
    model: options.sessionConfig.model,
    config: sdkSessionConfig(options.sessionConfig),
    tracingDisabled: true,
  });
  session.on("transport_event", (event: TransportEvent) => {
    const wireEvent: UnparsedWireValue = JSON.parse(JSON.stringify(event));
    options.onTransportEvent(wireEvent);
  });
  session.on("error", ({ error }) => {
    // A server `error` event also arrives as a transport event, where the
    // session decides which ones are its own business and never shown.
    // Reporting it here as well would draw a fault for every one of those.
    if (sdkErrorRecord(error)?.type === "error") return;
    report(error);
  });
  transport.on("connection_change", options.onConnectionChange);

  let closed = false;
  return {
    get status() {
      return transport.status;
    },
    connect: (connection) => session.connect(connection),
    sendEvent: (event) => {
      const type = text(event.type);
      if (type) transport.sendEvent({ ...event, type });
    },
    sendMessage: (message) => session.sendMessage(message),
    close: () => {
      if (closed) return;
      closed = true;
      try {
        session.close();
      } catch (error) {
        report(error);
      } finally {
        releaseOwnedResources?.();
      }
    },
  };
}
