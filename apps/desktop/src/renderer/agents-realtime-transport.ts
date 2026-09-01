import {
  OpenAIRealtimeBase,
  type RealtimeClientMessage,
  type RealtimeSessionConfig,
  type RealtimeTransportLayerConnectOptions,
  type TransportToolCallEvent,
} from "@openai/agents-realtime";
import { isRecord, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

export interface AgentsRealtimeTransportOptions {
  send(event: WireRecord): void;
  interrupt(): void;
  mute(muted: boolean): void;
  muted(): boolean | null;
}

export class AgentsRealtimeTransport extends OpenAIRealtimeBase {
  readonly #options: AgentsRealtimeTransportOptions;
  #status: "connected" | "disconnected" | "connecting" | "disconnecting" = "disconnected";

  constructor(options: AgentsRealtimeTransportOptions) {
    super();
    this.#options = options;
  }

  get status() {
    return this.#status;
  }

  get muted() {
    return this.#options.muted();
  }

  async connect(options: RealtimeTransportLayerConnectOptions): Promise<void> {
    if (this.#status === "connected") return;
    this.#status = "connecting";
    if (options.model) this.currentModel = options.model;
    this.#status = "connected";
    this._onOpen();
    if (options.initialSessionConfig) {
      this.updateSessionConfig(options.initialSessionConfig);
    }
  }

  sendEvent(event: RealtimeClientMessage): void {
    this.#options.send(event as WireRecord);
  }

  mute(muted: boolean): void {
    this.#options.mute(muted);
  }

  interrupt(): void {
    this.#options.interrupt();
  }

  close(): void {
    if (this.#status === "disconnected") return;
    this.#status = "disconnecting";
    this.#status = "disconnected";
    this._onClose();
  }

  receive(event: WireRecord): void {
    if (this.#status !== "connected") return;
    this._onMessage({ data: JSON.stringify(event) } as MessageEvent<string>);
  }

  receiveFunctionCall(call: TransportToolCallEvent): void {
    if (this.#status !== "connected") return;
    this.emit("function_call", call);
  }

  override updateSessionConfig(config: Partial<RealtimeSessionConfig>): void {
    const source = config as {
      instructions?: string;
      tools?: unknown[];
      toolChoice?: unknown;
      tracing?: unknown;
    };
    const parsed: UnparsedWireValue = JSON.parse(
      JSON.stringify({
        type: "realtime",
        ...(source.instructions !== undefined ? { instructions: source.instructions } : undefined),
        ...(source.tools !== undefined ? { tools: source.tools } : undefined),
        ...(source.toolChoice !== undefined ? { tool_choice: source.toolChoice } : undefined),
        ...(source.tracing !== undefined ? { tracing: source.tracing } : undefined),
      }),
    );
    if (isRecord(parsed)) this.#options.send({ type: "session.update", session: parsed });
  }

  updateWithoutTools(config: Partial<RealtimeSessionConfig> = {}): void {
    this.updateSessionConfig({
      ...config,
      tools: [],
      toolChoice: "none",
    });
  }
}
