import { SkeletonRegion } from "@luke/ui";
import type { AdminTab } from "../routing";
import { SkeletonBody, type SkeletonShape } from "../skeleton";
import { BackLink } from "./back-link";
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
  description,
  account,
  onSignOut,
  controls,
  back,
  shapes,
}: {
  title: string;
  description?: string | undefined;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  controls: React.ReactNode;
  back?: { tab: AdminTab; label: string; onBack: () => void };
  shapes: readonly SkeletonShape[];
}): React.JSX.Element {
  return (
    <AdminPage
      title={title}
      description={description}
      account={account}
      accountSkeleton
      onSignOut={onSignOut}
      controls={controls}
    >
      {back === undefined ? null : (
        <BackLink tab={back.tab} label={back.label} onBack={back.onBack} />
      )}
      <SkeletonRegion label="Loading…">
        <SkeletonBody shapes={shapes} />
      </SkeletonRegion>
    </AdminPage>
  );
}
