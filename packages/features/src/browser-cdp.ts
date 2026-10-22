/**
 * browser-cdp.ts -- a DevTools protocol session with a browser, as the agent's browser actions drive one: its commands, its events, its page targets, and how a command fails.
 *
 * The session is whatever speaks CDP for a browser: the Chromium in an
 * agent's sandbox, reached over its PTY (`packages/service`'s
 * `agent-browser.ts`). The actions run over it (`browser-agent-cdp.ts`).
 * Nothing a page holds is kept here; it reaches only the caller.
 */

import type { UnparsedWireValue, WireBoundaryInput } from "@luke/wire";
import { Data, type Effect, type Stream } from "effect";

/**
 * How a command failed: the browser refused it, its answer did not come in
 * time or was not what it should be, the connection ended first, or the
 * place the browser stands in would not let it run, which says why itself.
 */
export const CDP_FAILURE = {
  REFUSED: "refused",
  TIMED_OUT: "timed-out",
  MALFORMED: "malformed",
  CLOSED: "closed",
  DENIED: "denied",
} as const;

export type CdpFailureKind = (typeof CDP_FAILURE)[keyof typeof CDP_FAILURE];

/** A command that failed: its method, how, and the browser's own code and words where it refused it. */
export class CdpFailure extends Data.TaggedError("CdpFailure")<{
  readonly kind: CdpFailureKind;
  readonly method: string;
  readonly code?: number;
  readonly detail?: string;
}> {
  override get message(): string {
    return this.detail === undefined
      ? `${this.method} ${this.kind}`
      : `${this.method} ${this.kind}: ${this.detail}`;
  }
}

/** A command's parameters, as JSON carries them. @public */
export type CdpParams = { readonly [key: string]: WireBoundaryInput };

/** One command: its method, its parameters, and the target session it goes to; none for the browser itself. @public */
export interface CdpCommand {
  readonly method: string;
  readonly params?: CdpParams;
  readonly sessionId?: string;
}

/** One event the browser sent: its method, its parameters, and the target session it came from. */
export interface CdpEvent {
  readonly method: string;
  readonly params: UnparsedWireValue;
  readonly sessionId?: string;
}

/** A page target, a tab: its id, address, and title. */
export interface PageTarget {
  readonly targetId: string;
  readonly url: string;
  readonly title: string;
}

/** A DevTools protocol connection to a browser, open for the scope it was made in. @public */
export interface CdpSession {
  /** Sends a command and answers its result. */
  readonly send: (command: CdpCommand) => Effect.Effect<UnparsedWireValue, CdpFailure>;
  /** The events the browser sends from the moment this is run, ending with the connection. */
  readonly events: Stream.Stream<CdpEvent>;
  /** The browser's page targets. */
  readonly pages: Effect.Effect<readonly PageTarget[], CdpFailure>;
  /** Opens a page at the address given, answering its target's id. */
  readonly openPage: (url: string) => Effect.Effect<string, CdpFailure>;
  /** Closes the page target named. */
  readonly closePage: (targetId: string) => Effect.Effect<void, CdpFailure>;
}
