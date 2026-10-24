import {
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenStatus,
  type GitHubTokenSummary,
} from "@luke/features/github-token-wire";
import { dayText } from "@luke/features/time-format";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  GAP,
  Inline,
  JUSTIFY,
  LAYOUT_ELEMENT,
  SETTINGS_ROW_STATE,
  SecretField,
  SettingsFacts,
  SettingsRowStateLine,
  Stack,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_LINK_LOOK,
  TEXT_VARIANT,
  Text,
  TextLink,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useState } from "react";
import { useAct } from "../act.js";
import { useOpenLink } from "../tasks/use-open-link.js";

/**
 * github-dialog.tsx -- Settings › Profile › GitHub personal access token: the member's own classic token, added, shown, and removed.
 *
 * The dialog holds the token alone: a password field with Save, or once a token is saved its hint, login, expiry, and Remove, which asks
 * first in the confirm dialog, and at its foot Create token, which opens
 * GitHub's page for a new classic token in the browser. Every refusal and status says what to do
 * next, in a line.
 *
 * The token stands in the open field alone, is sent once on Save, and is
 * cleared as soon as the service keeps it; the service never answers one.
 * The dialog is kept out of the screen recording, which masks a field's
 * characters but not their count, as Settings › Agents' keys are.
 */

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

const LINE = {
  SAVE_FAILED: "The token could not be saved. Try again.",
  REMOVE_FAILED: "The token could not be removed. Try again.",
} as const;

/** Why a save kept nothing, and what to do next, as one short line. */
function rejectionLabel(rejection: GitHubTokenRejection): string {
  switch (rejection) {
    case GITHUB_TOKEN_REJECTION.FINE_GRAINED:
      return "This isn't a classic token. Create a classic token and paste that.";
    case GITHUB_TOKEN_REJECTION.INVALID:
      return "GitHub rejected this token. Check that you copied all of it, or create a new one.";
    case GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE:
      return "This token is missing the repo scope. Create a new token with repo ticked.";
    case GITHUB_TOKEN_REJECTION.NO_GITHUB_ACCOUNT:
      return "No GitHub account is connected to your Luke account. Connect GitHub in Settings › Integrations, then save the token again.";
    case GITHUB_TOKEN_REJECTION.OTHER_USER:
      return "This token belongs to a different GitHub account than the one connected to Luke. Create it while signed in to the connected account.";
    case GITHUB_TOKEN_REJECTION.UNREACHABLE:
      return "Couldn't reach GitHub. Try again.";
    case GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES:
      return "Too many tokens tried in the last hour. Try again later.";
  }
}

/** A saved token's status where it is not in use, and what to do about it, as one short line. */
function statusLabel(status: GitHubTokenStatus): string | undefined {
  switch (status) {
    case GITHUB_TOKEN_STATUS.VERIFIED:
      return undefined;
    case GITHUB_TOKEN_STATUS.INVALID:
      return "GitHub rejected this token. Remove it and add a new one.";
    case GITHUB_TOKEN_STATUS.UNREADABLE:
      return "Can no longer be read. Remove it and add it again.";
  }
}

/** A problem said in the attention tint, announced as it lands. */
function Problem({ children }: { children: string }): React.JSX.Element {
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION} role="alert">
      {children}
    </SettingsRowStateLine>
  );
}

/** What tells a saved token apart: its hint, login, expiry, and its status where it is not in use. */
export function TokenFacts({ token }: { token: GitHubTokenSummary }): React.JSX.Element {
  const status = statusLabel(token.status);
  return (
    <SettingsFacts gap={GAP.TIGHT}>
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
        {token.hint}
      </Text>
      {" · "}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
        {token.login}
      </Text>
      {token.expiresAt === null ? null : ` · Expires ${dayText(token.expiresAt)}`}
      {status === undefined ? null : (
        <>
          {" · "}
          <Problem>{status}</Problem>
        </>
      )}
    </SettingsFacts>
  );
}

/** A saved token with Remove, which asks first. */
function SavedToken({
  token,
  onRemove,
}: {
  token: GitHubTokenSummary;
  onRemove: () => Promise<ActionResult>;
}): React.JSX.Element {
  const removal = useConfirmDialog({ subject: true, surfaceOpen: true }, onRemove);
  return (
    <Inline justify={JUSTIFY.BETWEEN}>
      <TokenFacts token={token} />
      <Button
        variant={BUTTON_VARIANT.DANGER_OUTLINE}
        busy={removal.busy}
        busyLabel="Removing"
        onClick={removal.ask}
      >
        Remove
      </Button>
      <ConfirmDialog
        confirm={removal}
        question={{
          title: "Remove your GitHub token?",
          verb: "Remove",
          running: "Removing…",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </Inline>
  );
}

/** The field a token is pasted into, with Save, and why a save kept nothing under it. */
function TokenForm({
  onSave,
}: {
  onSave: (token: string) => Promise<string | undefined>;
}): React.JSX.Element {
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const save = () => {
    const token = pasted.trim();
    if (token === "" || saving) return;
    setSaving(true);
    setProblem(undefined);
    void onSave(token).then((refused) => {
      setSaving(false);
      setProblem(refused);
      // Kept: the token leaves the field, and the panel draws the service's word for it.
      if (refused === undefined) setPasted("");
    });
  };
  return (
    <Stack
      as={LAYOUT_ELEMENT.FORM}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <SecretField
        label="Personal access token"
        error={problem}
        placeholder="ghp_…"
        disabled={saving}
        value={pasted}
        onChange={(value) => {
          setPasted(value);
          setProblem(undefined);
        }}
      />
      <Inline justify={JUSTIFY.END}>
        <Button
          type={BUTTON_TYPE.SUBMIT}
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={pasted.trim() === ""}
          busy={saving}
          busyLabel="Checking the token"
        >
          Save
        </Button>
      </Inline>
    </Stack>
  );
}

/** The dialog the Profile row's Add or Manage opens, over the token as the row last read it. */
export function GitHubTokenDialog({
  open,
  token,
  onToken,
  onClose,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  /** The saved token, or null where none is. */
  token: GitHubTokenSummary | null;
  /** The token as the service answered a save or a removal. */
  onToken: (token: GitHubTokenSummary | null) => void;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const openLink = useOpenLink();

  const save = (pasted: string): Promise<string | undefined> =>
    act(ACT_KIND.GITHUB_TOKEN_SAVE, { token: pasted })
      .catch(() => undefined)
      .then((answer) => {
        if (answer === undefined || "failure" in answer) return LINE.SAVE_FAILED;
        onToken(answer.token);
        return answer.rejected === undefined ? undefined : rejectionLabel(answer.rejected);
      });

  const remove = (): Promise<ActionResult> =>
    act(ACT_KIND.GITHUB_TOKEN_REMOVE)
      .catch(() => undefined)
      .then((answer): ActionResult => {
        if (answer === undefined || "failure" in answer) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: LINE.REMOVE_FAILED };
        }
        onToken(answer.token);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      });

  return (
    <Dialog
      open={open}
      title="Personal access token"
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      onExited={onExited}
      actionsStart={
        <TextLink
          look={TEXT_LINK_LOOK.UNDERLINED}
          href={GITHUB_TOKEN_CREATE_URL}
          external
          onClick={(event) => {
            event.preventDefault();
            openLink(GITHUB_TOKEN_CREATE_URL);
          }}
        >
          Create token
        </TextLink>
      }
      actions={<DialogActions onDone={onClose} />}
    >
      <div className={NO_CAPTURE}>
        {token === null ? (
          <TokenForm onSave={save} />
        ) : (
          <SavedToken token={token} onRemove={remove} />
        )}
      </div>
    </Dialog>
  );
}
