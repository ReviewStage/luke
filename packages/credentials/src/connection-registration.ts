import type { CliConnection } from "@sidecar/session";
import type { ActResult } from "@sidecar/wire";
import type { ConnectionDeclaration } from "./connections.js";
import type { ConsentSignInRefusal, InteractiveSignIn, SignInEdge } from "./interactive-sign-in.js";

/**
 * A consent row's connect as the dispatcher sees it: the browser trip and
 * the storing of the grant it hands back happen together behind `connect`,
 * so no grant of any shape crosses a generic seam. Nothing means connected.
 */
export interface ConsentConnect {
  connect(): Promise<ConsentSignInRefusal | undefined>;
  cancel(): void;
  reopen(): void;
}

/**
 * One connection's row as the main process runs it. Every seam is optional
 * and the generic handlers answer unsupported where one is absent, so a row
 * is offered only what its declaration's kind gives it: a key row has no
 * sign-in of either kind, a CLI row has no grant to store, a local row has
 * nothing at all.
 */
export interface ConnectionRegistration {
  declaration: ConnectionDeclaration;
  /** What the provider's own CLI says about its login, for a CLI-login row. */
  cliConnection?(): Promise<CliConnection>;
  /** Whether this build can offer the consent sign-in at all. */
  signInAvailable?(): boolean;
  interactiveSignIn?: InteractiveSignIn;
  consentSignIn?: ConsentConnect;
  /** Withdraws the connection with the service as well as here. */
  disconnect?(): Promise<ActResult>;
  /** What a saved, replaced, or cleared credential moves. */
  onCredentialChanged?(): Promise<void> | void;
  /** What a CLI login landing or leaving moves. */
  onConnectionChanged?(): void;
  countSignInEdge?(edge: SignInEdge): void;
}
