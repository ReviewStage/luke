import { BUTTON_SHAPE, BUTTON_VARIANT, Button } from "@luke/ui";
import { MarkdownMessage } from "./markdown-message";
import {
  CAPTION_TONE,
  type CaptionPresentation,
  type CaptionTone,
} from "./use-caption-presentation";

/**
 * caption-strip.tsx -- the live captions: a small strip of the words being said, just above the call bar.
 *
 * Laid out the way a call app's live captions are: who is speaking in a
 * small label, then at most two lines of their words with the newest at the
 * foot, the older lines leaving through a faded top edge. It stands above the
 * call bar in the task's column, never over the side panel or the call's
 * controls, and the shell floats it at the window's foot wherever no call bar
 * is drawn. One element in every state, so both edges of its fade can run.
 */

/** The label over each speaker's words; a failure and a notice carry none. */
const SPEAKER_LABEL = {
  [CAPTION_TONE.LUKE]: "Luke",
  [CAPTION_TONE.DEVELOPER]: "You",
  [CAPTION_TONE.ERROR]: undefined,
  [CAPTION_TONE.NOTICE]: undefined,
} as const satisfies Record<CaptionTone, string | undefined>;

/**
 * Keeps the newest line in view by scrolling the clipped words to their foot
 * whenever their wrapped height changes: a word that starts a line, or the
 * same words rewrapped by a pane or the window resizing. Only the browser
 * knows where the text wrapped, so its resize report is what asks.
 */
function keepNewestInView(element: HTMLElement | null): (() => void) | undefined {
  const words = element?.firstElementChild;
  if (!element || !words) return undefined;
  const observer = new ResizeObserver(() => {
    element.scrollTop = element.scrollHeight;
  });
  observer.observe(words);
  return () => observer.disconnect();
}

/** The one reason Luke's words might be the only part of him arriving: the Mac's own output is off. */
interface VolumeHint {
  /** Whether the output is silent and no "Got it" holds; drawn only under Luke's words. */
  wanted: boolean;
  text: string;
  onDismiss: () => void;
}

export interface CaptionStripProps {
  caption: CaptionPresentation;
  volumeHint: VolumeHint;
}

function isSpeech(tone: CaptionTone): boolean {
  return tone === CAPTION_TONE.LUKE || tone === CAPTION_TONE.DEVELOPER;
}

/**
 * The strip. `speechHidden` holds back spoken words, and only those, while
 * the same words are already streaming somewhere on screen: a failure or a
 * notice was never said, so it is drawn whatever is beside it. The words are
 * hidden from readers while they caption speech, which is already audible,
 * and announced as a status line when they carry a failure or a notice.
 */
export function CaptionStrip({
  caption,
  volumeHint,
  speechHidden = false,
}: CaptionStripProps & { speechHidden?: boolean }): React.JSX.Element {
  const { content } = caption;
  const tone = content?.tone ?? CAPTION_TONE.LUKE;
  const speech = isSpeech(tone);
  const shown = caption.shown && !(speech && speechHidden);
  const label = SPEAKER_LABEL[tone];
  return (
    <div className="voice-caption" data-shown={String(shown)} data-tone={tone} inert={!shown}>
      <div {...(speech ? { "aria-hidden": true } : { role: "status" })}>
        {label === undefined ? null : <p className="voice-caption-speaker">{label}</p>}
        <div className="voice-caption-words" ref={keepNewestInView}>
          <MarkdownMessage className="voice-caption-text" words={content?.words ?? ""} />
        </div>
      </div>
      {volumeHint.wanted && tone === CAPTION_TONE.LUKE ? (
        <div className="volume-hint" role="status">
          <span className="volume-hint-text">{volumeHint.text}</span>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            shape={BUTTON_SHAPE.ROUND}
            onClick={volumeHint.onDismiss}
          >
            Got it
          </Button>
        </div>
      ) : null}
    </div>
  );
}
