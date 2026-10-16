import {
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  DIALOG_TONE,
  type DialogQuestion,
  Inline,
  TextField,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * confirm-dialogs.tsx -- an irreversible act's question, opened from its
 * button: one refused the first time it is answered and accepted when tried
 * again, one in the accent for an act that can be undone, a long one, and
 * one that asks for a field to be filled.
 */

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A button that asks `question` before its act, which answers with `answer`. */
function Asking({
  label,
  question,
  answer = () => ACCEPTED,
}: {
  label: string;
  question: DialogQuestion;
  answer?: () => ActionResult;
}): React.JSX.Element {
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    Promise.resolve(answer()),
  );
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={confirm.ask}>
        {label}
      </Button>
      <ConfirmDialog confirm={confirm} question={question} />
    </>
  );
}

/** A key whose deletion is refused the first time, so the refusal and the second try can be seen. */
function RefusedOnce(): React.JSX.Element {
  const [refused, setRefused] = useState(false);
  return (
    <Asking
      label="Delete key…"
      question={{
        title: "Delete the OpenAI key?",
        body: "Luke stops using it at once. Agents that are running finish on it.",
        verb: "Delete",
        running: "Deleting",
      }}
      answer={() => {
        if (refused) return ACCEPTED;
        setRefused(true);
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "The keychain is locked. Unlock it and try again.",
        };
      }}
    />
  );
}

/** A question that asks for a name before it acts; Enter in the field answers. */
function Named(): React.JSX.Element {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    Promise.resolve(
      name.trim() === ""
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Name the workspace." }
        : ACCEPTED,
    ),
  );
  return (
    <>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        aria-haspopup="dialog"
        onClick={() => {
          setName("");
          confirm.ask();
        }}
      >
        New workspace…
      </Button>
      <ConfirmDialog
        confirm={confirm}
        field={field}
        question={{
          title: "New workspace",
          verb: "Create workspace",
          running: "Creating workspace",
          tone: DIALOG_TONE.PRIMARY,
        }}
      >
        <TextField
          ref={field}
          label="Workspace name"
          placeholder="Workspace name"
          value={name}
          onChange={(value) => {
            setName(value);
            confirm.clear();
          }}
        />
      </ConfirmDialog>
    </>
  );
}

function ConfirmDialogs(): React.JSX.Element {
  return (
    <CatalogSection id="confirm-dialog-states" title="Confirm dialogs">
      <Inline>
        <RefusedOnce />
        <Asking
          label="Restore version…"
          question={{
            title: "Restore this version?",
            body: "The plan goes back to how it read on 3 October. The current version stays in its history.",
            verb: "Restore",
            running: "Restoring",
            tone: DIALOG_TONE.PRIMARY,
          }}
        />
        <Asking
          label="Delete plan…"
          question={{
            title:
              "Delete “Quarterly planning for the platform team’s migration to the new build system”?",
            body: "The plan, its tasks, and every agent’s transcript under it go for good. Anyone in the workspace who opened it sees it gone the next time they look, and links to it from other plans, from Linear issues, and from pull requests stop resolving.",
            verb: "Delete",
            running: "Deleting",
          }}
        />
        <Named />
      </Inline>
    </CatalogSection>
  );
}

export const CONFIRM_DIALOGS_EXAMPLE: Example = {
  id: "confirm-dialogs",
  title: "ConfirmDialog",
  Render: ConfirmDialogs,
};
