import {
  LIST_VARIANT,
  List,
  ListMotion,
  ListRow,
  SETTINGS_SECTION_FRAME,
  SETTINGS_SKELETON_CONTROL,
  SettingsControlSkeleton,
  SettingsSection,
  SKELETON_SHAPE,
  Skeleton,
  Toolbar,
} from "@luke/ui";
import { type ReactNode, useCallback, useRef } from "react";

/**
 * automation-list-frame.tsx -- the Automations list's boxes, which the list and its placeholders both draw.
 *
 * The list's toolbar, an owner's card, and a row's owner and next run each
 * stand in one component here, drawn by the list with what it
 * read and by its placeholder with blocks, so the placeholder is the list's
 * own shape rather than a copy of it. It stands outside the Automations
 * pages' chunk (`desktop-shell.tsx`), so what the window draws while that
 * chunk loads draws through the same boxes.
 */

/** A group of automations, one owner's, a page section below the one before it. */
const AUTOMATION_GROUP = "automation-group [.automation-group+&]:mt-page-section-gap";

/** An automation's or a run's metadata at its row's end, in a line of its own. */
export const AUTOMATION_ROW_META =
  "automation-row-meta inline-flex items-center gap-block-gap align-top";

/** How many rows the list's placeholder stands, enough to fill the top of its card. */
const SKELETON_ROWS = [
  { name: "38%", trigger: "52%" },
  { name: "46%", trigger: "40%" },
  { name: "30%", trigger: "58%" },
] as const;

/** How wide the placeholder owner's name and next run stand, inside the columns the list keeps for them. */
const SKELETON_META = { OWNER: "64px", NEXT: "96px" } as const;

/** A row's clock tile, at an actor mark's row size (`ACTOR_SIZE.ROW`, `avatar.css`). */
const SKELETON_ROW_MARK = "20px";

/** The owner's mark at its inline size (`OWNER_MARK_SIZE.INLINE`, a 16px tile or picture). */
const SKELETON_OWNER_MARK = "16px";

/** How wide the toolbar's two acts stand while the pages load: Create with an agent, and New automation. */
const SKELETON_ACTS = { AGENT: "168px", NEW: "140px" } as const;

/** The list's toolbar: its title, and its acts at its end, folded to their glyphs as its own width narrows. */
export function AutomationsToolbar({ children }: { children: ReactNode }): React.JSX.Element {
  // The toolbar's own width, which a container query reads, folds Create with an agent to its glyph before it crowds the title.
  return (
    <div className="automations-toolbar flex-none @container/automations-toolbar">
      <Toolbar
        title="Automations"
        actions={<div className="automations-acts contents">{children}</div>}
      />
    </div>
  );
}

/** The toolbar's acts while the pages load: blocks where Create with an agent and New automation will stand. */
export function AutomationsActsSkeleton(): React.JSX.Element {
  return (
    <>
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_ACTS.AGENT} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_ACTS.NEW} />
    </>
  );
}

/**
 * One owner's automations in a card, under its heading where `headed`.
 * Note that a lone owner's card is still a region named by its owner, as a
 * headed one is by its heading, so a reader moving by landmark hears whose
 * automations they are either way. Its rows move (`ListMotion`): one made
 * slides in, one deleted slides out, and the rows under it glide up.
 */
export function AutomationGroupCard({
  name,
  headed,
  children,
}: {
  name: string;
  headed: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const root = useRef<HTMLElement | null>(null);
  // Note that the card is a div or a section by whether it is headed, so the motion's root is held by a callback either takes.
  const hold = useCallback((node: HTMLElement | null) => {
    root.current = node;
  }, []);
  const card = (
    <ListMotion root={root}>
      <SettingsSection title={headed ? name : undefined} frame={SETTINGS_SECTION_FRAME.NONE}>
        <List label={name} variant={LIST_VARIANT.CARD} moves>
          {children}
        </List>
      </SettingsSection>
    </ListMotion>
  );
  return headed ? (
    <div ref={hold} className={AUTOMATION_GROUP}>
      {card}
    </div>
  ) : (
    <section ref={hold} className={AUTOMATION_GROUP} aria-label={name}>
      {card}
    </section>
  );
}

/** A row's metadata at its end: its owner's column, then its next run's, set against the switch. */
export function AutomationRowMeta({
  lead,
  owner,
  next,
}: {
  /** What is read before the columns and drawn nowhere: the working word where a run is. */
  lead?: ReactNode;
  owner: ReactNode;
  next: ReactNode;
}): React.JSX.Element {
  return (
    <span className={AUTOMATION_ROW_META}>
      {lead}
      {owner}
      <span className="automation-row-next inline-flex w-automation-next flex-none items-center justify-end gap-item-gap overflow-hidden">
        {next}
      </span>
    </span>
  );
}

/** Who owns an automation, in its column: their mark and their name. */
export function AutomationOwnerFrame({
  owner,
  mark,
  name,
}: {
  owner?: string | undefined;
  mark: ReactNode;
  name: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className="automation-owner inline-flex w-automation-owner flex-none items-center gap-item-gap overflow-hidden whitespace-nowrap"
      data-owner={owner}
    >
      {mark}
      {name}
    </span>
  );
}

/**
 * The list while it is first read, in its own card and rows: each row's
 * clock tile, its name over what fires it, its owner and its next run in their
 * columns, a narrow room's rows naming neither, and its switch, so the list
 * lands where the blocks stood. The rows open nothing.
 */
export function AutomationListSkeleton({ narrow }: { narrow: boolean }): React.JSX.Element {
  return (
    <AutomationGroupCard name="Automations" headed={false}>
      {SKELETON_ROWS.map(({ name, trigger }) => (
        <ListRow
          key={name}
          leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_ROW_MARK} />}
          title={<Skeleton width={name} />}
          description={<Skeleton width={trigger} />}
          meta={
            narrow ? undefined : (
              <AutomationRowMeta
                owner={
                  <AutomationOwnerFrame
                    mark={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_OWNER_MARK} />}
                    name={<Skeleton width={SKELETON_META.OWNER} />}
                  />
                }
                next={<Skeleton width={SKELETON_META.NEXT} />}
              />
            )
          }
          actions={<SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SWITCH} />}
        />
      ))}
    </AutomationGroupCard>
  );
}
