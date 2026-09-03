import type { ACT_RESULT_STATUS } from "@sidecar/wire";

/**
 * What an incremental transcript read answers: the text written since the
 * cursor the previous read handed back, the cursor to continue from — absent
 * when the provider had nothing to anchor one to, so the next read starts the
 * way this one did — and whether the adapter's own tail bound cut the front
 * of it. A rejected read
 * names a session the provider does not hold; an unsupported one names a
 * provider this build reads no transcript of. Owned by the PR 2 session
 * (`@sidecar/session`); defined here under the same name until it lands.
 */
export type ProviderTranscriptSinceResult =
  | {
      status: typeof ACT_RESULT_STATUS.ACCEPTED;
      text: string;
      cursor?: string;
      truncated: boolean;
    }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string };
