import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { isComposingKey } from "../../composing-key.js";
import { ShadcnInput } from "../../shadcn/input.js";

/**
 * inline-edit.tsx -- words edited where they are drawn: shown as they stand, and, while the caller says, a field over them in their place.
 *
 * The caller holds whether it is editing, as a list holds which row it is
 * renaming, and draws the words itself (`children`) where it shows them in
 * more than plain text. The field opens with all of them selected. Return
 * or the focus leaving keeps what was typed, and Escape keeps the words it
 * opened on; words left empty or unchanged change nothing. The field is
 * uncontrolled, so the caller hears only how the edit ended, once, by
 * whichever of those came first, and whether a key ended it, so it can hand
 * focus back to what it draws while not editing.
 *
 * Text arriving through an input method is composed in place before it is
 * committed, so the Return that commits a composition, and the Escape that
 * dismisses its candidates, are the input method's and end nothing. Note
 * that every Escape goes no further than the field, a composing one too,
 * because the surface behind it would otherwise answer it, leaving the page
 * the field stands on.
 *
 * The field is shadcn/ui's input (`../../shadcn/input.tsx`, on Base UI),
 * each look drawn over the input's own classes by a variant on its
 * `data-look`, which outranks them whatever order the utilities land in, in
 * Tailwind utilities over the theme's field roles; the field's line and
 * weight revert to the layers under the utilities, as no rule set them
 * before. It keeps the
 * `luke-inline-edit` name a container that sizes it finds it by. On a
 * finger's device each look takes at least 16px words, or iOS zooms the page
 * into the field the moment it is focused.
 */

/**
 * How the field is drawn: on a field's own ground inside a hairline, as a
 * list's row renames; in a settings input's box, as a settings row's label
 * renames; or bare in the type around it, where what it stands in is a well,
 * as a tab's is, and the caret alone marks the field.
 */
export const INLINE_EDIT_LOOK = {
  FIELD: "field",
  INPUT: "input",
  WELL: "well",
} as const;

export type InlineEditLook = (typeof INLINE_EDIT_LOOK)[keyof typeof INLINE_EDIT_LOOK];

/**
 * The field's looks, each keyed on its `data-look`. As a field, on the
 * ground inside the selected hairline in the body's size; as an input, a
 * settings input's box a label's line and 3px to spare each side tall, in
 * the label's own type, overhanging the label by those 3px and by its own
 * inset and edge at the start, so its words stand where the label's stood
 * and the row keeps its height; in a well, bare in the type around it, wearing
 * no ring, as no field does. How wide a field or a well
 * stands is its container's to say. Note that the field look's line and
 * weight are `revert-layer`, which hands them back to the engine's own for an
 * input (no `base` layer rule, `@luke/panel`'s base.css included, sets an
 * input's), because the input's `text-body` and `font-text` would set them
 * where the hand-written rule never did.
 */
const INLINE_EDIT =
  "luke-inline-edit pointer-coarse:data-[look]:text-touch " +
  "data-[look=field]:inline-block data-[look=field]:h-auto data-[look=field]:w-auto data-[look=field]:rounded-inline-edit data-[look=field]:border-0 data-[look=field]:bg-ground data-[look=field]:focus:bg-ground data-[look=field]:px-luke-4 data-[look=field]:py-px data-[look=field]:shadow-selected-edge data-[look=field]:text-body-size data-[look=field]:[font-family:inherit] data-[look=field]:[font-weight:revert-layer] data-[look=field]:[line-height:revert-layer] " +
  "data-[look=input]:-my-inline-edit-lift data-[look=input]:ms-inline-edit-reach data-[look=input]:h-luke-24 data-[look=input]:border-border data-[look=input]:px-luke-8 data-[look=input]:tracking-normal data-[look=input]:[font:inherit] " +
  "data-[look=well]:inline-block data-[look=well]:h-auto data-[look=well]:w-auto data-[look=well]:rounded-none data-[look=well]:border-0 data-[look=well]:bg-transparent data-[look=well]:focus:bg-transparent data-[look=well]:p-0 data-[look=well]:text-inherit data-[look=well]:outline-none data-[look=well]:[font:inherit]";

/** How an edit ended: the words to keep, if any changed, and whether a key ended it. */
export interface InlineEditEnd {
  readonly value: string | undefined;
  readonly byKey: boolean;
}

/** The field, opened over `value`; it ends once, by Return, Escape, or the focus leaving. */
function InlineEditField({
  value,
  label,
  maxLength,
  look,
  placeholder,
  endsOnBlur,
  onEnd,
}: {
  value: string;
  label: string;
  maxLength: number | undefined;
  look: InlineEditLook;
  placeholder: string | undefined;
  endsOnBlur: boolean;
  onEnd: (end: InlineEditEnd) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const ended = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const end = (keep: boolean, byKey: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const typed = field.current?.value.trim() ?? "";
    onEnd({ value: keep && typed !== "" && typed !== value ? typed : undefined, byKey });
  };

  return (
    <ShadcnInput
      ref={field}
      type="text"
      className={INLINE_EDIT}
      data-look={look}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      maxLength={maxLength}
      spellCheck={false}
      onBlur={endsOnBlur ? () => end(true, false) : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!isComposingKey(event)) end(false, true);
        }
        if (event.key === "Enter" && !isComposingKey(event)) {
          event.preventDefault();
          end(true, true);
        }
      }}
    />
  );
}

/** `value` shown, or drawn as `children`, until `editing`, and then a field named `label` editing it in place. */
export function InlineEdit({
  value,
  label,
  editing,
  maxLength,
  look = INLINE_EDIT_LOOK.FIELD,
  placeholder,
  endsOnBlur = true,
  onEnd,
  children,
}: {
  value: string;
  /** What the field is called for a reader. */
  label: string;
  editing: boolean;
  maxLength?: number | undefined;
  look?: InlineEditLook | undefined;
  /** What the empty field says, muted, as an empty line on a plan says what to write: a new thing's field, which opens empty. */
  placeholder?: string | undefined;
  /** Whether the focus leaving ends the edit; a field beside controls of its own, a new thing's whose chips it leaves for, is ended by its keys and its caller alone. */
  endsOnBlur?: boolean | undefined;
  /** How the edit ended; the caller stops editing here. */
  onEnd: (end: InlineEditEnd) => void;
  /** What stands in the field's place while not editing; `value` in plain text where none is given. */
  children?: ReactNode;
}): React.JSX.Element {
  if (!editing) return <>{children ?? value}</>;
  return (
    <InlineEditField
      value={value}
      label={label}
      maxLength={maxLength}
      look={look}
      placeholder={placeholder}
      endsOnBlur={endsOnBlur}
      onEnd={onEnd}
    />
  );
}
