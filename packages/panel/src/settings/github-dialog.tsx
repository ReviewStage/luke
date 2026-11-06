import {
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenStatus,
  type GitHubTokenSummary,
} from "@repo/features/github-token-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dayText } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  FootQuestion,
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
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useMutation } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { sendAct } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";

const NO_CAPTURE = "ph-no-capture";

const LINE = {
  SAVE_FAILED: "The token could not be saved. Try again.",
  REMOVE_FAILED: "The token could not be removed. Try again.",
} as const;

export function rejectionLabel(rejection: GitHubTokenRejection): ReactNode {
  switch (rejection) {
    case GITHUB_TOKEN_REJECTION.FINE_GRAINED:
      return "This isn't a classic token. Create a classic token and paste that.";
    case GITHUB_TOKEN_REJECTION.INVALID:
      return "GitHub rejected this token. Check that you copied all of it, or create a new one.";
    case GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE:
      return "This token is missing the repo scope. Create a new token with repo ticked.";
    case GITHUB_TOKEN_REJECTION.UNREACHABLE:
      return "GitHub could not be reached. Try again.";
    case GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES:
      return "Too many tokens tried in the last hour. Try again later.";
  }
}

function statusLabel(status: GitHubTokenStatus): string | undefined {
  switch (status) {
    case GITHUB_TOKEN_STATUS.VERIFIED:
      return undefined;
    case GITHUB_TOKEN_STATUS.INVALID:
      return "GitHub rejected this token. Disconnect it and add a new one.";
    case GITHUB_TOKEN_STATUS.UNREADABLE:
      return "Can no longer be read. Disconnect it and add it again.";
  }
}

function Problem({ children }: { children: string }): React.JSX.Element {
  useAnnounceShown(ANNOUNCE.ALERT, children);
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>{children}</SettingsRowStateLine>
  );
}

const FACT_BREAK = " ";

function expiryWords(expiresAt: number): string {
  return `Expires ${dayText(expiresAt)}`.replaceAll(" ", "\u00a0");
}

export function TokenFacts({ token }: { token: GitHubTokenSummary }): React.JSX.Element {
  const status = statusLabel(token.status);
  return (
    <SettingsFacts>
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT}>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
          {token.hint}
        </Text>
        {"\u00a0·\u00a0"}
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
          {token.login}
        </Text>
        {FACT_BREAK}
      </Text>
      {token.expiresAt === null ? null : (
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT}>
          {expiryWords(token.expiresAt)}
          {FACT_BREAK}
        </Text>
      )}
      {status === undefined ? null : <Problem>{status}</Problem>}
    </SettingsFacts>
  );
}

const TOKEN_REMOVE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.GITHUB_TOKEN_REMOVE],
  mutationFn: (): Promise<ActionResult> =>
    sendAct(ACT_KIND.GITHUB_TOKEN_REMOVE, undefined)
      .catch(() => undefined)
      .then((answer): ActionResult => {
        if (answer === undefined || "failure" in answer) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: LINE.REMOVE_FAILED };
        }
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      }),
});

function SavedToken({ token }: { token: GitHubTokenSummary }): React.JSX.Element {
  const removing = useMutation(TOKEN_REMOVE_MUTATION);
  const removalAct = useConfirmAct(removing, {
    send: () => removing.mutateAsync(),
    answered: sameAnswer,
  });
  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.GITHUB_TOKEN_REMOVE),
  );
  return (
    <Inline justify={JUSTIFY.BETWEEN}>
      <TokenFacts token={token} />
      <Button
        variant={BUTTON_VARIANT.DANGER_OUTLINE}
        busy={removal.busy}
        busyLabel="Disconnecting"
        onClick={removal.ask}
      >
        Disconnect
      </Button>
      <FootQuestion
        confirm={removal}
        question={{
          title: "Disconnect your GitHub token?",
          body: `${PRODUCT_NAME} deletes the token it holds, and your pull requests stop using it until you add one again.`,
          verb: "Disconnect token",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
        }}
      />
    </Inline>
  );
}

function TokenForm({
  field,
  onSave,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  onSave: (token: string) => Promise<ReactNode>;
}): React.JSX.Element {
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(undefined);
  const save = () => {
    const token = pasted.trim();
    if (token === "" || saving) return;
    setSaving(true);
    setProblem(undefined);
    void onSave(token).then((refused) => {
      setSaving(false);
      setProblem(refused);
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
        ref={field}
        label="Personal access token"
        error={refusedShown(problem, FAILURE_SURFACE.GITHUB_TOKEN_SAVE)}
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

export function GitHubTokenDialog({
  open,
  token,
  onClose,
  onExited,
}: {
  open: boolean;
  token: GitHubTokenSummary | null;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const { mutateAsync: sendGithubTokenSave } = useMutation(actMutation(ACT_KIND.GITHUB_TOKEN_SAVE));
  const openLink = useOpenLink();
  const field = useRef<HTMLInputElement | null>(null);
  const held = token !== null;
  const wasHeld = useRef(held);
  useEffect(() => {
    if (open && wasHeld.current && !held) field.current?.focus();
    wasHeld.current = held;
  }, [open, held]);

  const save = (pasted: string): Promise<ReactNode> =>
    sendGithubTokenSave({ token: pasted })
      .catch(() => undefined)
      .then((answer) => {
        if (answer === undefined || "failure" in answer) return LINE.SAVE_FAILED;
        return answer.rejected === undefined ? undefined : rejectionLabel(answer.rejected);
      });

  return (
    <Dialog
      open={open}
      title="Personal access token"
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      initialFocus={field}
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
          <ReplayUnmask>Create token</ReplayUnmask>
        </TextLink>
      }
      actions={<DialogActions onDone={onClose} />}
    >
      <div className={NO_CAPTURE}>
        {token === null ? <TokenForm field={field} onSave={save} /> : <SavedToken token={token} />}
      </div>
    </Dialog>
  );
}
