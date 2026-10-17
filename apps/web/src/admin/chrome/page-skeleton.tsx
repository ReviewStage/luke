import { SkeletonRegion } from "@luke/ui";
import { type AdminTab, plainLeftClick, tabHref } from "../routing";
import { SkeletonBody, type SkeletonShape } from "../skeleton";
import { AdminPage, type ViewerAccount } from "./page-header";

/**
 * The loading stand-in every view wears: the page's own frame and controls,
 * drawn for real, over the bones its own sections name. The frame is the
 * loaded page's own component, so the two cannot drift apart — which is what
 * four page-shaped copies of it could not promise. The bones stand in one
 * region that says the page is loading; the way back stays outside it, a link
 * to press rather than part of what is being read.
 */
export function PageSkeleton({
  title,
  account,
  onSignOut,
  controls,
  back,
  shapes,
}: {
  title: string;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  controls: React.ReactNode;
  back?: { tab: AdminTab; label: string; onBack: () => void };
  shapes: readonly SkeletonShape[];
}): React.JSX.Element {
  return (
    <AdminPage
      title={title}
      account={account}
      accountSkeleton
      onSignOut={onSignOut}
      controls={controls}
    >
      {back === undefined ? null : (
        <a
          href={tabHref(back.tab)}
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={(event) => {
            if (!plainLeftClick(event)) return;
            event.preventDefault();
            back.onBack();
          }}
        >
          <span aria-hidden="true">←</span> {back.label}
        </a>
      )}
      <SkeletonRegion label="Loading…">
        <SkeletonBody shapes={shapes} />
      </SkeletonRegion>
    </AdminPage>
  );
}
