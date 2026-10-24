import {
  BUTTON_VARIANT,
  Button,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogTone,
  Inline,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * dialog-actions.tsx -- a dialog's one foot: Cancel and then the act, red
 * for an act that destroys and in the accent otherwise, or Done alone for a
 * dialog that only shows; each opened from its button and put away by its
 * answers.
 */

/** A dialog whose foot asks Cancel or the act, in `tone`. */
function Asking({
  label,
  title,
  verb,
  tone,
}: {
  label: string;
  title: string;
  verb: string;
  tone: DialogTone;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Dialog
          title={title}
          onDismiss={close}
          actions={
            <DialogActions onCancel={close} act={{ verb, tone, running: verb, onPress: close }} />
          }
        >
          <Text tone={TEXT_TONE.MUTED}>Its answers stand at the card's foot.</Text>
        </Dialog>
      ) : null}
    </>
  );
}

/** A dialog that only shows a result, put away by its Done. */
function Showing(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Show secret…
      </Button>
      {open ? (
        <Dialog title="Webhook secret" onDismiss={close} actions={<DialogActions onDone={close} />}>
          <Text tone={TEXT_TONE.MUTED}>Copy it now. It is not shown again.</Text>
        </Dialog>
      ) : null}
    </>
  );
}

function DialogActionsExample(): React.JSX.Element {
  return (
    <CatalogSection id="dialog-actions-states" title="Dialog actions">
      <Inline>
        <Asking
          label="Delete task…"
          title="Delete this task?"
          verb="Delete"
          tone={DIALOG_TONE.DANGER}
        />
        <Asking
          label="Remove member…"
          title="Remove Ada from the workspace?"
          verb="Remove"
          tone={DIALOG_TONE.PRIMARY}
        />
        <Showing />
      </Inline>
    </CatalogSection>
  );
}

export const DIALOG_ACTIONS_EXAMPLE: Example = {
  id: "dialog-actions",
  title: "DialogActions",
  Render: DialogActionsExample,
};
