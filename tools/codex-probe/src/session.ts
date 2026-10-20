/**
 * session.ts -- one `codex app-server` process in the sandbox, spoken to over the Sandbox API: requests written to its stdin, its stdout read as messages in order, every message both ways recorded.
 *
 * The session is a single reader: whoever waits on it pulls the next
 * message off the command's log stream, so nothing races and nothing needs a
 * timer of its own; one deadline signal bounds every read. A request the
 * app-server makes of the client (an approval, under `approval_policy =
 * "never"` never expected) is refused at once so a turn cannot hang on it.
 * The app-server's stderr is kept apart and never recorded, since Codex's
 * own logs are not part of the protocol P20 and P22 read.
 */

import { valueFromJsonText, type WireValue } from "@luke/wire";
import type { Command } from "@vercel/sandbox";
import {
  type ClientMessage,
  encodeMessage,
  LineSplitter,
  readServerLine,
  type ServerMessage,
} from "./app-server.js";
import type { RecordedMessage } from "./checks.js";

/** A response the app-server answered with an error, its words safe to print. */
class AppServerError extends Error {}

/** A message that is a response, narrowed. */
type Response = Extract<ServerMessage, { kind: "response" }>;

export class AppServerSession {
  private readonly lines = new LineSplitter();
  private readonly buffered: ServerMessage[] = [];
  private readonly logs: AsyncGenerator<{ stream: "stdout" | "stderr"; data: string }, void, void>;
  private nextId = 1;
  /** The tail of what the app-server wrote to stderr, for a failure's detail. */
  stderrTail = "";

  constructor(
    readonly command: Command,
    private readonly phase: string,
    private readonly recorded: RecordedMessage[],
    signal: AbortSignal,
  ) {
    this.logs = command.logs({ signal });
  }

  /** One message written to the app-server and recorded. */
  async send(message: ClientMessage): Promise<void> {
    // SAFETY: a ClientMessage is built of wire values alone (numbers, strings, records of them).
    this.recorded.push({ phase: this.phase, direction: "client", message: message as WireValue });
    await this.command.writeStdin(encodeMessage(message));
  }

  /** The next message the app-server wrote, recorded; a request of its own is refused on the way. */
  async next(): Promise<ServerMessage> {
    for (;;) {
      const queued = this.buffered.shift();
      if (queued !== undefined) return queued;
      const chunk = await this.logs.next();
      if (chunk.done === true)
        throw new AppServerError(`app-server exited: ${this.stderrTail.slice(-400)}`);
      if (chunk.value.stream === "stderr") {
        this.stderrTail = (this.stderrTail + chunk.value.data).slice(-4000);
        continue;
      }
      for (const line of this.lines.push(chunk.value.data)) {
        const message = readServerLine(line);
        if (message.kind === "unreadable") continue;
        this.recorded.push({
          phase: this.phase,
          direction: "server",
          message: valueFromJsonText(line),
        });
        if (message.kind === "request") {
          await this.send({
            id: message.id,
            error: { code: -32601, message: "declined by Luke's probe" },
          });
          continue;
        }
        this.buffered.push(message);
      }
    }
  }

  /** Reads on until a message satisfies the predicate, and answers it. */
  async until(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    for (;;) {
      const message = await this.next();
      if (predicate(message)) return message;
    }
  }

  /** A request sent, and its response awaited; an error response throws with the app-server's words. */
  async request(method: string, params: WireValue): Promise<Response> {
    const id = this.nextId++;
    await this.send({ id, method, params });
    const answer = await this.until((message) => message.kind === "response" && message.id === id);
    // SAFETY: the predicate above admits only a response.
    const response = answer as Response;
    if (response.error !== undefined) {
      throw new AppServerError(`${method}: ${JSON.stringify(response.error).slice(0, 300)}`);
    }
    return response;
  }

  /** A notification sent, which the app-server answers nothing. */
  notify(method: string): Promise<void> {
    return this.send({ method });
  }

  /** The process ended: its stdin closed and the process killed, the log stream closed. */
  async close(): Promise<void> {
    await this.command.closeStdin().catch(() => undefined);
    await this.command.kill("SIGTERM").catch(() => undefined);
    await this.logs.return(undefined);
  }
}
