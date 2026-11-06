import { LANDING_TONE, type LandingTone } from "@repo/features/landing-outcome";
import React from "react";
import { CheckIcon, CloseIcon, McpIcon } from "../../face/glyphs.js";
import { ProductMark } from "../../marks/product-mark.js";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";

void React;

const BADGE_TONE_CLASS = {
  [LANDING_TONE.COMPLETE]: "bg-complete text-surface",
  [LANDING_TONE.DANGER]: "bg-auth-badge-danger text-auth-badge-on-danger",
} as const satisfies Record<LandingTone, string>;

const BADGE_GLYPH = {
  [LANDING_TONE.COMPLETE]: CheckIcon,
  [LANDING_TONE.DANGER]: CloseIcon,
} as const satisfies Record<LandingTone, () => React.JSX.Element>;

type AuthMarkParty =
  | {
      provider?: MarkProvider | undefined;
      mcpClient?: undefined;
    }
  | {
      provider?: undefined;
      mcpClient: true;
    };

function partyArt({ provider, mcpClient }: AuthMarkParty): React.JSX.Element {
  if (mcpClient === true) return <McpIcon />;
  if (provider === undefined) return <ProductMark inherit />;
  return <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.SLOT} />;
}

export function AuthMark({
  tone,
  ...party
}: AuthMarkParty & {
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
