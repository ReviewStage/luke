import type { ReactNode } from "react";

/**
 * text.tsx -- words set in one of the type roles every app shares, on whichever element their meaning asks for.
 *
 * A role is how the words look, an element is what they are, and the two are
 * chosen apart: a settings section's heading is an `h2` set in the section
 * role, a dialog's title an `h2` set in the dialog role, and a page whose
 * outline puts its title at `h1` still sets it in the title role. So a caller
 * never picks a heading level for its size, nor a size for its level. Each
 * role's size, leading, and weight are the profile's (`tokens/profiles.css`),
 * so the same words are the desktop's density in the window and the site's
 * on the web.
 *
 * A face and a truncation are the two things a caller may ask of the words
 * beyond their role: the monospace face for a technical token (a version, a
 * requirement, an identifier) rather than prose, and one line cut with an
 * ellipsis where a row has no room for a second. A truncated element still
 * holds every word, so what is read aloud is never cut; it truncates at its
 * own box's edge, so it stands as a block or a flex item.
 */

/** How words are set: body, a label, a caption, a section's or a dialog's heading, a page's title. */
export const TEXT_VARIANT = {
  BODY: "body",
  LABEL: "label",
  CAPTION: "caption",
  SECTION: "section",
  DIALOG: "dialog",
  TITLE: "title",
} as const;

export type TextVariant = (typeof TEXT_VARIANT)[keyof typeof TEXT_VARIANT];

/** The ink words are drawn in: the text's own, a step quieter, or quieter still. */
export const TEXT_TONE = {
  DEFAULT: "default",
  MUTED: "muted",
  SUBTLE: "subtle",
} as const;

export type TextTone = (typeof TEXT_TONE)[keyof typeof TEXT_TONE];

/** The face words are set in: the profile's own, or its monospace one for a technical token. */
export const TEXT_FONT = {
  SANS: "sans",
  MONO: "mono",
} as const;

export type TextFont = (typeof TEXT_FONT)[keyof typeof TEXT_FONT];

/** The elements words may stand in, by what they are rather than how they look. */
export const TEXT_ELEMENT = {
  P: "p",
  SPAN: "span",
  DIV: "div",
  H1: "h1",
  H2: "h2",
  H3: "h3",
  H4: "h4",
  H5: "h5",
  H6: "h6",
} as const;

export type TextElement = (typeof TEXT_ELEMENT)[keyof typeof TEXT_ELEMENT];

/** Words in `variant`, standing in `as`, the body in a paragraph unless asked. */
export function Text({
  variant = TEXT_VARIANT.BODY,
  as: Element = TEXT_ELEMENT.P,
  tone = TEXT_TONE.DEFAULT,
  font = TEXT_FONT.SANS,
  truncate = false,
  id,
  children,
}: {
  variant?: TextVariant;
  as?: TextElement;
  tone?: TextTone;
  font?: TextFont;
  /** Hold the words to one line, cut with an ellipsis where the box ends. */
  truncate?: boolean;
  /** The id a control or a region names itself by (`aria-labelledby`, `aria-describedby`). */
  id?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Element
      className="luke-text"
      data-variant={variant}
      data-tone={tone}
      data-font={font}
      data-truncate={truncate ? "" : undefined}
      id={id}
    >
      {children}
    </Element>
  );
}
