import {
  DetailPage,
  GAP,
  GROUP_HEADING,
  GroupHeader,
  Inline,
  List,
  ListMotion,
  ListRow,
  PAGE_FRAME,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  type StatusTone,
} from "@repo/ui";
import { type ReactNode, useRef } from "react";

const SKELETON_SECTION_NAME = "120px";

const SKELETON_HEAD = { NAME: "180px", LINE: "240px" } as const;

const SKELETON_FACE = "48px";

const SKELETON_MARK = "16px";

const SKELETON_ROWS = [
  { name: "46%", context: "96px" },
  { name: "38%", context: "120px" },
  { name: "54%", context: "80px" },
] as const;

export const PROFILE = "Profile";

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

export function PersonTitleSkeleton({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <PersonTitle
      face={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_FACE} />}
      name={name ?? <Skeleton width={SKELETON_HEAD.NAME} />}
    />
  );
}

export function PersonLineSkeleton(): React.JSX.Element {
  return <Skeleton width={SKELETON_HEAD.LINE} />;
}

export function PersonTop({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className="person-top">{children}</div>;
}

export function PersonBody({
  reading,
  children,
}: {
  reading: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={root}>
      <ListMotion root={root} reading={reading}>
        {children}
      </ListMotion>
    </div>
  );
}

export function PersonReadingSkeleton(): React.JSX.Element {
  return <SkeletonRegion label="Reading who they are…">{null}</SkeletonRegion>;
}

export function PersonSectionFrame({
  label,
  title,
  count,
  tone,
  children,
}: {
  label?: string | undefined;
  title: ReactNode;
  count?: number | undefined;
  tone?: StatusTone | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="home-section flex flex-col gap-tight-gap [.home-section+&]:mt-page-section-gap pointer-coarse:[&_.ui-list-row-main]:min-h-touch"
      aria-label={label}
    >
      <GroupHeader
        heading={label === undefined ? GROUP_HEADING.NONE : GROUP_HEADING.H2}
        label={title}
        count={count === undefined ? undefined : { value: count, tone }}
      >
        {children}
      </GroupHeader>
    </section>
  );
}

export function SectionSkeleton({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <PersonSectionFrame title={<Skeleton width={SKELETON_SECTION_NAME} />}>
      {children}
    </PersonSectionFrame>
  );
}

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
