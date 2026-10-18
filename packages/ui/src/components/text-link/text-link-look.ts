/**
 * text-link-look.ts -- how a TextLink looks, apart from the component, so a link an engine draws without React wears the same look.
 */

/** Where a link stands, which is how it looks. */
export const TEXT_LINK_LOOK = {
  QUIET: "quiet",
  UNDERLINED: "underlined",
  HEADING: "heading",
} as const;

export type TextLinkLook = (typeof TEXT_LINK_LOOK)[keyof typeof TEXT_LINK_LOOK];
