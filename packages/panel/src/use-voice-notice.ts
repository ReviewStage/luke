import {
  VOICE_FAILURE_WORDS,
  type VoiceFailure,
  type VoiceFailureWords,
  type VoiceRemedy,
} from "@luke/features/words";
import type { VoiceSpeakers } from "@luke/voice/voice-view";
import { useEffect, useRef, useState } from "react";
import { voiceErrorToShow, voiceNoticeToShow } from "./use-voice-view.js";

/**
 * use-voice-notice.ts -- what the voice's notice line says this frame: a failure, a notice, or the hint that the Mac's output is off, and the moment it stays once it clears.
 *
 * The line carries no spoken words: what is said streams into the agent's
 * transcript as it is heard. It carries what the voice has to say about
 * itself, one thing at a time: a failure first, then a notice, then, while
 * Luke speaks into a Mac whose output is muted or at zero, the hint that he
 * cannot be heard.
 */

/**
 * What the line is carrying, which is what colours it: a failure in the
 * error red, a notice in the attention orange for a temporary state rather
 * than a fault, or the volume hint, which alone offers a press.
 */
export const VOICE_NOTICE_TONE = {
  ERROR: "error",
  NOTICE: "notice",
  VOLUME: "volume",
} as const;

type VoiceNoticeTone = (typeof VOICE_NOTICE_TONE)[keyof typeof VOICE_NOTICE_TONE];

/**
 * How long the last words stay once nothing asks for them: long enough to
 * finish reading the line, short enough that it is gone before the next
 * thing happens.
 */
const NOTICE_LINGER_MS = 3_000;

/** The line's words, what they are, and the remedy its button offers where one does something about them. */
interface VoiceNoticeContent {
  tone: VoiceNoticeTone;
  words: string;
  remedy?: VoiceRemedy | undefined;
}

export interface VoiceNoticePresentation {
  /** The words the line holds: the live ones, or the last ones after they clear, so its exit has words to fade. */
  content: VoiceNoticeContent | undefined;
  /** Whether the line is drawn: while something asks for it, and for the linger after. */
  shown: boolean;
}

interface UseVoiceNoticeOptions {
  voiceError: VoiceFailure | undefined;
  voiceNotice: VoiceFailure | undefined;
  /** Who is being heard, which decides what may show over a fault or a notice, and whether Luke is speaking unheard. */
  speakers: VoiceSpeakers;
  fixtureSpeaking: boolean;
  /** Whether the output is silent with no "Got it" holding, and what the hint then says. */
  volumeHint: { wanted: boolean; text: string };
}

/** A failure as the line says it: its words from the words module, never text the voice was handed. */
function failureContent(tone: VoiceNoticeTone, failure: VoiceFailure): VoiceNoticeContent {
  const said: VoiceFailureWords = VOICE_FAILURE_WORDS[failure];
  return { tone, words: said.words, remedy: said.remedy };
}

/** What the line is being handed live this frame. */
function liveContent(options: UseVoiceNoticeOptions): VoiceNoticeContent | undefined {
  const { speakers, fixtureSpeaking, volumeHint } = options;
  const error = voiceErrorToShow({ fixtureSpeaking, speakers, error: options.voiceError });
  if (error !== undefined) return failureContent(VOICE_NOTICE_TONE.ERROR, error);
  const notice = voiceNoticeToShow({ fixtureSpeaking, speakers, notice: options.voiceNotice });
  if (notice !== undefined) return failureContent(VOICE_NOTICE_TONE.NOTICE, notice);
  // Note that the hint asks only while Luke speaks, because only then is there something unheard.
  if (volumeHint.wanted && speakers.lukeSpeaking) {
    return { tone: VOICE_NOTICE_TONE.VOLUME, words: volumeHint.text };
  }
  return undefined;
}

/**
 * The notice line's words. Live words always win; once a failure or a
 * notice clears, its words stay for {@link NOTICE_LINGER_MS} and then leave,
 * while the volume hint leaves at once, since it is cleared by being
 * answered; either is held after that, undrawn, so the line's fade has words
 * to fade.
 */
export function useVoiceNotice(options: UseVoiceNoticeOptions): VoiceNoticePresentation {
  const live = liveContent(options);
  const last = useRef<VoiceNoticeContent | undefined>(undefined);
  if (live !== undefined) last.current = live;
  const held = last.current;
  // The words whose linger ran out; drawn again only once live words replace them.
  const [expired, setExpired] = useState<VoiceNoticeContent | undefined>(undefined);
  const asking = live !== undefined;
  useEffect(() => {
    const lingering = last.current;
    if (asking || lingering === undefined) return;
    const timer = window.setTimeout(() => setExpired(lingering), NOTICE_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [asking]);
  // Note that a volume hint never lingers: once Got it quiets it, or the output is heard again, it was answered.
  const lingers = held !== undefined && held !== expired && held.tone !== VOICE_NOTICE_TONE.VOLUME;
  return { content: held, shown: asking || lingers };
}
