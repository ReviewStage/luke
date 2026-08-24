import { HOSTED_AGENT_ID, PROVIDER_ID } from "./providers.js";
import type { SessionProvider } from "./session.js";

/**
 * The identity Luke draws each agent's sessions under, declared once for
 * every hosting app that names agents in a vocabulary of its own. A host's
 * adapter keeps only its own spelling of each kind, mapped onto these, so an
 * agent reports the same identity whichever app hosts it and a display name
 * cannot drift from the one the agent's own adapter answers with.
 */
export const AGENT_IDENTITY = {
  CLAUDE_CODE: { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" },
  CODEX: { id: PROVIDER_ID.CODEX, displayName: "Codex" },
  COPILOT: { id: PROVIDER_ID.COPILOT, displayName: "Copilot" },
  CURSOR: { id: PROVIDER_ID.CURSOR, displayName: "Cursor" },
  DEVIN: { id: PROVIDER_ID.DEVIN, displayName: "Devin" },
  GEMINI_CLI: { id: PROVIDER_ID.GEMINI_CLI, displayName: "Gemini CLI" },
  GROK_BUILD: { id: PROVIDER_ID.GROK_BUILD, displayName: "Grok Build" },
  OPENCODE: { id: PROVIDER_ID.OPENCODE, displayName: "OpenCode" },
  DEEPSEEK: {
    id: HOSTED_AGENT_ID.DEEPSEEK,
    // The hosting app's own name for its DeepSeek-backed harness, not
    // DeepSeek the model vendor: the mark is the vendor's, the word is the
    // agent's.
    displayName: "DeepSeek Harness",
  },
  PI: { id: HOSTED_AGENT_ID.PI, displayName: "Pi" },
} as const satisfies Readonly<Record<string, SessionProvider>>;

/**
 * Reads a hosting app's own agent word into whatever its table maps that word
 * to, or nothing for a word outside it, so an agent this build cannot name
 * reports none rather than a guess. The scan keeps a table keyed by a derived
 * union safe to ask about any reported string.
 */
export function agentIdentityFor<Identity>(
  identityByKind: Readonly<Record<string, Identity>>,
  kind: string | undefined,
): Identity | undefined {
  if (kind === undefined) return undefined;
  for (const [candidate, identity] of Object.entries(identityByKind)) {
    if (candidate === kind) return identity;
  }
  return undefined;
}
