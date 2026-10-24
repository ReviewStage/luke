import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  Inline,
  TextField,
  useConfirmDialog,
} from "@luke/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * confirm-dialogs.tsx -- an irreversible act's question, opened from its
 * button: one refused the first time it is answered and accepted when tried
 * again, its card shaking at the refusal and its act wearing a check as it
 * lands, one in the accent for an act that can be undone but reaches someone
 * else, a long one, one that asks for a field to be filled, and one gated on
 * the subject's name. Only an act past undoing is red.
 */

/** What a confirming act answers, as `useConfirmDialog` takes it, so the catalog needs nothing beyond `@luke/ui`. */
type ActionResult = Awaited<ReturnType<Parameters<typeof useConfirmDialog>[1]>>;

const ACCEPTED: ActionResult = { status: "accepted" };

/** An act refused, saying why. */
function refused(reason: string): ActionResult {
  return { status: "rejected", reason };
}

/** A button that asks `question` before its act, which answers with `answer`. */
function Asking({
  label,
  question,
  gate,
  answer = () => ACCEPTED,
}: {
  label: string;
  question: DialogQuestion;
  /** The subject's name the act waits on, for the gravest acts. */
  gate?: string;
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
      <ConfirmDialog confirm={confirm} question={question} gate={gate} />
    </>
  );
}

/** A key whose deletion is refused the first time, so the refusal and the second try can be seen. */
function RefusedOnce(): React.JSX.Element {
  const [triedOnce, setTriedOnce] = useState(false);
  return (
    <Asking
      label="Delete key…"
      question={{
        title: "Delete the OpenAI key?",
        body: "Luke stops using it at once. Agents that are running finish on it.",
        verb: "Delete",
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

/** A question that asks for a name before it acts; Enter in the field answers. */
function Named(): React.JSX.Element {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    Promise.resolve(name.trim() === "" ? refused("Name the workspace.") : ACCEPTED),
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
          loss: CONFIRM_LOSS.REVERSIBLE,
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
          label="Remove member…"
          question={{
            title: "Remove Ada Lovelace from the workspace?",
            body: "Ada loses access to its tasks at once, and can be invited again later.",
            verb: "Remove",
            running: "Removing",
            loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          }}
        />
        <Asking
          label="Delete task…"
          question={{
            title:
              "Delete “Quarterly planning for the platform team’s migration to the new build system”?",
            body: "The task, its plan, and every agent’s transcript under it go for good. Anyone in the workspace who opened it sees it gone the next time they look, and links to it from other tasks, from Linear issues, and from pull requests stop resolving.",
            verb: "Delete",
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
      </Inline>
    </CatalogSection>
  );
}

export const CONFIRM_DIALOGS_EXAMPLE: Example = {
  id: "confirm-dialogs",
  title: "ConfirmDialog",
  Render: ConfirmDialogs,
};
