import { SkeletonRegion } from "@luke/ui";
import { SkeletonBody, type SkeletonShape } from "../skeleton";
import { AdminPage, type AdminWayBack } from "./page-header";

/**
 * The loading stand-in every view wears: the page's own toolbar, its title,
 * its way back, and its controls, drawn for real, over the bones its own
 * sections name. The frame is the loaded page's own component, so the two
 * cannot drift apart — which is what four page-shaped copies of it could not
 * promise. The bones stand in one region that says the page is loading.
 */
export function PageSkeleton({
  title,
  back,
  controls,
  shapes,
}: {
  title: string;
  back?: AdminWayBack | undefined;
  controls: React.ReactNode;
  shapes: readonly SkeletonShape[];
}): React.JSX.Element {
  return (
    <AdminPage title={title} back={back} controls={controls}>
      <SkeletonRegion label="Loading…">
        <SkeletonBody shapes={shapes} />
      </SkeletonRegion>
    </AdminPage>
  );
}
