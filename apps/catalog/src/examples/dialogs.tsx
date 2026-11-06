import {
  BUTTON_VARIANT,
  Button,
  CloseIcon,
  DIALOG_ROLE,
  DIALOG_SIZE,
  Dialog,
  DialogCard,
  FormField,
  IconButton,
  ImageIcon,
  Inline,
  ProductMark,
  SCROLL_SIZE,
  ScrollArea,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
} from "@repo/ui";
import { useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

interface DialogBody {
  open: boolean;
  onClose: () => void;
}

function RenameDialog({ open, onClose }: DialogBody): React.JSX.Element {
  const [name, setName] = useState("Launch checklist");
  const field = useRef<HTMLInputElement | null>(null);
  return (
    <Dialog
      open={open}
      title="Rename task"
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

function DeleteDialog({ open, onClose }: DialogBody): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();
  return (
    <Dialog
      open={open}
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
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <Text tone={TEXT_TONE.MUTED} id={bodyId}>
          The task, its description, and every agent’s transcript under it go for good. Anyone in
          the workspace who opened it sees it gone the next time they look.
        </Text>
      </ScrollArea>
    </Dialog>
  );
}

function NoteDialog({ open, onClose }: DialogBody): React.JSX.Element {
  const [note, setNote] = useState("");
  const [dropping, setDropping] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.WIDE}
      title="Send feedback"
      holding={note.trim() !== ""}
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

function ComposerDialog({ open, onClose }: DialogBody): React.JSX.Element {
  const [words, setWords] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.COMPOSER}
      title="New task"
      holding={words.trim() !== ""}
      initialFocus={field}
      onDismiss={onClose}
      actionsStart={<IconButton icon={<ImageIcon />} label="Attach files" />}
      actions={
        <Button variant={BUTTON_VARIANT.PRIMARY} disabled={words.trim() === ""} onClick={onClose}>
          Start
        </Button>
      }
    >
      <TextArea
        ref={field}
        label="Task"
        placeholder="Describe the task"
        value={words}
        onChange={setWords}
        rows={5}
        grow
      />
    </Dialog>
  );
}

function PictureDialog({ open, onClose }: DialogBody): React.JSX.Element {
  const titleId = useId();
  return (
    <Dialog open={open} size={DIALOG_SIZE.MEDIA} labelledBy={titleId} onDismiss={onClose}>
      <div className="catalog-media-bar">
        <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.H2} id={titleId}>
          product-mark.svg
        </Text>
        <IconButton icon={<CloseIcon />} label="Close" onClick={onClose} />
      </div>
      <div className="catalog-media-picture">
        <ProductMark />
      </div>
    </Dialog>
  );
}

function WindowPictureDialog({ open, onClose }: DialogBody): React.JSX.Element {
  const titleId = useId();
  return (
    <Dialog open={open} size={DIALOG_SIZE.WINDOW} labelledBy={titleId} onDismiss={onClose}>
      <DialogCard>
        <div className="catalog-media-bar">
          <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.H2} id={titleId}>
            product-mark.svg
          </Text>
          <IconButton icon={<CloseIcon />} label="Close" onClick={onClose} />
        </div>
        <div className="catalog-window-picture">
          <ProductMark />
        </div>
      </DialogCard>
    </Dialog>
  );
}

function Opener({
  label,
  Body,
}: {
  label: string;
  Body: (props: DialogBody) => React.JSX.Element;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);
  const show = () => {
    setOpen(true);
    setOpenings((count) => count + 1);
  };
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={show}>
        {label}
      </Button>
      <Body key={openings} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Dialogs(): React.JSX.Element {
  return (
    <CatalogSection id="dialog-states" title="Dialogs">
      <Inline>
        <Opener label="Rename task…" Body={RenameDialog} />
        <Opener label="Delete task…" Body={DeleteDialog} />
        <Opener label="Send feedback…" Body={NoteDialog} />
        <Opener label="New task…" Body={ComposerDialog} />
        <Opener label="Open picture…" Body={PictureDialog} />
        <Opener label="Open picture large…" Body={WindowPictureDialog} />
      </Inline>
    </CatalogSection>
  );
}

export const DIALOGS_EXAMPLE: Example = {
  id: "dialogs",
  title: "Dialog",
  Render: Dialogs,
};
