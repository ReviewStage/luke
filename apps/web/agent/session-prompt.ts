import { defineState } from "eve/context";
import type { SessionPromptRecord } from "../server/hosted/brain-host/host.js";

/**
 * The session's prompt as its content address, in eve's durable session
 * state: written by the instructions resolver that composes the prompt at
 * the session's start and read by the store hook as each turn starts, so the
 * turn row names the prompt the model reads rather than one composed again.
 */
export const sessionPrompt = defineState<SessionPromptRecord>("luke.prompt", () => ({}));
