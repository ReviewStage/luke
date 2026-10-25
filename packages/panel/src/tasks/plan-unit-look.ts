/**
 * plan-unit-look.ts -- the classes a unit of the plan's document wears where it carries its section's byline and ⋯: a section's (`plan-body.tsx`) and the title's (`task-title.tsx`, `plan-document-editor.tsx`) alike.
 *
 * The unit is the group its byline and its ⋯ answer: both are faded out at
 * rest, on opacity alone so nothing moves, and shown while the pointer or
 * the keyboard is on their unit, and always on a screen with no hover. Note
 * that the pointer's own reveal is `group-hover`, which stands only where
 * there is a hover, because iOS plays a first tap as a hover and a reveal
 * spends the tap.
 */

/** The unit, which the byline row hangs from and its reveal answers. */
export const UNIT_ATTRIBUTED_CLASS = "plan-unit-attributed group/unit relative";

/** What a unit's byline and its ⋯ wear to be shown only while their unit is pointed at or focused. */
const UNIT_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-(--luke-duration-hover) ease-motion-exit group-focus-within/unit:opacity-100 group-hover/unit:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * A section's byline: a face and a short date, clipped past the ring an
 * actor's hover fill bleeds by so the ring is drawn whole. Note that its
 * writer's card and its time take the pointer although the line fades out,
 * because a pointer on them is on their section, which shows it.
 */
export const UNIT_BYLINE_CLASS = `plan-unit-byline actor-line min-w-0 max-w-plan-byline-room overflow-clip [overflow-clip-margin:var(--luke-focus-ring-room)] text-caption text-muted-foreground pointer-events-none [&>:is([data-actor-ref],button)]:pointer-events-auto ${UNIT_REVEAL_CLASS}`;

/** A unit's ⋯, at its row's end, shown as the byline is. */
export const UNIT_MORE_CLASS = `plan-unit-more pointer-events-auto flex flex-none ${UNIT_REVEAL_CLASS}`;
