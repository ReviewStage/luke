/**
 * text-role.ts -- the type roles words are set in, and the utilities each role draws with, which `Text` and `TextLink` share.
 *
 * A role's size, leading, and weight are the profile's (`tokens/profiles.css`),
 * read through the Tailwind theme's names for them (`text-label`,
 * `font-label`), so a role is drawn the same by whichever component sets
 * words in it. A heading role with tracking carries the title's. The body's
 * weight is `font-text`, since `font-body` names the face.
 */

/** How words are set: body, a label, a caption, a group's, a section's or a dialog's heading, a page's or the top bar's title, or as their surroundings set them (`inherit`, for words cut to a line inside a row that has already set its type and ink). */
export const TEXT_VARIANT = {
  BODY: "body",
  LABEL: "label",
  CAPTION: "caption",
  GROUP: "group",
  SECTION: "section",
  DIALOG: "dialog",
  TOOLBAR_TITLE: "toolbar-title",
  TITLE: "title",
  INHERIT: "inherit",
} as const;

export type TextVariant = (typeof TEXT_VARIANT)[keyof typeof TEXT_VARIANT];

/** The roles that set a size, a leading, and a weight of their own: every one but `inherit`. */
export type TextRole = Exclude<TextVariant, typeof TEXT_VARIANT.INHERIT>;

/** Each role's size and leading, its weight, and a title's tracking, as utilities. */
export const TEXT_ROLE_CLASS = {
  [TEXT_VARIANT.BODY]: "text-body font-text",
  [TEXT_VARIANT.LABEL]: "text-label font-label",
  [TEXT_VARIANT.CAPTION]: "text-caption font-caption",
  [TEXT_VARIANT.GROUP]: "text-group font-group",
  [TEXT_VARIANT.SECTION]: "text-section font-section",
  [TEXT_VARIANT.DIALOG]: "text-dialog font-dialog",
  [TEXT_VARIANT.TOOLBAR_TITLE]: "text-toolbar-title font-toolbar-title tracking-title",
  [TEXT_VARIANT.TITLE]: "text-title font-title tracking-title",
} as const satisfies Record<TextRole, string>;
