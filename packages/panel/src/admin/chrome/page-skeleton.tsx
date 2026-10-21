import { SkeletonRegion } from "@luke/ui";
import { SkeletonBody, type SkeletonShape } from "../skeleton.js";
import { AdminPage, type AdminWayBack } from "./page-header.js";

/**
 * The loading stand-in every view wears: the page's own toolbar, its title,
 * its way back, and its controls, drawn for real, over the bones its own
 * sections name. The frame is the loaded page's own component, so the two
 * cannot drift apart — which is what four page-shaped copies of it could not
 * promise. The bones stand in one region that says the page is loading.
 */
export function PageSkeleton({
  title,
  note,
  back,
  controls,
  shapes,
}: {
  title: string;
  /** What the page covers, after its title, as the loaded page says it. */
  note?: string | undefined;
  back?: AdminWayBack | undefined;
  controls: React.ReactNode;
  shapes: readonly SkeletonShape[];
}): React.JSX.Element {
  return (
    <AdminPage title={title} note={note} back={back} controls={controls}>
      <SkeletonRegion label="Loading…">
        <SkeletonBody shapes={shapes} />
      </SkeletonRegion>
    </AdminPage>
  );
}
