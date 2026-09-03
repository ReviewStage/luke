import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionProvider,
} from "@sidecar/session";
import { isRecord, isWireBoolean, isWireString, type WireValue } from "@sidecar/wire";

export const DEV_HARNESS_SESSION_COMMAND = {
  WAITING: "waiting",
  ERROR: "error",
  FINISHED: "finished",
} as const;

export type DevHarnessSessionCommand =
  (typeof DEV_HARNESS_SESSION_COMMAND)[keyof typeof DEV_HARNESS_SESSION_COMMAND];

export interface DevHarnessOptions {
  socketPath: string;
  /** Called after the synthetic session observation is updated. */
  onSessionChanged(): void;
  /**
   * Called when a capture override command arrives. The caller wires this to
   * whatever gate reads the capture state — on the main branch a log is
   * enough; on a branch with the call-quiet gate, wire it to
   * `CallQuietGate.setCapturing`.
   */
  onCaptureCommand(on: boolean): void;
}

/** Synthetic provider used exclusively by the dev harness. */
const DEV_PROVIDER: SessionProvider = {
  id: "dev-harness",
  displayName: "Dev Harness",
};

const DEV_SESSION_ID = "dev-session";

type DevHarnessAdapter = Pick<
  { provider: SessionProvider; observe(): Promise<readonly ProviderSessionObservation[]> },
  "provider" | "observe"
>;

interface HarnessReply {
  ok: boolean;
  error?: string;
}

/**
 * Dev-only control channel, gated the same way as {@link AgentTraceWriter}:
 * only an unpackaged live run constructs one. A Unix socket at `socketPath`
 * accepts JSON commands and calls injected callbacks so real announcement
 * paths can be exercised without a live provider session.
 *
 * Commands (newline-terminated JSON, one per connection):
 *   `{"cmd":"session","status":"waiting"|"error"|"finished"}`
 *   `{"cmd":"capture","on":true|false}`
 *
 * Each command receives a `{"ok":true}` or `{"ok":false,"error":"..."}` reply.
 */
export class DevHarness {
  #observation: ProviderSessionObservation | undefined;
  #server: net.Server | undefined;
  readonly #options: DevHarnessOptions;

  constructor(options: DevHarnessOptions) {
    this.#options = options;
  }

  /** The synthetic adapter to pass to `sessionRegistry.refresh`. */
  readonly adapter: DevHarnessAdapter = {
    provider: DEV_PROVIDER,
    observe: async () => (this.#observation ? [this.#observation] : []),
  };

  /**
   * Binds the socket and prints its path to stderr. Any socket file left from
   * a previous run is removed first so bind does not fail on a stale path.
   */
  start(): void {
    const { socketPath } = this.#options;
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // No leftover socket to remove.
    }
    const server = net.createServer((socket) => this.#onConnection(socket));
    server.listen(socketPath, () => {
      process.stderr.write(`Dev harness: ${socketPath}\n`);
    });
    this.#server = server;
  }

  stop(): void {
    this.#server?.close();
    this.#server = undefined;
    try {
      fs.unlinkSync(this.#options.socketPath);
    } catch {
      // Already removed.
    }
  }

  #onConnection(socket: net.Socket): void {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      this.#handleCommand(line, socket);
    });
  }

  #handleCommand(line: string, socket: net.Socket): void {
    let raw: WireValue | undefined;
    try {
      // SAFETY: JSON.parse returns a runtime value; isRecord validates the contract below.
      raw = JSON.parse(line) as WireValue;
    } catch {
      this.#reply(socket, { ok: false, error: "invalid JSON" });
      return;
    }
    if (!isRecord(raw)) {
      this.#reply(socket, { ok: false, error: "missing cmd" });
      return;
    }
    const cmd = raw.cmd;
    if (cmd === "session") {
      this.#reply(socket, this.#applySession(raw.status));
      return;
    }
    if (cmd === "capture") {
      if (!isWireBoolean(raw.on)) {
        this.#reply(socket, { ok: false, error: "capture.on must be a boolean" });
        return;
      }
      this.#options.onCaptureCommand(raw.on);
      this.#reply(socket, { ok: true });
      return;
    }
    this.#reply(socket, {
      ok: false,
      error: `unknown cmd: ${isWireString(cmd) ? cmd : String(cmd)}`,
    });
  }

  #reply(socket: net.Socket, payload: HarnessReply): void {
    socket.write(`${JSON.stringify(payload)}\n`);
    socket.end();
  }

  #applySession(status: WireValue | undefined): HarnessReply {
    const now = Date.now();
    if (status === DEV_HARNESS_SESSION_COMMAND.WAITING) {
      this.#observation = {
        providerSessionId: DEV_SESSION_ID,
        title: "Dev session",
        status: SESSION_STATUS.WAITING,
        observedAt: now,
        holdingForDeveloper: true,
      };
    } else if (status === DEV_HARNESS_SESSION_COMMAND.ERROR) {
      this.#observation = {
        providerSessionId: DEV_SESSION_ID,
        title: "Dev session",
        status: SESSION_STATUS.ERROR,
        observedAt: now,
      };
    } else if (status === DEV_HARNESS_SESSION_COMMAND.FINISHED) {
      this.#observation = {
        providerSessionId: DEV_SESSION_ID,
        title: "Dev session",
        status: SESSION_STATUS.COMPLETE,
        completionCause: SESSION_COMPLETION_CAUSE.WORK_FINISHED,
        observedAt: now,
      };
    } else {
      return {
        ok: false,
        error: `unknown session status: ${isWireString(status) ? status : String(status)}; use waiting, error, or finished`,
      };
    }
    this.#options.onSessionChanged();
    return { ok: true };
  }
}
