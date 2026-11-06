export const UNIT_ATTRIBUTED_CLASS = "description-unit-attributed group/unit relative";

const UNIT_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-focus-within/unit:opacity-100 group-hover/unit:opacity-100 no-hover:opacity-100";

export const UNIT_BYLINE_CLASS = `description-unit-byline actor-line min-w-0 max-w-description-byline-room overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)] text-caption text-muted-foreground pointer-events-none [&>:is([data-actor-ref],button)]:pointer-events-auto ${UNIT_REVEAL_CLASS}`;

export const UNIT_MORE_CLASS = `description-unit-more pointer-events-auto flex flex-none ${UNIT_REVEAL_CLASS}`;
