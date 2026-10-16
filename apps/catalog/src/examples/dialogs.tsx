import {
  BUTTON_VARIANT,
  Button,
  DIALOG_ROLE,
  Dialog,
  FormField,
  GAP,
  Inline,
  JUSTIFY,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@luke/ui";
import { useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * dialogs.tsx -- a dialog holding a field, and a question that must be
 * answered, a long one, each opened from its button and put away by its
 * answers, Escape, or a press on the dimmed window.
 */

/** A dialog that renames a plan, its field taking focus as it opens. */
function RenameDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState("Launch checklist");
  const field = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  return (
    <Dialog labelledBy={titleId} initialFocus={field} onDismiss={onClose}>
      <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
        Rename plan
      </Text>
      <Stack gap={GAP.FIELD}>
        <FormField label="Name">
          {(entry) => (
            <TextField
              ref={field}
              field={entry}
              value={name}
              onChange={setName}
              onEnter={onClose}
            />
          )}
        </FormField>
        <Inline justify={JUSTIFY.END}>
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onClose}>
            Save
          </Button>
        </Inline>
      </Stack>
    </Dialog>
  );
}

/** A question that must be answered before going on, with more to say than one line holds. */
function DeleteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  return (
    <Dialog
      role={DIALOG_ROLE.ALERT_DIALOG}
      labelledBy={titleId}
      describedBy={bodyId}
      initialFocus={cancel}
      onDismiss={onClose}
    >
      <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
        Delete “Quarterly planning for the platform team’s migration”?
      </Text>
      <Text tone={TEXT_TONE.MUTED} id={bodyId}>
        The plan, its tasks, and every agent’s transcript under it go for good. Anyone in the
        workspace who opened it sees it gone the next time they look.
      </Text>
      <Inline justify={JUSTIFY.END}>
        <Button ref={cancel} variant={BUTTON_VARIANT.OUTLINE} onClick={onClose}>
          Cancel
        </Button>
        <Button variant={BUTTON_VARIANT.DANGER} onClick={onClose}>
          Delete
        </Button>
      </Inline>
    </Dialog>
  );
}

/** A button that opens `Body`, which closes itself. */
function Opener({
  label,
  Body,
}: {
  label: string;
  Body: (props: { onClose: () => void }) => React.JSX.Element;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <Body onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Dialogs(): React.JSX.Element {
  return (
    <CatalogSection id="dialog-states" title="Dialogs">
      <Inline>
        <Opener label="Rename plan…" Body={RenameDialog} />
        <Opener label="Delete plan…" Body={DeleteDialog} />
      </Inline>
    </CatalogSection>
  );
}

export const DIALOGS_EXAMPLE: Example = {
  id: "dialogs",
  title: "Dialog",
  Render: Dialogs,
};
