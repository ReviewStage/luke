import { LANDING_TONE, type LandingTone } from "@luke/features/landing-outcome";
import React from "react";
import { FaceMark } from "../../face/face-mark.js";
import { CheckIcon, CloseIcon } from "../../face/glyphs.js";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * auth-mark.tsx -- the artwork an auth page opens with: one provider's mark, or Luke's, in a ring, with a badge on its corner once the flow has ended.
 *
 * The ring holds the provider the page is about, or Luke's own face where it
 * names none. A page that has settled wears a check, and one that failed a
 * cross in the danger red every failure is drawn in, each cut out of the card
 * it stands on; a page still on
 * its way, or still offering its choices, wears none. The whole is
 * decoration: an AuthPage hides it from a reader, and its title says on its
 * own how the flow stands.
 */

/** The glyph each tone's badge carries. */
const BADGE_GLYPH = {
  [LANDING_TONE.COMPLETE]: CheckIcon,
  [LANDING_TONE.DANGER]: CloseIcon,
} as const satisfies Record<LandingTone, () => React.JSX.Element>;

/** `provider`'s mark, or Luke's where it is left out, in a ring, badged where `tone` says how the flow ended. */
export function AuthMark({
  provider,
  tone,
}: {
  /** The provider the page is about; Luke's own face where it names none. */
  provider?: MarkProvider | undefined;
  /** How the flow ended; no badge while it is still on its way. */
  tone?: LandingTone | undefined;
}): React.JSX.Element {
  const Glyph = tone === undefined ? undefined : BADGE_GLYPH[tone];
  return (
    <span className="luke-auth-ring">
      {provider === undefined ? (
        <FaceMark />
      ) : (
        <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.SLOT} />
      )}
      {Glyph === undefined ? null : (
        <span className="luke-auth-badge" data-tone={tone}>
          <Glyph />
        </span>
      )}
    </span>
  );
}
