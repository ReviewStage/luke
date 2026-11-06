import type { UnparsedWireValue, WireBoundaryInput } from "@repo/wire";
import { Data, type Effect, type Stream } from "effect";

export const CDP_FAILURE = {
  REFUSED: "refused",
  TIMED_OUT: "timed-out",
  MALFORMED: "malformed",
  CLOSED: "closed",
  DENIED: "denied",
} as const;

export type CdpFailureKind = (typeof CDP_FAILURE)[keyof typeof CDP_FAILURE];

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

/** @public */
export type CdpParams = { readonly [key: string]: WireBoundaryInput };

/** @public */
export interface CdpCommand {
  readonly method: string;
  readonly params?: CdpParams;
  readonly sessionId?: string;
}

export interface CdpEvent {
  readonly method: string;
  readonly params: UnparsedWireValue;
  readonly sessionId?: string;
}

export interface PageTarget {
  readonly targetId: string;
  readonly url: string;
  readonly title: string;
}

/** @public */
export interface CdpSession {
  readonly send: (command: CdpCommand) => Effect.Effect<UnparsedWireValue, CdpFailure>;
  readonly events: Stream.Stream<CdpEvent>;
  readonly pages: Effect.Effect<readonly PageTarget[], CdpFailure>;
  readonly openPage: (url: string) => Effect.Effect<string, CdpFailure>;
  readonly closePage: (targetId: string) => Effect.Effect<void, CdpFailure>;
}
