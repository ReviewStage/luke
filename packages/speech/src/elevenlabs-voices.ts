import {
  type CloudFetch,
  HTTP_STATUS,
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { MAXIMUM_VOICE_FIELD_LENGTH, type SpeechVoice } from "./speech-provider.js";

/**
 * Reading the voices an ElevenLabs account holds. Only the main process calls
 * this: the long-lived key it is given never leaves that process, and what
 * comes back is bounded metadata the renderer can draw.
 */

export const ELEVENLABS_API_ORIGIN = "https://api.elevenlabs.io";

/**
 * Where a personal voice is made. Fixed by the build and opened by the main
 * process at the row's own press: Luke never records or uploads a cloning
 * sample, so the whole of his part in it is the way there.
 */
export const ELEVENLABS_VOICES_URL = "https://elevenlabs.io/app/voices";

/** The header ElevenLabs authenticates every request with. */
export const ELEVENLABS_KEY_HEADER = "xi-api-key";

const VOICES_PATH = "/v2/voices";

/**
 * The one query Luke asks. `voice_type=personal` is the whole reason this
 * read exists: the shared library runs to thousands of voices nobody here
 * made, and Luke offers the account's own. The rest fixes the answer's shape
 * so the panel's list is stable between refreshes and the count ElevenLabs
 * would compute is never asked for.
 */
const VOICES_QUERY = {
  voice_type: "personal",
  page_size: "100",
  sort: "name",
  sort_direction: "asc",
  include_total_count: "false",
} satisfies Readonly<Record<string, string>>;

/** The cursor parameter the previous page hands back, and the only one that varies. */
const PAGE_TOKEN_PARAMETER = "next_page_token";

/**
 * How many voices Luke will read before stopping. Far past any personal
 * library, and there so a server answering `has_more` forever cannot spin the
 * read: the cap is the backstop behind the cursor checks, not a page budget.
 */
export const MAXIMUM_VOICES = 1_000;

export const VOICE_LIST_OUTCOME = {
  OK: "ok",
  /** The key was refused: revoked, or missing the `voices_read` permission. */
  UNAUTHORIZED: "unauthorized",
  HTTP_ERROR: "http-error",
  NETWORK_ERROR: "network-error",
  MALFORMED_RESPONSE: "malformed-response",
} as const;

export type VoiceListOutcome = (typeof VOICE_LIST_OUTCOME)[keyof typeof VOICE_LIST_OUTCOME];

export interface VoiceListResult {
  outcome: VoiceListOutcome;
  /** Present on `ok`, and only then; a partial read is a failure, not a short list. */
  voices?: readonly SpeechVoice[];
  /** A status code or error name. Never a response body, and never the key. */
  detail?: string;
}

const VOICE_LIST_EXPLANATIONS = {
  [VOICE_LIST_OUTCOME.OK]: "The voices were read.",
  [VOICE_LIST_OUTCOME.UNAUTHORIZED]:
    "ElevenLabs refused the key. It may have been revoked, or it may not carry the Voices read permission.",
  [VOICE_LIST_OUTCOME.HTTP_ERROR]: "ElevenLabs rejected the request for the voice list.",
  [VOICE_LIST_OUTCOME.NETWORK_ERROR]: "The request for the voice list did not complete.",
  [VOICE_LIST_OUTCOME.MALFORMED_RESPONSE]: "ElevenLabs answered without a usable voice list.",
} satisfies Record<VoiceListOutcome, string>;

/** Explains a voice-list outcome in one sentence, for the panel and for logs. */
export function voiceListExplanation(outcome: VoiceListOutcome): string {
  return VOICE_LIST_EXPLANATIONS[outcome];
}

/** Builds the exact address one page of the personal voice list is read from. */
export function elevenlabsVoicesUrl(pageToken?: string): string {
  const url = new URL(VOICES_PATH, ELEVENLABS_API_ORIGIN);
  for (const [name, value] of Object.entries(VOICES_QUERY)) url.searchParams.set(name, value);
  if (pageToken !== undefined) url.searchParams.set(PAGE_TOKEN_PARAMETER, pageToken);
  return url.toString();
}

function boundedField(value: UnparsedWireValue): string | undefined {
  const trimmed = text(value)?.trim();
  if (!trimmed || trimmed.length > MAXIMUM_VOICE_FIELD_LENGTH) return undefined;
  return trimmed;
}

/**
 * Keeps the three fields a row draws, and drops a record missing either of the
 * two it cannot be drawn without. A voice with no id could not be selected,
 * and one with no name would draw an empty row.
 */
function voiceFromRecord(value: UnparsedWireValue): SpeechVoice | undefined {
  if (!isRecord(value)) return undefined;
  const id = boundedField(value.voice_id);
  const name = boundedField(value.name);
  if (!id || !name) return undefined;
  const category = boundedField(value.category);
  return category ? { id, name, category } : { id, name };
}

interface VoicePage {
  voices: readonly SpeechVoice[];
  /** The cursor for the next page, present only when the server says one follows. */
  nextPageToken?: string;
}

/**
 * Reads one page. `has_more` without a cursor is malformed rather than an
 * ending: the server is claiming a page it gave no way to ask for, and
 * treating that as the end would silently truncate the list.
 */
function pageFromPayload(payload: UnparsedWireValue): VoicePage | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.voices)) return undefined;
  const voices: SpeechVoice[] = [];
  for (const candidate of payload.voices) {
    const voice = voiceFromRecord(candidate);
    if (voice) voices.push(voice);
  }
  if (payload.has_more !== true) return { voices };
  const nextPageToken = payload.next_page_token;
  if (!isWireString(nextPageToken) || nextPageToken === "") return undefined;
  return { voices, nextPageToken };
}

export interface VoiceListOptions {
  apiKey: string;
  fetch: CloudFetch;
}

/**
 * Reads every page of the account's personal voices, following the cursor the
 * previous page handed back.
 *
 * A cursor the read has already followed ends it as malformed: a server
 * cycling two tokens would otherwise be read until the cap, and the cap is
 * meant to be unreachable. Deduplicating by id would hide the same fault,
 * which is why the cursor is what is checked.
 */
export async function listElevenlabsVoices(options: VoiceListOptions): Promise<VoiceListResult> {
  const voices: SpeechVoice[] = [];
  const seenCursors = new Set<string>();
  let pageToken: string | undefined;

  for (;;) {
    let response: Response;
    try {
      response = await options.fetch(elevenlabsVoicesUrl(pageToken), {
        method: "GET",
        headers: { [ELEVENLABS_KEY_HEADER]: options.apiKey },
      });
    } catch (error) {
      return {
        outcome: VOICE_LIST_OUTCOME.NETWORK_ERROR,
        detail: error instanceof Error ? error.name : undefined,
      };
    }

    if (!response.ok) {
      const unauthorized =
        response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
      return {
        outcome: unauthorized ? VOICE_LIST_OUTCOME.UNAUTHORIZED : VOICE_LIST_OUTCOME.HTTP_ERROR,
        detail: String(response.status),
      };
    }

    let payload: UnparsedWireValue;
    try {
      // SAFETY: An untrusted body is unparsed wire until `pageFromPayload` reads it.
      payload = (await response.json()) as UnparsedWireValue;
    } catch {
      return { outcome: VOICE_LIST_OUTCOME.MALFORMED_RESPONSE };
    }

    const page = pageFromPayload(payload);
    if (!page) return { outcome: VOICE_LIST_OUTCOME.MALFORMED_RESPONSE };

    for (const voice of page.voices) {
      if (voices.length >= MAXIMUM_VOICES) break;
      voices.push(voice);
    }

    if (page.nextPageToken === undefined || voices.length >= MAXIMUM_VOICES) {
      return { outcome: VOICE_LIST_OUTCOME.OK, voices };
    }
    if (seenCursors.has(page.nextPageToken)) {
      return { outcome: VOICE_LIST_OUTCOME.MALFORMED_RESPONSE };
    }
    seenCursors.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }
}
