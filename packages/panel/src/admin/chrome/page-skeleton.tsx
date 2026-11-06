import { readingWords } from "@repo/features/words";
import { SkeletonRegion } from "@repo/ui";
import { PageSections } from "./controls.js";
import { AdminPage, type AdminWayBack } from "./page-header.js";

export function PageSkeleton({
  title,
  note,
  back,
  controls,
  children,
}: {
  title: string;
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
