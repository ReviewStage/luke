import { LANDING_TONE, type LandingTone } from "@repo/features/landing-outcome";
import React from "react";
import { CheckIcon, CloseIcon, McpIcon } from "../../face/glyphs.js";
import { ProductMark } from "../../marks/product-mark.js";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * auth-mark.tsx -- the artwork an auth page opens with: one provider's mark, an outside MCP client's glyph, or the app's, in a ring, with a badge on its corner once the flow has ended.
 *
 * The ring holds the other party the page is about: a provider's mark, or
 * the MCP glyph Settings › MCP is drawn with for an outside agent asking
 * into the account, never a picture the agent names, since fetching one
 * would tell it who looked and its name is its own to claim. It holds the
 * product's own mark where the page names no other party. A page that has
 * settled wears a check, and one that failed a cross in the danger red every
 * failure is drawn in, each cut out of the card it stands on; a page still on
 * its way, or still offering its choices, wears none. The whole is
 * decoration: an AuthPage hides it from a reader, and its title says on its
 * own how the flow stands.
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base
 * (an avatar's disc holds a picture or initials, not a mark with a badge):
 * the ring, its mark at about two thirds of it on the card's surface inside
 * a hairline edge, and the badge on the ring's lower right, where its edge
 * crosses the diagonal, cut out of the card by a ring of the card's own
 * color. The sizes of the glyphs inside, which other components draw, are
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

/** The other party a ring holds: a provider, an outside MCP client, or neither, for the product's own mark. */
type AuthMarkParty =
  | {
      /** The provider the page is about; the product's own mark where it names none. */
      provider?: MarkProvider | undefined;
      mcpClient?: undefined;
    }
  | {
      provider?: undefined;
      /** An outside MCP client asking into the account, drawn as the MCP glyph. */
      mcpClient: true;
    };

/** The ring's artwork for `party`. */
function partyArt({ provider, mcpClient }: AuthMarkParty): React.JSX.Element {
  if (mcpClient === true) return <McpIcon />;
  if (provider === undefined) return <ProductMark inherit />;
  return <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.SLOT} />;
}

/** The other party's mark, or the app's where none is named, in a ring, badged where `tone` says how the flow ended. */
export function AuthMark({
  tone,
  ...party
}: AuthMarkParty & {
  /** How the flow ended; no badge while it is still on its way. */
  tone?: LandingTone | undefined;
}): React.JSX.Element {
  const Glyph = tone === undefined ? undefined : BADGE_GLYPH[tone];
  return (
    <span className="ui-auth-ring relative inline-grid place-items-center size-auth-ring box-border border border-border rounded-ui-full bg-surface text-foreground">
      {partyArt(party)}
      {Glyph === undefined ? null : (
        <span
          className={`ui-auth-badge absolute -right-ui-2 -bottom-ui-2 grid place-items-center size-ui-20 rounded-ui-full shadow-auth-badge ${tone === undefined ? "" : BADGE_TONE_CLASS[tone]}`}
          data-tone={tone}
        >
          <Glyph />
        </span>
      )}
    </span>
  );
}
