import { voiceErrorToShow, voiceNoticeToShow } from "@luke/panel/use-voice-view";
import type { VoiceSpeakers } from "@luke/voice/voice-view";
import { useEffect, useRef, useState } from "react";

/**
 * use-caption-presentation.ts -- what the caption strip says this frame: whose words, in which tone, and the moment they stay once the speaker stops.
 *
 * The strip carries one speaker at a time. The session is full duplex, so
 * both can carry words at once, and Luke's reply is the one worth reading
 * over a read-back of what the developer just said. A failure borrows the
 * strip, and a notice borrows it more quietly, each over the developer's
 * own words but never over Luke's.
 */

/**
 * What the strip is carrying, which is what labels and colours it: Luke's
 * words, the developer's own, a failure in the error red, or a notice in the
 * attention orange for a temporary state rather than a fault.
 */
export const CAPTION_TONE = {
  LUKE: "luke",
  DEVELOPER: "developer",
  ERROR: "error",
  NOTICE: "notice",
} as const;

export type CaptionTone = (typeof CAPTION_TONE)[keyof typeof CAPTION_TONE];

/**
 * How long the last words stay once nobody is saying them: long enough to
 * finish reading the line the voice ended on, short enough that the strip
 * is gone before the next thing is said.
 */
const CAPTION_LINGER_MS = 3_000;

/** The strip's words and whose they are. */
interface CaptionContent {
  tone: CaptionTone;
  words: string;
}

export interface CaptionPresentation {
  /** The words the strip holds: the live ones, or the last ones after they stop, so its exit has words to fade. */
  content: CaptionContent | undefined;
  /** Whether the strip is drawn: while words are live, and for the linger after. */
  shown: boolean;
}

interface UseCaptionPresentationOptions {
  /** Luke's own words this frame, or nothing while he is not speaking. */
  lukeCaptions: readonly string[] | undefined;
  /** The developer's own words this frame, or nothing while none are being said. */
  developerCaptions: readonly string[] | undefined;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  /** Who is being heard, which decides what the strip may show over a fault or a notice. */
  speakers: VoiceSpeakers;
  fixtureSpeaking: boolean;
}

/**
 * What the strip is being handed live this frame. A speaker's segments, one
 * per message spoken back to back, read as one run of speech, the way a
 * caption reads.
 */
function liveContent(options: UseCaptionPresentationOptions): CaptionContent | undefined {
  const { lukeCaptions, developerCaptions, speakers, fixtureSpeaking } = options;
  if (lukeCaptions !== undefined) return { tone: CAPTION_TONE.LUKE, words: lukeCaptions.join(" ") };
  // Note that a failure and a notice outrank the developer's own words,
  // because those were just said and a refusal answered over them was not:
  // each leaves on its own clock, and would otherwise leave unread.
  const error = voiceErrorToShow({ fixtureSpeaking, speakers, error: options.voiceError });
  if (error !== undefined) return { tone: CAPTION_TONE.ERROR, words: error };
  const notice = voiceNoticeToShow({ fixtureSpeaking, speakers, notice: options.voiceNotice });
  if (notice !== undefined) return { tone: CAPTION_TONE.NOTICE, words: notice };
  if (developerCaptions === undefined) return undefined;
  return { tone: CAPTION_TONE.DEVELOPER, words: developerCaptions.join(" ") };
}

/**
 * The caption strip's words. Live words always win; once they stop, the last
 * of them stay for {@link CAPTION_LINGER_MS} and then leave, and they stay
 * held after that, undrawn, so the strip's fade has words to fade.
 */
export function useCaptionPresentation(
  options: UseCaptionPresentationOptions,
): CaptionPresentation {
  const live = liveContent(options);
  const last = useRef<CaptionContent | undefined>(undefined);
  if (live !== undefined) last.current = live;
  const held = last.current;
  // The words whose linger ran out; drawn again only once live words replace them.
  const [expired, setExpired] = useState<CaptionContent | undefined>(undefined);
  const speaking = live !== undefined;
  useEffect(() => {
    const lingering = last.current;
    if (speaking || lingering === undefined) return;
    const timer = window.setTimeout(() => setExpired(lingering), CAPTION_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [speaking]);
  return { content: held, shown: speaking || (held !== undefined && held !== expired) };
}
