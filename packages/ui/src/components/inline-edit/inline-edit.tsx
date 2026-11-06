import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { isComposingKey } from "../../composing-key.js";
import { ShadcnInput } from "../../shadcn/input.js";

export const INLINE_EDIT_LOOK = {
  FIELD: "field",
  INPUT: "input",
  WELL: "well",
} as const;

export type InlineEditLook = (typeof INLINE_EDIT_LOOK)[keyof typeof INLINE_EDIT_LOOK];

export const INLINE_EDIT_FIELD =
  "ui-inline-edit pointer-coarse:data-[look]:text-touch " +
  "data-[look=field]:inline-block data-[look=field]:h-auto data-[look=field]:w-auto data-[look=field]:rounded-inline-edit data-[look=field]:border-0 data-[look=field]:bg-ground data-[look=field]:focus:bg-ground data-[look=field]:px-ui-4 data-[look=field]:py-px data-[look=field]:shadow-selected-edge data-[look=field]:text-body-size data-[look=field]:[font-family:inherit] data-[look=field]:[font-weight:revert-layer] data-[look=field]:[line-height:revert-layer] " +
  "data-[look=input]:-my-inline-edit-lift data-[look=input]:ms-inline-edit-reach data-[look=input]:h-ui-24 data-[look=input]:border-border data-[look=input]:px-ui-8 data-[look=input]:tracking-normal data-[look=input]:[font:inherit] " +
  "data-[look=well]:inline-block data-[look=well]:h-auto data-[look=well]:w-auto data-[look=well]:rounded-none data-[look=well]:border-0 data-[look=well]:bg-transparent data-[look=well]:focus:bg-transparent data-[look=well]:p-0 data-[look=well]:text-inherit data-[look=well]:outline-none data-[look=well]:[font:inherit]";

export interface InlineEditEnd {
  readonly value: string | undefined;
  readonly byKey: boolean;
}

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
      className={INLINE_EDIT_FIELD}
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
  label: string;
  editing: boolean;
  maxLength?: number | undefined;
  look?: InlineEditLook | undefined;
  placeholder?: string | undefined;
  endsOnBlur?: boolean | undefined;
  onEnd: (end: InlineEditEnd) => void;
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
