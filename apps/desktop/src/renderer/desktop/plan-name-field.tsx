import { PLAN_BOUNDS } from "@sidecar/hosted/plan-wire";
import { useLayoutEffect, useRef, useState } from "react";
import { RENAME_FAILED_NOTE } from "../planning/planning-model";

/**
 * plan-name-field.tsx -- a plan's name edited where it is drawn, in the sidebar's row or on the open plan's toolbar, the way a desktop list renames in place.
 *
 * The field opens over the name with all of it selected. Return or a press
 * elsewhere keeps what was typed, and Escape keeps the name it opened on; a
 * name left empty or unchanged renames nothing. Its words are an input's
 * value, which session replay masks as it masks every input.
 */

/** How an edit ended: what to rename the plan to, if anything, and whether a key ended it, so focus goes back to the name. */
export interface NameEdit {
  readonly name: string | undefined;
  readonly byKey: boolean;
}

/** The field itself. It ends once, whichever of Return, Escape, or the focus leaving comes first. */
export function PlanNameField({
  name,
  className,
  onEnd,
}: {
  name: string;
  className: string;
  onEnd: (edit: NameEdit) => void;
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
    onEnd({ name: keep && typed !== "" && typed !== name ? typed : undefined, byKey });
  };

  return (
    <input
      ref={field}
      type="text"
      className={className}
      aria-label="Plan name"
      defaultValue={name}
      maxLength={PLAN_BOUNDS.MAX_NAME_CHARS}
      spellCheck={false}
      onBlur={() => end(true, false)}
      onKeyDown={(event) => {
        // Note that Escape goes no further than the field, because the
        // window's own Escape would otherwise leave the plan as well.
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          end(false, true);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          end(true, true);
        }
      }}
    />
  );
}

/**
 * One surface's rename of the plan it draws: whether its field is open, and
 * the note a refusal leaves beside the name until the next edit. Both are
 * held for the plan they were about, so a surface that moves on to another
 * plan draws neither over it. Note that the field closes as soon as it ends,
 * because the new name is drawn at once and a refusal puts the old one back
 * by itself. Each edit is counted, so the refusal of one an edit since has
 * replaced says nothing about the name drawn now.
 */
export function usePlanRename(
  planId: string | undefined,
  onRename: (planId: string, name: string) => Promise<boolean>,
) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const edits = useRef(0);
  const begin = () => {
    edits.current += 1;
    setRefused(undefined);
    setEditing(planId);
  };
  const end = ({ name }: NameEdit) => {
    setEditing(undefined);
    if (planId === undefined || name === undefined) return;
    const edit = edits.current;
    const refuse = () => {
      if (edit === edits.current) setRefused(planId);
    };
    onRename(planId, name).then((renamed) => (renamed ? undefined : refuse()), refuse);
  };
  const shown = planId !== undefined;
  return {
    editing: shown && editing === planId,
    begin,
    end,
    note: shown && refused === planId ? RENAME_FAILED_NOTE : undefined,
  };
}
