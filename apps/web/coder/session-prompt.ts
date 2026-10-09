import { defineState } from "eve/context";
import type { SessionPromptRecord } from "../server/hosted/brain-host/host.js";

/**
 * The session's prompt as its content address, in eve's durable session
 * state: written by the instructions resolver that composes the prompt at
 * the session's start and read by the store hook as each turn starts, so the
 * turn row names the prompt the model reads rather than one composed again.
 */
export const sessionPrompt = defineState<SessionPromptRecord>("luke.coder.prompt", () => ({}));

/**
 * What the session's sandbox has been told, in eve's durable session state:
 * whether a sandbox tool has run, which is when a sandbox stands to be
 * stopped at the turn's end, and when the repository credential at its
 * firewall was last set, which is when it is next renewed.
 */
export interface SandboxRecord {
  /** The instant the first sandbox tool of the session was called, which is when the sandbox opened and the checkout set its credential. */
  readonly openedAt?: number;
  /** The instant the store hook last renewed the credential at the firewall. */
  readonly credentialAt?: number;
}

export const sandboxRecord = defineState<SandboxRecord>("luke.coder.sandbox", () => ({}));
