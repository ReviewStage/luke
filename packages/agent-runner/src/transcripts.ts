/**
 * transcripts.ts -- the CLI's transcript kept at the service, where the config names `transcriptsUrl`: Anthropic's `SessionStore` over the service's store calls, which Claude Code's SDK mirrors to and loads from, and Codex's launch alike.
 *
 * Each of the store's calls is one POST under the runner's bearer
 * (`RUNNER_TRANSCRIPTS`), which the service runs against the agent's own
 * rows. The SDK calls the store as promises, from outside any fiber, so
 * each call is a plain `fetch`: a call the service did not answer rejects,
 * and the SDK does what its contract says with that (an append is retried
 * and then dropped, a load fails the query). Nothing of a transcript is
 * logged, since it can hold a tool's output.
 */

import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { Redacted, Schema } from "effect";
import {
  RUNNER_TRANSCRIPTS,
  type RunnerTranscriptCall,
  RunnerTranscriptLoadSchema,
  RunnerTranscriptSessionsSchema,
  RunnerTranscriptSubkeysSchema,
} from "./protocol.js";

const decodeLoad = Schema.decodeUnknownSync(RunnerTranscriptLoadSchema);
const decodeSessions = Schema.decodeUnknownSync(RunnerTranscriptSessionsSchema);
const decodeSubkeys = Schema.decodeUnknownSync(RunnerTranscriptSubkeysSchema);

/** The SDK's key as a call carries it: no subpath for the main transcript. */
function keyOf(key: SessionKey): SessionKey {
  const { projectKey, sessionId, subpath } = key;
  return subpath === undefined ? { projectKey, sessionId } : { projectKey, sessionId, subpath };
}

/** The store at the URL given, called under the runner's bearer, each call carrying the launch's trace where it has one (`trace.ts`). */
export function transcriptStore(
  url: string,
  bearer: Redacted.Redacted,
  traceHeaders: Readonly<Record<string, string>>,
): Required<Pick<SessionStore, "append" | "load" | "listSessions" | "delete" | "listSubkeys">> {
  const post = async (call: RunnerTranscriptCall): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...traceHeaders,
        authorization: `Bearer ${Redacted.value(bearer)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(call),
    });
    if (!response.ok) throw new Error(`The transcript store answered ${response.status}`);
    return response.json();
  };
  return {
    append: async (key, entries) => {
      await post({ call: RUNNER_TRANSCRIPTS.CALL.APPEND, key: keyOf(key), entries });
    },
    load: async (key) => {
      const answer = decodeLoad(
        await post({ call: RUNNER_TRANSCRIPTS.CALL.LOAD, key: keyOf(key) }),
      );
      return answer.entries === null
        ? null
        : answer.entries.map((entry) => entry as SessionStoreEntry);
    },
    listSessions: async (projectKey) => {
      const answer = decodeSessions(
        await post({ call: RUNNER_TRANSCRIPTS.CALL.LIST_SESSIONS, projectKey }),
      );
      return [...answer.sessions];
    },
    delete: async (key) => {
      await post({ call: RUNNER_TRANSCRIPTS.CALL.DELETE, key: keyOf(key) });
    },
    listSubkeys: async (key) => {
      const answer = decodeSubkeys(
        await post({
          call: RUNNER_TRANSCRIPTS.CALL.LIST_SUBKEYS,
          key: { projectKey: key.projectKey, sessionId: key.sessionId },
        }),
      );
      return [...answer.subkeys];
    },
  };
}
