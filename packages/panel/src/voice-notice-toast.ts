/**
 * voice-notice-toast.ts -- the voice's notices as toasts: a failure, a notice, or the hint that the Mac's output is off, standing in the window's one stack for as long as the voice says them.
 *
 * The voice says nothing about itself through a strip of its own: what
 * `useVoiceNotice` says stands as one toast in the window's stack
 * (`toast.tsx`), shown as it starts saying it and withdrawn once it stops,
 * after its linger, or at once for the volume hint. It persists in between,
 * since the voice's own clocks (`notice-strip.ts`) and who is heard decide
 * how long it stands, not a toast's hold. A failure is the danger tone,
 * which the stack says as an alert; a notice and the volume hint ask the
 * developer's attention, said politely. A failure with a remedy offers it as
 * the toast's action, and the volume hint offers "Hide". Words that change
 * are a new toast in the old one's place; words the developer dismissed stay
 * dismissed until the voice says something else.
 */

import { VOICE_REMEDY, VOICE_REMEDY_LABEL, type VoiceRemedy } from "@luke/features/words";
import { STATUS_TONE, type ToastTone } from "@luke/ui";
import { type RefObject, useEffect, useRef } from "react";
import { type ToastNotice, useToast, useWithdrawToast } from "./toast.js";
import {
  VOICE_NOTICE_TONE,
  type VoiceNoticeContent,
  type VoiceNoticePresentation,
  type VoiceNoticeTone,
} from "./use-voice-notice.js";

/** What dismisses the volume hint for this stretch of silence. */
const DISMISS_HINT_LABEL = "Hide";

/** What the voice's toast is about, by which it is withdrawn once the voice stops saying it. */
const VOICE_NOTICE_SUBJECT = "voice-toast";

/** OpenAI's billing page, where the key's account is given credit. */
export const OPENAI_BILLING_URL =
  "https://platform.openai.com/settings/organization/billing/overview";

/** The page a remedy opens, for those that open one: its toast action is a link to it. */
const VOICE_REMEDY_HREF: Partial<Record<VoiceRemedy, string>> = {
  [VOICE_REMEDY.ADD_OPENAI_CREDIT]: OPENAI_BILLING_URL,
};

/** The toast's tone for what the notice carries: a failure is refused work, and a notice or the hint asks the developer's attention. */
const TOAST_TONE_OF = {
  [VOICE_NOTICE_TONE.ERROR]: STATUS_TONE.DANGER,
  [VOICE_NOTICE_TONE.NOTICE]: STATUS_TONE.ATTENTION,
  [VOICE_NOTICE_TONE.VOLUME]: STATUS_TONE.ATTENTION,
} as const satisfies Record<VoiceNoticeTone, ToastTone>;

/** What the toast's action does, read at the press so it is never a stale render's. */
interface VoiceNoticePresses {
  /** Quiets the volume hint for this stretch of silence. */
  onDismissHint: () => void;
  /** Does what a failure's remedy offers, such as opening Settings where the OpenAI key goes. */
  onRemedy: (remedy: VoiceRemedy) => void;
}

export interface VoiceNoticeToastOptions extends VoiceNoticePresses {
  notice: VoiceNoticePresentation;
}

/** The toast a notice stands as: its words in its tone, with the hint's "Hide" or a failure's remedy as its action. */
function noticeToast(
  content: VoiceNoticeContent,
  presses: RefObject<VoiceNoticePresses>,
): ToastNotice {
  const { tone, words, remedy } = content;
  const toast = {
    words,
    tone: TOAST_TONE_OF[tone],
    subject: VOICE_NOTICE_SUBJECT,
    persists: true,
  } as const;
  if (tone === VOICE_NOTICE_TONE.VOLUME) {
    const onPress = () => presses.current.onDismissHint();
    return { ...toast, action: { label: DISMISS_HINT_LABEL, onPress } };
  }
  if (remedy === undefined) return toast;
  const onPress = () => presses.current.onRemedy(remedy);
  const href = VOICE_REMEDY_HREF[remedy];
  return { ...toast, action: { label: VOICE_REMEDY_LABEL[remedy], href, onPress } };
}

/** Stands the voice's notice as a toast while it is shown, and withdraws it once it is not. */
export function useVoiceNoticeToast({
  notice,
  onDismissHint,
  onRemedy,
}: VoiceNoticeToastOptions): void {
  const show = useToast();
  const withdraw = useWithdrawToast();
  const presses = useRef<VoiceNoticePresses>({ onDismissHint, onRemedy });
  useEffect(() => {
    presses.current = { onDismissHint, onRemedy };
  });
  const standing = notice.shown ? notice.content : undefined;
  // Note that the toast follows the notice's words rather than its object, because the voice hands a new one each frame.
  const tone = standing?.tone;
  const words = standing?.words;
  const remedy = standing?.remedy;
  useEffect(() => {
    if (tone === undefined || words === undefined) return;
    show(noticeToast({ tone, words, remedy }, presses));
    return () => withdraw(VOICE_NOTICE_SUBJECT);
  }, [tone, words, remedy, show, withdraw]);
}
