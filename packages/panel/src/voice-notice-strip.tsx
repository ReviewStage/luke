import { BUTTON_SHAPE, BUTTON_VARIANT, Button } from "@luke/ui";
import { MarkdownMessage } from "./markdown-message.js";
import { VOICE_NOTICE_TONE, type VoiceNoticePresentation } from "./use-voice-notice.js";

/**
 * voice-notice-strip.tsx -- the voice's notice line: a failure, a notice, or the hint that the Mac's output is off, floating just above where it was asked.
 *
 * It draws no spoken words, which stream into the agent's transcript as
 * they are heard. While a call's agent tab is on screen it floats over the
 * transcript's foot, above the call's video and composer (`agent-call.tsx`),
 * so it never covers the video; the shell floats it at the window's foot
 * wherever no such tab is drawn. One element in every state, so both edges
 * of its fade can run, and announced as a status line.
 */

/** What dismisses the volume hint for this stretch of silence. */
const DISMISS_HINT_LABEL = "Got it";

export interface VoiceNoticeStripProps {
  notice: VoiceNoticePresentation;
  /** Quiets the volume hint for this stretch of silence. */
  onDismissHint: () => void;
}

export function VoiceNoticeStrip({
  notice,
  onDismissHint,
}: VoiceNoticeStripProps): React.JSX.Element {
  const { content, shown } = notice;
  const tone = content?.tone ?? VOICE_NOTICE_TONE.NOTICE;
  return (
    <div className="voice-notice" data-shown={String(shown)} data-tone={tone} inert={!shown}>
      <div className="voice-notice-row" role="status">
        <MarkdownMessage className="voice-notice-text" words={content?.words ?? ""} />
        {tone === VOICE_NOTICE_TONE.VOLUME ? (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            shape={BUTTON_SHAPE.ROUND}
            onClick={onDismissHint}
          >
            {DISMISS_HINT_LABEL}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
