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

export type TextRole = Exclude<TextVariant, typeof TEXT_VARIANT.INHERIT>;

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
