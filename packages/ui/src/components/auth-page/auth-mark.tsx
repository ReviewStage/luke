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
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base
 * (an avatar's disc holds a picture or initials, not a mark with a badge):
 * the ring, its mark at about two thirds of it on the card's surface inside
 * a hairline edge, and the badge on the ring's lower right, where its edge
 * crosses the diagonal, cut out of the card by a ring of the card's own
 * colour. The sizes of the glyphs inside, which other components draw, are
 * `auth-page.css`'s.
 */

/** Each tone's badge: a settled flow's complete green, a failed one's danger red. */
const BADGE_TONE_CLASS = {
  [LANDING_TONE.COMPLETE]: "bg-complete text-surface",
  [LANDING_TONE.DANGER]: "bg-auth-badge-danger text-auth-badge-on-danger",
} as const satisfies Record<LandingTone, string>;

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
    <span className="luke-auth-ring relative inline-grid place-items-center size-auth-ring box-border border border-border rounded-luke-full bg-surface text-foreground">
      {provider === undefined ? (
        <FaceMark />
      ) : (
        <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.SLOT} />
      )}
      {Glyph === undefined ? null : (
        <span
          className={`luke-auth-badge absolute -right-luke-2 -bottom-luke-2 grid place-items-center size-luke-20 rounded-luke-full shadow-auth-badge ${tone === undefined ? "" : BADGE_TONE_CLASS[tone]}`}
          data-tone={tone}
        >
          <Glyph />
        </span>
      )}
    </span>
  );
}
