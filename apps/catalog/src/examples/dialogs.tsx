import {
  BUTTON_VARIANT,
  Button,
  CloseIcon,
  DIALOG_ROLE,
  DIALOG_SIZE,
  Dialog,
  FormField,
  IconButton,
  ImageIcon,
  Inline,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
  WingFace,
} from "@luke/ui";
import { useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * dialogs.tsx -- a dialog holding a field, a question that must be
 * answered, a long one, a wide note that grows with its words and rings
 * while a file is dragged over the window, a tool at its foot's start, and a
 * picture shown edge to edge under its own bar, each opened from its button and
 * put away by its answers, Escape, or a press on the dimmed window. The
 * question's words scroll inside the card in a short window, so its answers
 * stay on screen.
 */

/** A dialog that renames a plan, its field taking focus as it opens. */
function RenameDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState("Launch checklist");
  const field = useRef<HTMLInputElement | null>(null);
  return (
    <Dialog
      title="Rename plan"
      initialFocus={field}
      onDismiss={onClose}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onClose}>
            Save
          </Button>
        </>
      }
    >
      <FormField label="Name">
        {(entry) => (
          <TextField ref={field} field={entry} value={name} onChange={setName} onEnter={onClose} />
        )}
      </FormField>
    </Dialog>
  );
}

/** A question that must be answered before going on, with more to say than one line holds. */
function DeleteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();
  return (
    <Dialog
      role={DIALOG_ROLE.ALERT_DIALOG}
      title="Delete “Quarterly planning for the platform team’s migration”?"
      describedBy={bodyId}
      initialFocus={cancel}
      onDismiss={onClose}
      actions={
        <>
          <Button ref={cancel} variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={BUTTON_VARIANT.DANGER} onClick={onClose}>
            Delete
          </Button>
        </>
      }
    >
      <div className="catalog-dialog-scroll">
        <Text tone={TEXT_TONE.MUTED} id={bodyId}>
          The plan, its tasks, and every agent’s transcript under it go for good. Anyone in the
          workspace who opened it sees it gone the next time they look.
        </Text>
      </div>
    </Dialog>
  );
}

/** A note being written, on the wide card, which rings while a file is dragged over the window. */
function NoteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [note, setNote] = useState("");
  const [dropping, setDropping] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  return (
    <Dialog
      size={DIALOG_SIZE.WIDE}
      title="Send feedback"
      initialFocus={field}
      onDismiss={onClose}
      dropping={dropping}
      dropTarget={{
        onDragOver: (event) => {
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: (event) => {
          if (event.relatedTarget === null) setDropping(false);
        },
        onDrop: (event) => {
          event.preventDefault();
          setDropping(false);
        },
      }}
      actionsStart={<IconButton icon={<ImageIcon />} label="Attach screenshot" />}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} disabled={note.trim() === ""} onClick={onClose}>
            Send
          </Button>
        </>
      }
    >
      <TextArea
        ref={field}
        label="Feedback"
        placeholder="What happened, and what did you expect?"
        value={note}
        onChange={setNote}
        rows={5}
        grow
      />
    </Dialog>
  );
}

/** A picture opened over the window, the card fitted to it under a bar naming it. */
function PictureDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const titleId = useId();
  return (
    <Dialog size={DIALOG_SIZE.MEDIA} labelledBy={titleId} onDismiss={onClose}>
      <div className="catalog-media-bar">
        <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.H2} id={titleId}>
          luke-face.svg
        </Text>
        <IconButton icon={<CloseIcon />} label="Close" onClick={onClose} />
      </div>
      <div className="catalog-media-picture">
        <WingFace />
      </div>
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
        <Opener label="Send feedback…" Body={NoteDialog} />
        <Opener label="Open picture…" Body={PictureDialog} />
      </Inline>
    </CatalogSection>
  );
}

export const DIALOGS_EXAMPLE: Example = {
  id: "dialogs",
  title: "Dialog",
  Render: Dialogs,
};
