import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../cn.js";
import { TEXT_ROLE_CLASS, TEXT_VARIANT, type TextVariant } from "./text-role.js";

export { TEXT_VARIANT, type TextVariant } from "./text-role.js";

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
 *   workspace (Tasks, Inbox) wears in place of an in-page title.
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
 *
 * It is drawn in the Tailwind theme's utilities (`text-role.ts` names each
 * role's), with no margin, so an `h1` set as a caption looks like a caption.
 * A tone and a face are said on the element (`data-tone`, `data-font`) and
 * drawn from there, so they outrank the role's own ink and face, `inherit`'s
 * included.
 */

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
  H5: "h5",
  H6: "h6",
} as const;

export type TextElement = (typeof TEXT_ELEMENT)[keyof typeof TEXT_ELEMENT];

/** What every role is drawn with: no margin, words broken anywhere at the box's edge, and a tone or a face asked on the element over the role's own. */
const TEXT_BASE =
  "luke-text m-0 wrap-anywhere data-[tone=muted]:text-muted-foreground data-[font=mono]:font-mono";

/** A role's own type, face, and ink; `inherit` takes all three from around it, and a group's heading is a tone below the words it heads. */
function roleClass(variant: TextVariant): string {
  if (variant === TEXT_VARIANT.INHERIT) return "[font:inherit] text-inherit";
  const ink = variant === TEXT_VARIANT.GROUP ? "text-muted-foreground" : "text-foreground";
  return `${TEXT_ROLE_CLASS[variant]} font-ui ${ink}`;
}

/** One line cut with an ellipsis at the box's edge, a flex item giving up its content's width so the cut can happen at all; from the start, the line is laid right to left so its end stays and read left to right, its words kept in their own direction by a `<bdi>`. */
function truncateClass(truncate: boolean | TextTruncate): string | undefined {
  if (truncate === false) return undefined;
  const cut = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
  return truncate === TEXT_TRUNCATE.START ? `${cut} [direction:rtl] text-left` : cut;
}

/** Words in `variant`, standing in `as`, the body in a paragraph unless asked. */
export function Text({
  variant = TEXT_VARIANT.BODY,
  as: Element = TEXT_ELEMENT.P,
  tone = TEXT_TONE.DEFAULT,
  font = TEXT_FONT.SANS,
  truncate = false,
  id,
  className,
  ref,
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
  /** The element the words stand in, for a caller that watches it (a heading scrolling out of view). */
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "id">): React.JSX.Element {
  return (
    <Element
      {...attributes}
      // Note that every element a role may stand in is a plain HTMLElement to a ref's reader, so the union's one element type is named here.
      ref={ref as Ref<HTMLDivElement> | undefined}
      className={cn(TEXT_BASE, roleClass(variant), truncateClass(truncate), className)}
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
