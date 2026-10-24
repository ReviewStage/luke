import { readingWords } from "@luke/features/words";
import { SkeletonRegion } from "@luke/ui";
import { PageSections } from "./controls.js";
import { AdminPage, type AdminWayBack } from "./page-header.js";

/**
 * The loading stand-in every view wears: the page's own toolbar, its title,
 * its way back, and its controls, drawn for real, over `children`, the
 * page's own sections drawn before their answer, stacked as the loaded page
 * stacks them. The frame and the sections are the loaded page's own, so the
 * two cannot drift apart. The sections stand in one region that says the
 * page is loading.
 */
export function PageSkeleton({
  title,
  note,
  back,
  controls,
  children,
}: {
  title: string;
  /** What the page covers, after its title, as the loaded page says it. */
  note?: string | undefined;
  back?: AdminWayBack | undefined;
  controls: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <AdminPage title={title} note={note} back={back} controls={controls}>
      <SkeletonRegion label={readingWords("this page")}>
        <PageSections>{children}</PageSections>
      </SkeletonRegion>
    </AdminPage>
  );
}
