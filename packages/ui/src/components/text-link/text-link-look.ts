export const TEXT_LINK_LOOK = {
  QUIET: "quiet",
  UNDERLINED: "underlined",
  HEADING: "heading",
} as const;

export type TextLinkLook = (typeof TEXT_LINK_LOOK)[keyof typeof TEXT_LINK_LOOK];
