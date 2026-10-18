/**
 * back-link.tsx -- the way back from a page under an admin section to the
 * section itself.
 */

import { TEXT_VARIANT, TextLink } from "@luke/ui";
import { type AdminTab, plainLeftClick, tabHref } from "../routing";

/**
 * The way back from a page under a section to the section itself: a real
 * anchor, so a modified click still opens the section where the browser
 * would, and a plain one moves in place. A quiet link in the body role.
 */
export function BackLink({
  tab,
  label,
  onBack,
}: {
  tab: AdminTab;
  label: string;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="mt-8">
      <TextLink
        href={tabHref(tab)}
        variant={TEXT_VARIANT.BODY}
        onClick={(event) => {
          if (!plainLeftClick(event)) return;
          event.preventDefault();
          onBack();
        }}
      >
        <span aria-hidden="true">←</span> {label}
      </TextLink>
    </div>
  );
}
