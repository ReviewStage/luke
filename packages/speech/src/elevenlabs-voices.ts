import {
  type CloudFetch,
  HTTP_STATUS,
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
} from "@sidecar/wire";
import {
  ELEVENLABS_OUTCOME,
  type ElevenlabsFailure,
  type ElevenlabsOutcome,
  MAXIMUM_VOICE_FIELD_LENGTH,
  type SpeechVoice,
} from "./speech-provider.js";

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
 * read.
 */
export const MAXIMUM_VOICES = 1_000;

export interface VoiceListResult {
  outcome: ElevenlabsOutcome;
  /** Present on `ok`, and only then; a partial read is a failure, not a short list. */
  voices?: readonly SpeechVoice[];
}

const VOICE_LIST_EXPLANATIONS = {
  [ELEVENLABS_OUTCOME.UNAUTHORIZED]:
    "ElevenLabs refused the key. It may have been revoked, or it may not carry the Voices read permission.",
  [ELEVENLABS_OUTCOME.HTTP_ERROR]: "ElevenLabs rejected the request for the voice list.",
  [ELEVENLABS_OUTCOME.NETWORK_ERROR]: "The request for the voice list did not complete.",
  [ELEVENLABS_OUTCOME.MALFORMED_RESPONSE]: "ElevenLabs answered without a usable voice list.",
} satisfies Record<ElevenlabsFailure, string>;

/** Explains a failed voice list in one sentence, for the panel and for logs. */
export function voiceListExplanation(outcome: ElevenlabsFailure): string {
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
 * previous page handed back, up to the cap.
 */
export async function listElevenlabsVoices(options: VoiceListOptions): Promise<VoiceListResult> {
  const voices: SpeechVoice[] = [];
  let pageToken: string | undefined;

  for (;;) {
    let response: Response;
    try {
      response = await options.fetch(elevenlabsVoicesUrl(pageToken), {
        method: "GET",
        headers: { [ELEVENLABS_KEY_HEADER]: options.apiKey },
      });
    } catch {
      return { outcome: ELEVENLABS_OUTCOME.NETWORK_ERROR };
    }

    if (!response.ok) {
      const unauthorized =
        response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
      return {
        outcome: unauthorized ? ELEVENLABS_OUTCOME.UNAUTHORIZED : ELEVENLABS_OUTCOME.HTTP_ERROR,
      };
    }

    let payload: UnparsedWireValue;
    try {
      // SAFETY: An untrusted body is unparsed wire until `pageFromPayload` reads it.
      payload = (await response.json()) as UnparsedWireValue;
    } catch {
      return { outcome: ELEVENLABS_OUTCOME.MALFORMED_RESPONSE };
    }

    const page = pageFromPayload(payload);
    if (!page) return { outcome: ELEVENLABS_OUTCOME.MALFORMED_RESPONSE };

    for (const voice of page.voices) {
      if (voices.length >= MAXIMUM_VOICES) break;
      voices.push(voice);
    }

    if (page.nextPageToken === undefined || voices.length >= MAXIMUM_VOICES) {
      return { outcome: ELEVENLABS_OUTCOME.OK, voices };
    }
    pageToken = page.nextPageToken;
  }
}
