import type {
  HostedConversationAnswer,
  HostedConversationMessage,
  HostedSessionMessagesClient,
} from "@sidecar/hosted";
import {
  CONVERSATION_MESSAGE_AUTHOR,
  isCloudAgentProviderId,
  OMISSION_MARKER,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  type Session,
  type SessionIdentity,
  transcriptLine,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, wholeText } from "@sidecar/wire";

/**
 * The brain's two transcript reads, as the wiring asks for them: one
 * session's whole tail for the `read_transcript` tool, and what a session
 * gained since the cursor an observed conversation last kept, for its look.
 */
export interface SessionTranscriptReads {
  readTranscript(identity: SessionIdentity): Promise<ProviderTranscriptResult>;
  readTranscriptSince(
    identity: SessionIdentity,
    cursor: string | undefined,
  ): Promise<ProviderTranscriptSinceResult>;
}

export interface HostedTranscriptReadsDependencies {
  client: Pick<HostedSessionMessagesClient, "read">;
  /** The session as the roster holds it, for the name its agent's lines wear. */
  session: (identity: SessionIdentity) => Session | undefined;
}

const REFUSAL = {
  NO_ENDPOINT: "That session's provider documents no transcript read from this Mac.",
  NOT_READ: "That session's transcript could not be read through Luke's service.",
  NOT_FOUND: "That session's transcript could not be found.",
} as const;

/**
 * Attributed messages as transcript lines, in the vocabulary every local
 * reader speaks: the developer's in the shared lead, the agent's under the
 * name the roster gives it. A message the service relayed with nothing left
 * once its whitespace is settled draws no line.
 */
function transcriptLines(
  speaker: string,
  messages: readonly HostedConversationMessage[],
): readonly string[] {
  return messages.flatMap((message) => {
    const words = wholeText(message.text);
    if (!words) return [];
    return [
      message.author === CONVERSATION_MESSAGE_AUTHOR.USER
        ? transcriptLine.developer(words)
        : transcriptLine.agent(speaker, words),
    ];
  });
}

/**
 * The brain's transcript reads over the service's messages endpoint, the
 * same documented read the phone's chat screen makes: the service
 * re-observes the session under the developer's synced key and answers the
 * newest page of the developer's own sends and the agent's own words, with
 * everything unattributed already dropped. Both reads answer only for a
 * cloud session; a provider whose conversation the service does not read is
 * refused by the service, and this Mac reads no provider file for any
 * session, because none stands behind a row.
 */
export function hostedTranscriptReads(
  dependencies: HostedTranscriptReadsDependencies,
): SessionTranscriptReads {
  const { client, session } = dependencies;

  /**
   * One page of the session's conversation and the name its agent's lines
   * wear, or the refusal both reads share: a local identity before any call,
   * an unanswered page after it.
   */
  const page = async (
    identity: SessionIdentity,
    cursor: string | undefined,
  ): Promise<
    | { speaker: string; answer: HostedConversationAnswer }
    | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string }
    | { status: typeof ACTION_RESULT_STATUS.REJECTED; reason: string }
  > => {
    const { providerId, providerSessionId } = identity;
    if (!isCloudAgentProviderId(providerId)) {
      return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ENDPOINT };
    }
    const answer = await client.read({
      providerId,
      providerSessionId,
      ...(cursor === undefined ? undefined : { afterMessageId: cursor }),
    });
    if (!answer) return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.NOT_READ };
    const speaker =
      session(identity)?.agent?.displayName ?? PROVIDER_IDENTITY_BY_ID[providerId].displayName;
    return { speaker, answer };
  };

  return {
    async readTranscript(identity) {
      const read = await page(identity, undefined);
      if ("status" in read) return read;
      const { speaker, answer } = read;
      const lines = transcriptLines(speaker, answer.messages);
      if (lines.length === 0) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.NOT_FOUND };
      }
      const rendered = lines.join("\n");
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        // A tail that history precedes opens with the marker, so the reader
        // knows the chat did not begin there.
        transcript: answer.hasOlder ? `${OMISSION_MARKER}\n${rendered}` : rendered,
      };
    },

    async readTranscriptSince(identity, cursor) {
      const read = await page(identity, cursor);
      if ("status" in read) return read;
      const { speaker, answer } = read;
      // The cursor answered is the newest stored message the page consumed,
      // attributed or not, so the next look resumes past the lifecycle noise
      // too; a chat that gained nothing answers no words and the same cursor.
      const next = answer.lastMessageId ?? cursor;
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        text: transcriptLines(speaker, answer.messages).join("\n"),
        ...(next !== undefined ? { cursor: next } : undefined),
        // A first look reads the newest page and says the front was cut when
        // history precedes it; a look behind a cursor says whether newer
        // messages remain past the page.
        truncated: cursor === undefined ? answer.hasOlder === true : answer.hasMore,
      };
    },
  };
}
