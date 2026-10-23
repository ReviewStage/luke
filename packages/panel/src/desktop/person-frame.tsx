import {
  BackIcon,
  DetailPage,
  IconButton,
  List,
  ListRow,
  ONE_LINE_ELEMENT,
  OneLine,
  PAGE_FRAME,
  PageToolbar,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
} from "@luke/ui";
import type { ReactNode } from "react";
import { PhoneHead } from "./phone-head.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";

/**
 * person-frame.tsx -- a person's page's boxes, which the page and its placeholders both draw.
 *
 * The page's toolbar, its head, and its sections each stand in one
 * component here, drawn by the page with what it read and by its
 * placeholders with blocks in what is still being read, so a placeholder is
 * the page's own shape rather than a copy of it. It stands outside the
 * page's chunk (`pages-on-demand.ts`), so what the window draws while that
 * chunk loads draws through the same boxes.
 */

/** How wide a placeholder section's name and its count stand, as a short section name and a number do. */
const SKELETON_SECTION = { NAME: "120px", COUNT: "12px" } as const;

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

/** The page's toolbar: their name as the page's title, and the page's acts, where it has any, at its end. */
export function PersonToolbar({
  name,
  words,
  phoneBack,
  children,
}: {
  name: ReactNode;
  /** The name's words, which the title reads whole where it cuts them short. */
  words?: string | undefined;
  /** A phone's way back, which heads the page as a phone's page (`phone-head.tsx`): the back's glyph, the name centred, and the page's one ⋯ as `children`; none elsewhere. */
  phoneBack?: TaskHeadBack | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  if (phoneBack !== undefined) {
    const back = `Back to ${phoneBack.label}`;
    return (
      <PhoneHead
        place="person-page"
        start={
          <Tooltip label={back}>
            <IconButton icon={<BackIcon />} label={back} onClick={phoneBack.onPress} />
          </Tooltip>
        }
        title={
          <OneLine as={ONE_LINE_ELEMENT.H1} className="desktop-toolbar-title" words={words}>
            {name}
          </OneLine>
        }
        end={children}
      />
    );
  }
  return (
    <PageToolbar
      heading={
        <OneLine as={ONE_LINE_ELEMENT.H1} className="desktop-toolbar-title" words={words}>
          {name}
        </OneLine>
      }
      actions={children}
    />
  );
}

/** The block standing in the page's title while nothing names them yet. */
export function PersonNameSkeleton(): React.JSX.Element {
  return <Skeleton width={SKELETON_HEAD.NAME} />;
}

/** The page's top, which the sections stand a section's gap under: their head. */
export function PersonTop({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="person-top">{children}</div>;
}

/** The page's head: their face, their name over who they are here. */
export function PersonHeadFrame({
  face,
  name,
  line,
}: {
  face: ReactNode;
  name: ReactNode;
  line: ReactNode;
}): React.JSX.Element {
  return (
    <header className="person-head">
      {face}
      <div className="person-head-copy">
        <p className="person-head-name">{name}</p>
        {line}
      </div>
    </header>
  );
}

/** The head while the members are read: a block where their face, their name, and who they are here will stand. */
export function PersonHeadSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading who they are…">
      <PersonHeadFrame
        face={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_FACE} />}
        name={
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.TITLE}>
            <Skeleton width={SKELETON_HEAD.NAME} />
          </Text>
        }
        line={
          <Text variant={TEXT_VARIANT.CAPTION}>
            <Skeleton width={SKELETON_HEAD.LINE} />
          </Text>
        }
      />
    </SkeletonRegion>
  );
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
  count: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="home-section" aria-label={label}>
      <header className="person-section-head">
        <Text
          as={label === undefined ? TEXT_ELEMENT.SPAN : TEXT_ELEMENT.H2}
          variant={TEXT_VARIANT.SECTION}
          tone={TEXT_TONE.MUTED}
        >
          {title}
        </Text>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
          {count}
        </Text>
      </header>
      {children}
    </section>
  );
}

/** A section still being read: blocks where its name and count will stand, over the placeholder rows in `children`. */
export function SectionSkeleton({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <PersonSectionFrame
      title={<Skeleton width={SKELETON_SECTION.NAME} />}
      count={<Skeleton width={SKELETON_SECTION.COUNT} />}
    >
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
 * A person's page while its chunk loads: its frame, their name where the
 * place that opened it knew it, and their head as blocks, as the page
 * stands it until the members are read.
 */
export function PersonPageSkeleton({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label={name ?? PROFILE}
      toolbar={<PersonToolbar name={name ?? <PersonNameSkeleton />} words={name} />}
    >
      <PersonTop>
        <PersonHeadSkeleton />
      </PersonTop>
    </DetailPage>
  );
}
