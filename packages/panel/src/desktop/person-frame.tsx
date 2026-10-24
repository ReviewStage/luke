import {
  DetailPage,
  GAP,
  GROUP_HEADING,
  GroupHeader,
  Inline,
  List,
  ListRow,
  PAGE_FRAME,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
} from "@luke/ui";
import type { ReactNode } from "react";

/**
 * person-frame.tsx -- a person's page's boxes, which the page and its placeholders both draw.
 *
 * The page's title, its content's top, and its sections each stand in one
 * component here, drawn by the page with what it read and by its
 * placeholders with blocks in what is still being read, so a placeholder is
 * the page's own shape rather than a copy of it. The page names its person
 * once, as its header's title (`PageHeader`, the page's one `h1`). It stands outside the
 * page's chunk (`pages-on-demand.ts`), so what the window draws while that
 * chunk loads draws through the same boxes.
 */

/** How wide a placeholder section's name stands, as a short section name does. */
const SKELETON_SECTION_NAME = "120px";

/** How wide the placeholder head's name and the line under it stand, as a name and a role and email do. */
const SKELETON_HEAD = { NAME: "180px", LINE: "240px" } as const;

/** The placeholder head's face, at the page's size (`.luke-avatar[data-size="page"]`). */
const SKELETON_FACE = "48px";

/** A placeholder row's tile, an automation's or a repository's at its inline size (`.home-row-picture`). */
const SKELETON_MARK = "16px";

/** How wide each placeholder row's name and what is said beside it stand, so the rows read as rows of their own. */
const SKELETON_ROWS = [
  { name: "46%", context: "96px" },
  { name: "38%", context: "120px" },
  { name: "54%", context: "80px" },
] as const;

/** What the page is called where it cannot name the person yet. */
export const PROFILE = "Profile";

/** The page's title, the page's one `h1`: their face beside their name, the badge that says it is the reader left to the line under it. */
export function PersonTitle({
  face,
  name,
}: {
  face: ReactNode;
  name: ReactNode;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      {face}
      {name}
    </Inline>
  );
}

/** The title while the members are read: a block where their face stands, and their name where the place that opened the page knew it, else a block. */
export function PersonTitleSkeleton({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <PersonTitle
      face={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_FACE} />}
      name={name ?? <Skeleton width={SKELETON_HEAD.NAME} />}
    />
  );
}

/** The line under the title while the members are read: a block where who they are here will stand. */
export function PersonLineSkeleton(): React.JSX.Element {
  return <Skeleton width={SKELETON_HEAD.LINE} />;
}

/**
 * The page's top, which the sections stand a section's gap under: it holds
 * the note that stands where the profile could not be read, and the region
 * that says the members are being read (`PersonReadingSkeleton`).
 */
export function PersonTop({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className="person-top">{children}</div>;
}

/** What says, to a reader, that the members are read: the header's blocks are decoration. */
export function PersonReadingSkeleton(): React.JSX.Element {
  return <SkeletonRegion label="Reading who they are…">{null}</SkeletonRegion>;
}

/** A section: its name and count over what it holds, a region named `label` where it names one. */
export function PersonSectionFrame({
  label,
  title,
  count,
  children,
}: {
  label?: string | undefined;
  title: ReactNode;
  count?: number | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="home-section" aria-label={label}>
      <GroupHeader
        heading={label === undefined ? GROUP_HEADING.NONE : GROUP_HEADING.H2}
        label={title}
        count={count === undefined ? undefined : { value: count }}
      >
        {children}
      </GroupHeader>
    </section>
  );
}

/** A section still being read: a block where its name will stand, over the placeholder rows in `children`. */
export function SectionSkeleton({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <PersonSectionFrame title={<Skeleton width={SKELETON_SECTION_NAME} />}>
      {children}
    </PersonSectionFrame>
  );
}

/** A list still being read, which `label` names: rows of a tile, a name, and what is said beside it, as a task's or an automation's row stands. */
export function RowsSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <SectionSkeleton>
      <SkeletonRegion label={label}>
        <List label={label}>
          {SKELETON_ROWS.map(({ name, context }) => (
            <ListRow
              key={name}
              leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_MARK} />}
              title={<Skeleton width={name} />}
              meta={<Skeleton width={context} />}
            />
          ))}
        </List>
      </SkeletonRegion>
    </SectionSkeleton>
  );
}

/**
 * A person's page while its chunk loads: its header, their name where the
 * place that opened it knew it, and their face and who they are as blocks,
 * as the page stands it until the members are read.
 */
export function PersonPageSkeleton({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <DetailPage
      frame={PAGE_FRAME.PAGE}
      title={<PersonTitleSkeleton name={name} />}
      description={<PersonLineSkeleton />}
    >
      <PersonTop>
        <PersonReadingSkeleton />
      </PersonTop>
    </DetailPage>
  );
}
