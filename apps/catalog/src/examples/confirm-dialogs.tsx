import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  type DialogQuestion,
  FootQuestion,
  Inline,
  JUSTIFY,
  Text,
  TextField,
  useConfirmDialog,
} from "@repo/ui";
import type { ConfirmAct } from "@repo/ui/confirm-state";
import { useRef, useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

type ActionResult = NonNullable<ConfirmAct["refused"]>;

const ACCEPTED: ActionResult = { status: "accepted" };

function refused(reason: string): ActionResult {
  return { status: "rejected", reason };
}

function useAnsweredAct(answer: () => ActionResult): ConfirmAct {
  const [answered, setAnswered] = useState<ActionResult | undefined>(undefined);
  return {
    run: () => {
      setAnswered(answer());
      return Promise.resolve();
    },
    busy: false,
    refused: answered,
    reset: () => setAnswered(undefined),
  };
}

function Asking({
  label,
  question,
  gate,
  answer = () => ACCEPTED,
}: {
  label: string;
  question: DialogQuestion;
  gate?: string;
  answer?: () => ActionResult;
}): React.JSX.Element {
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    useAnsweredAct(answer),
    () => CATALOG_FAILURE,
  );
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={confirm.ask}>
        {label}
      </Button>
      <ConfirmDialog open confirm={confirm} question={question} gate={gate} />
    </>
  );
}

function RefusedOnce(): React.JSX.Element {
  const [triedOnce, setTriedOnce] = useState(false);
  return (
    <Asking
      label="Delete key…"
      question={{
        title: "Delete the OpenAI key?",
        body: `${PRODUCT_NAME} stops using it at once. Agents that are running finish on it.`,
        verb: "Delete key",
        running: "Deleting",
        loss: CONFIRM_LOSS.IRREVERSIBLE,
      }}
      answer={() => {
        if (triedOnce) return ACCEPTED;
        setTriedOnce(true);
        return refused("The keychain is locked. Unlock it and try again.");
      }}
    />
  );
}

function Named(): React.JSX.Element {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    useAnsweredAct(() => (name.trim() === "" ? refused("Name the new owner.") : ACCEPTED)),
    () => CATALOG_FAILURE,
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
        Transfer ownership…
      </Button>
      <ConfirmDialog
        open
        confirm={confirm}
        field={field}
        question={{
          title: "Transfer the workspace?",
          body: "The new owner can remove you and everyone else, and can transfer it back.",
          verb: "Transfer workspace",
          running: "Transferring workspace",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      >
        <TextField
          ref={field}
          label="New owner"
          placeholder="Name or email"
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

function KeyInADialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(true);
  const [triedOnce, setTriedOnce] = useState(false);
  const removal = useConfirmDialog(
    { subject: key, surfaceOpen: open },
    useAnsweredAct(() => {
      if (!triedOnce) {
        setTriedOnce(true);
        return refused("The keychain is locked. Unlock it and try again.");
      }
      setKey(false);
      return ACCEPTED;
    }),
    () => CATALOG_FAILURE,
  );
  return (
    <>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        aria-haspopup="dialog"
        onClick={() => {
          setKey(true);
          setTriedOnce(false);
          setOpen(true);
        }}
      >
        Manage key…
      </Button>
      <Dialog
        open={open}
        title="OpenAI"
        size={DIALOG_SIZE.WIDE}
        onDismiss={() => setOpen(false)}
        actions={<DialogActions onDone={() => setOpen(false)} />}
      >
        {key ? (
          <Inline justify={JUSTIFY.BETWEEN}>
            <Text>sk-…wxyz</Text>
            <Button
              variant={BUTTON_VARIANT.DANGER_OUTLINE}
              busy={removal.busy}
              busyLabel="Removing"
              onClick={removal.ask}
            >
              Remove
            </Button>
          </Inline>
        ) : (
          <Text>No key saved.</Text>
        )}
        <FootQuestion
          confirm={removal}
          question={{
            title: "Remove your OpenAI API key?",
            body: "Calls and dictation will be off until a key is saved again.",
            verb: "Remove key",
            running: "Removing",
            loss: CONFIRM_LOSS.IRREVERSIBLE,
          }}
        />
      </Dialog>
    </>
  );
}

function ConfirmDialogs(): React.JSX.Element {
  return (
    <CatalogSection id="confirm-dialog-states" title="Confirm dialogs">
      <Inline>
        <RefusedOnce />
        <Asking
          label="Remove member…"
          question={{
            title: "Remove Ada Lovelace from the workspace?",
            body: "Ada loses access to its tasks at once, and can be invited again later.",
            verb: "Remove member",
            running: "Removing",
            loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          }}
        />
        <Asking
          label="Delete task…"
          question={{
            title:
              "Delete “Quarterly planning for the platform team’s migration to the new build system”?",
            body: "The task, its description, and every agent’s transcript under it go for good. Anyone in the workspace who opened it sees it gone the next time they look, and links to it from other tasks, from Linear issues, and from pull requests stop resolving.",
            verb: "Delete task",
            running: "Deleting",
            loss: CONFIRM_LOSS.IRREVERSIBLE,
          }}
        />
        <Named />
        <Asking
          label="Delete account…"
          gate="ada@example.com"
          question={{
            title: "Delete the account ada@example.com?",
            body: "This cannot be undone.",
            verb: "Delete account",
            running: "Deleting account",
            loss: CONFIRM_LOSS.IRREVERSIBLE,
          }}
        />
        <KeyInADialog />
      </Inline>
    </CatalogSection>
  );
}

export const CONFIRM_DIALOGS_EXAMPLE: Example = {
  id: "confirm-dialogs",
  title: "ConfirmDialog",
  Render: ConfirmDialogs,
};
