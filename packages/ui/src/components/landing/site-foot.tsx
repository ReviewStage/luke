/**
 * site-foot.tsx -- the public site's foot under every page: its facts and its links, then its notice under a rule.
 *
 * The facts (a license, the Macs it runs on) and the links stand in one
 * row parted by dots. A dot is drawn before every item in the gap after the
 * one before it, and the row clips what stands past its start, so a line
 * the row wraps onto never opens on a dot. Under 640px of room the facts
 * keep a line of their own and the links stand in two columns of rows a
 * control tall, with no dots, so each is a finger's target. Its notice sits
 * under its own rule at the column's foot, the way stagereview.app closes
 * its footer. It is drawn in `landing.css`, inside the frame's foot
 * (`SiteFrame`'s `footer`).
 */

import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TextLink, type TextLinkCurrent } from "../text-link/text-link.js";

/** One link of the foot: its words, where it goes, and whether the reader is there. */
export type SiteFootLink = {
  readonly label: string;
  readonly href: string;
  readonly current?: TextLinkCurrent | undefined;
};

/** The site's foot: `facts` and `links` in one dotted row, over the `notice` under its rule. */
export function SiteFootLinks({
  facts,
  links,
  notice,
}: {
  /** Plain words beside the links, such as the license. */
  facts: readonly string[];
  /** The site's closing links, each unique by its address. */
  links: readonly SiteFootLink[];
  /** The line under the rule, such as the copyright. */
  notice: ReactNode;
}): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.DIV}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      font={TEXT_FONT.MONO}
    >
      <div className="ui-landing-foot-row">
        <p className="ui-landing-foot-facts">
          {facts.map((fact) => (
            <span key={fact} className="ui-landing-foot-item">
              {fact}
            </span>
          ))}
        </p>
        <ul className="ui-landing-foot-list">
          {links.map((link) => (
            <li key={link.href} className="ui-landing-foot-item">
              <TextLink href={link.href} current={link.current}>
                {link.label}
              </TextLink>
            </li>
          ))}
        </ul>
      </div>
      <p className="ui-landing-foot-notice">{notice}</p>
    </Text>
  );
}
