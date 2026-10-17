/**
 * back-link.tsx -- the way back from a page under an admin section to the
 * section itself.
 */

import { type AdminTab, plainLeftClick, tabHref } from "../routing";

/**
 * The way back from a page under a section to the section itself: a real
 * anchor, so a modified click still opens the section where the browser
 * would, and a plain one moves in place. It stands in the body role's size
 * and the muted ink, lifting to the text's own under the pointer.
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
    <a
      href={tabHref(tab)}
      className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
      onClick={(event) => {
        if (!plainLeftClick(event)) return;
        event.preventDefault();
        onBack();
      }}
    >
      <span aria-hidden="true">←</span> {label}
    </a>
  );
}
