import { LIST_VARIANT, List, ListRow, SKELETON_SHAPE, Skeleton, SkeletonRegion } from "@luke/ui";

/**
 * automations-skeleton.tsx -- the Automations list as quiet blocks while it is read.
 *
 * It is its own file because two places draw it: the list's page while its
 * first read is out, and the window's shell while the pages' code is still
 * loading (`desktop-shell.tsx`), which must not pull the pages' chunk in to
 * draw it.
 */

/** What the placeholder rows say to a reader while the automations are first read. */
const READING_AUTOMATIONS = "Reading your automations…";

/** How wide each placeholder row's name and the trigger under it stand, as shares of their lines. */
const SKELETON_ROWS = [
  { name: "44%", trigger: "62%" },
  { name: "32%", trigger: "48%" },
  { name: "38%", trigger: "56%" },
] as const;

/** How wide a placeholder row's glyph stands: the row's own glyph size. */
const SKELETON_GLYPH = "var(--luke-control-icon)";

/** How wide a placeholder row's owner and next run stand, as wide as "Personal" and "in 2h". */
const SKELETON_OWNER = "64px";
const SKELETON_WHEN = "40px";

/**
 * The list while it is first read: one card of rows in an automation's own
 * row, a block where its glyph, its name, its trigger, its owner, and its
 * next run will stand, so the automations land where the blocks stood. The
 * rows open nothing, and the region says what is being read.
 */
export function AutomationListSkeleton(): React.JSX.Element {
  return (
    <div className="automations-skeleton">
      <SkeletonRegion label={READING_AUTOMATIONS}>
        <List label="Automations" variant={LIST_VARIANT.CARD}>
          {SKELETON_ROWS.map(({ name, trigger }) => (
            <ListRow
              key={name}
              leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_GLYPH} />}
              title={<Skeleton width={name} />}
              description={<Skeleton width={trigger} />}
              meta={
                <span className="automation-row-meta">
                  <Skeleton width={SKELETON_OWNER} />
                  <Skeleton width={SKELETON_WHEN} />
                </span>
              }
            />
          ))}
        </List>
      </SkeletonRegion>
    </div>
  );
}
