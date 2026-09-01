import type { SpeechVoice } from "@sidecar/speech";
import type { SpeechVoicesAnswer } from "#shared/contracts";

/**
 * What the Voice page draws where the ElevenLabs voices go. One reading of the
 * three things that decide it — whether a key is connected, whether the read
 * has answered, and what it answered — so the page has one state to draw
 * rather than a chain of conditions repeated in the markup.
 */

export const SPEECH_VOICES_STATE = {
  /** No key, so there is nothing to read and nothing to choose from. */
  DISCONNECTED: "disconnected",
  LOADING: "loading",
  /** The read failed. The last good list is not kept: a stale list is a lie. */
  FAILED: "failed",
  /** The account holds no personal voices, which is where a new one is made. */
  EMPTY: "empty",
  READY: "ready",
} as const;

export type SpeechVoicesState = (typeof SPEECH_VOICES_STATE)[keyof typeof SPEECH_VOICES_STATE];

export interface SpeechVoicesView {
  state: SpeechVoicesState;
  voices: readonly SpeechVoice[];
  /** One sentence under the row, for every state that needs one. */
  note?: string;
  /**
   * Whether the voice Luke is set to speak with is missing from the list just
   * read — deleted in ElevenLabs, or made under another account. It is said
   * rather than silently corrected: the selection is the developer's, and
   * choosing for them would move Luke's voice behind their back.
   */
  selectionMissing: boolean;
}

const CONNECT_NOTE =
  "Connect an ElevenLabs key above to choose one of your own voices. Everything else about the conversation stays with OpenAI.";

/**
 * ElevenLabs' own recording guidance for an Instant Voice Clone, said here
 * because the way to a first voice is the whole of what this state can offer.
 * Luke records nothing and uploads nothing: the microphone he asks for is for
 * talking to him, and the clone is made in ElevenLabs by its owner.
 */
const EMPTY_NOTE =
  "This ElevenLabs account holds no personal voices yet. Make one in ElevenLabs with an " +
  "Instant Voice Clone — one to two minutes of clean, consistent audio of a single speaker, " +
  "MP3 at 192 kbps or better, of a voice you own or have consent to clone — then refresh.";

const MISSING_NOTE =
  "The voice Luke was set to speak with is no longer in this account. Choose another, or Luke keeps speaking as OpenAI.";

export function speechVoicesView(input: {
  connected: boolean;
  loading: boolean;
  answer: SpeechVoicesAnswer | undefined;
  selected: string | undefined;
}): SpeechVoicesView {
  if (!input.connected) {
    return {
      state: SPEECH_VOICES_STATE.DISCONNECTED,
      voices: [],
      note: CONNECT_NOTE,
      selectionMissing: false,
    };
  }
  // Loading leads: a refresh under way is a refresh, whatever the last answer
  // said, and drawing the old failure under a spinner reads as a new one.
  if (input.loading || !input.answer) {
    return { state: SPEECH_VOICES_STATE.LOADING, voices: [], selectionMissing: false };
  }
  if (input.answer.explanation) {
    return {
      state: SPEECH_VOICES_STATE.FAILED,
      voices: [],
      note: input.answer.explanation,
      selectionMissing: false,
    };
  }
  if (input.answer.voices.length === 0) {
    return {
      state: SPEECH_VOICES_STATE.EMPTY,
      voices: [],
      note: EMPTY_NOTE,
      selectionMissing: false,
    };
  }
  const selectionMissing =
    input.selected !== undefined &&
    !input.answer.voices.some((voice) => voice.id === input.selected);
  return {
    state: SPEECH_VOICES_STATE.READY,
    voices: input.answer.voices,
    ...(selectionMissing ? { note: MISSING_NOTE } : undefined),
    selectionMissing,
  };
}

/** What the select's own row says while nothing has been chosen. */
export const NO_SPEECH_VOICE_CHOICE = "Choose a voice";
