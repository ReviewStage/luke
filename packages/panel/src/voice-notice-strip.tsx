import { VOICE_REMEDY, VOICE_REMEDY_LABEL, type VoiceRemedy } from "@luke/features/words";
import { BUTTON_SHAPE, BUTTON_VARIANT, Button, ButtonLink } from "@luke/ui";
import { MarkdownMessage } from "./markdown-message.js";
import { linkPressOf, useOpenLink } from "./tasks/use-open-link.js";
import { VOICE_NOTICE_TONE, type VoiceNoticePresentation } from "./use-voice-notice.js";

/**
 * voice-notice-strip.tsx -- the voice's notice line: a failure, a notice, or the hint that the Mac's output is off, floating just above where it was asked.
 *
 * It draws no spoken words, which stream into the agent's transcript as
 * they are heard. While a call's agent tab is on screen it floats over the
 * transcript's foot, above the call's video and composer (`agent-call.tsx`),
 * so it never covers the video; the shell floats it at the window's foot
 * wherever no such tab is drawn. One element in every state, so both edges
 * of its fade can run. A failure is announced as an alert, and anything else
 * as a status line; the row is drawn anew when what it carries changes kind,
 * because a live region is announced reliably as it arrives, not as its
 * role turns. A failure with a remedy offers it as a button beside its words,
 * or, where the remedy is a page outside the window, as a link to it.
 */

/** What dismisses the volume hint for this stretch of silence. */
const DISMISS_HINT_LABEL = "Got it";

/** The remedies that are a page outside the window: OpenAI's billing page, where the account a saved key belongs to is given credit. */
const REMEDY_ADDRESS: Partial<Record<VoiceRemedy, string>> = {
  [VOICE_REMEDY.ADD_OPENAI_CREDIT]:
    "https://platform.openai.com/settings/organization/billing/overview",
};

export interface VoiceNoticeStripProps {
  notice: VoiceNoticePresentation;
  /** Quiets the volume hint for this stretch of silence. */
  onDismissHint: () => void;
  /** Does what a failure's remedy offers, such as opening Settings where the OpenAI key goes. */
  onRemedy: (remedy: VoiceRemedy) => void;
}

export function VoiceNoticeStrip({
  notice,
  onDismissHint,
  onRemedy,
}: VoiceNoticeStripProps): React.JSX.Element {
  const { content, shown } = notice;
  const tone = content?.tone ?? VOICE_NOTICE_TONE.NOTICE;
  const remedy = content?.remedy;
  const address = remedy === undefined ? undefined : REMEDY_ADDRESS[remedy];
  const openLink = useOpenLink();
  return (
    <div className="voice-notice" data-shown={String(shown)} data-tone={tone} inert={!shown}>
      <div
        key={tone}
        className="voice-notice-row"
        role={tone === VOICE_NOTICE_TONE.ERROR ? "alert" : "status"}
      >
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
        {remedy === undefined ? null : address !== undefined ? (
          <ButtonLink
            variant={BUTTON_VARIANT.OUTLINE}
            href={address}
            onClick={linkPressOf(openLink, address)}
          >
            {VOICE_REMEDY_LABEL[remedy]}
          </ButtonLink>
        ) : (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            shape={BUTTON_SHAPE.ROUND}
            onClick={() => onRemedy(remedy)}
          >
            {VOICE_REMEDY_LABEL[remedy]}
          </Button>
        )}
      </div>
    </div>
  );
}
