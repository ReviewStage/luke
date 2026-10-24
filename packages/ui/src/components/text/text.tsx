import type { HTMLAttributes, ReactNode } from "react";

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
 * on the web. A role has one weight, whatever draws it.
 *
 * The roles, by the job they do:
 *
 * - `TITLE`: a document's own title in the page, a person's, Settings', the
 *   plan's. `TOOLBAR_TITLE`: the name in the window's top bar, which a
 *   workspace (Tasks, Inbox, Chat) wears in place of an in-page title.
 * - `DIALOG`: a dialog's or a pane's heading. `SECTION`: a heading on a page.
 *   `GROUP`: the small heading over a group of rows in a sidebar, a menu, a
 *   picker, or a settings list.
 * - `LABEL`: a row's name, a button's words, a message's author. `BODY`:
 *   words read as a sentence, and a dense row's name. `CAPTION`: a row's
 *   detail, a time, a count, any note beside what it is about.
 *
 * A badge's, a chip's, and a tooltip's words are the caption's size at the
 * `tag` weight (`--luke-type-tag-*`), which those components read themselves.
 *
 * Words that count or tell time, or change while a reader watches, are
 * drawn in tabular figures by the component that draws them (`Time`,
 * `Badge`, a count part), so a parent need not remember to.
 *
 * A face and a truncation are the two things a caller may ask of the words
 * beyond their role: the monospace face for a technical token (a version, a
 * requirement, an identifier) rather than prose, and one line cut with an
 * ellipsis where a row has no room for a second, or, for a path, cut from its
 * start so its last part stays. A truncated element still
 * holds every word, so what is read aloud is never cut; it truncates at its
 * own box's edge, so it stands as a block or a flex item.
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

/** The ink words are drawn in: the text's own, or a step quieter. */
export const TEXT_TONE = {
  DEFAULT: "default",
  MUTED: "muted",
} as const;

export type TextTone = (typeof TEXT_TONE)[keyof typeof TEXT_TONE];

/** The face words are set in: the profile's own, or its monospace one for a technical token. */
export const TEXT_FONT = {
  SANS: "sans",
  MONO: "mono",
} as const;

export type TextFont = (typeof TEXT_FONT)[keyof typeof TEXT_FONT];

/** Where a truncated line is cut where not at its end (`truncate`): for a path whose last part is its name, at its start. */
export const TEXT_TRUNCATE = {
  START: "start",
} as const;

export type TextTruncate = (typeof TEXT_TRUNCATE)[keyof typeof TEXT_TRUNCATE];

/** The elements words may stand in, by what they are rather than how they look. */
export const TEXT_ELEMENT = {
  P: "p",
  SPAN: "span",
  DIV: "div",
  H1: "h1",
  H2: "h2",
  H3: "h3",
  H4: "h4",
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
  className,
  children,
  ...attributes
}: {
  variant?: TextVariant;
  as?: TextElement;
  tone?: TextTone;
  font?: TextFont;
  /** Hold the words to one line, cut with an ellipsis where the box ends, or at the start of the words (`start`) to keep their end. */
  truncate?: boolean | TextTruncate;
  /** The id a control or a region names itself by (`aria-labelledby`, `aria-describedby`). */
  id?: string | undefined;
  /** A hook for the caller's own layout (a flex share, a margin), beside the shared class. */
  className?: string | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "id">): React.JSX.Element {
  return (
    <Element
      {...attributes}
      className={className === undefined ? "luke-text" : `luke-text ${className}`}
      data-variant={variant}
      data-tone={tone}
      data-font={font}
      data-truncate={
        truncate === TEXT_TRUNCATE.START ? TEXT_TRUNCATE.START : truncate ? "" : undefined
      }
      id={id}
    >
      {children}
    </Element>
  );
}
