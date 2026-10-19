import { githubUserAvatarUrl } from "@luke/features/account-picture";
import {
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenStatus,
  type GitHubTokenSummary,
} from "@luke/features/github-token-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  ChoiceList,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_TYPE,
  TEXT_LINK_LOOK,
  TextField,
  TextLink,
} from "@luke/ui";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useGitHubConnection } from "../github-connect.js";
import { dayText } from "../tasks/task-time.js";
import { useOpenLink } from "../tasks/use-open-link.js";

/**
 * github-dialog.tsx -- Settings › Integrations › GitHub › Manage: how Luke reaches GitHub for the member, the Luke GitHub App or their own classic personal access token.
 *
 * Two options, one panel open at a time. The Luke GitHub App, recommended
 * and open by default, says which GitHub the account is connected to, and
 * Refresh reads that again. The personal access token opens a password
 * field with Save, and once a token is saved its hint, login, expiry, and
 * Remove. Which option is open is only which panel shows: the saved token
 * is what counts, so opening the App removes nothing, and the dialog opens
 * on the token where one is saved. Every line is a label or a fact.
 *
 * The token stands in the open field alone, is sent once on Save, and is
 * cleared as soon as the service keeps it; the service never answers one.
 * The token's panel is kept out of the screen recording, which masks a
 * field's characters but not their count, as Settings › API keys is.
 */

const OPTION = {
  APP: "app",
  TOKEN: "token",
} as const;

type Option = (typeof OPTION)[keyof typeof OPTION];

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

const LINE = {
  READ_FAILED: "Your GitHub token could not be read.",
  SAVE_FAILED: "Couldn't save the token",
  REMOVE_FAILED: "Couldn't remove the token",
  NOT_CONNECTED: "Not connected",
} as const;

/** Why a save kept nothing, as a short label. */
function rejectionLabel(rejection: GitHubTokenRejection): string {
  switch (rejection) {
    case GITHUB_TOKEN_REJECTION.FINE_GRAINED:
      return "Not a classic token";
    case GITHUB_TOKEN_REJECTION.INVALID:
      return "GitHub rejected this token";
    case GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE:
      return "Missing repo scope";
    case GITHUB_TOKEN_REJECTION.NO_GITHUB_ACCOUNT:
      return "No GitHub account connected";
    case GITHUB_TOKEN_REJECTION.OTHER_USER:
      return "Token for a different GitHub account";
    case GITHUB_TOKEN_REJECTION.UNREACHABLE:
      return "Couldn't reach GitHub";
    case GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES:
      return "Too many tries";
  }
}

/** A saved token's status where it is not in use, as a short label. */
function statusLabel(status: GitHubTokenStatus): string | undefined {
  switch (status) {
    case GITHUB_TOKEN_STATUS.VERIFIED:
      return undefined;
    case GITHUB_TOKEN_STATUS.INVALID:
      return "GitHub rejected this token";
    case GITHUB_TOKEN_STATUS.UNREADABLE:
      return "Can no longer be read";
  }
}

/** A problem said in the attention tint, announced as it lands. */
function Problem({ children }: { children: string }): React.JSX.Element {
  return (
    <span className="settings-state" data-state="attention" role="alert">
      {children}
    </span>
  );
}

/** The App's panel: the GitHub the account is connected to, and Refresh. */
function AppPanel(): React.JSX.Element {
  const { tell } = useAct();
  const { connection } = useGitHubConnection();
  const login = connection?.connected === true ? connection.login : null;
  return (
    <div className="github-dialog-panel">
      <span className="github-dialog-facts">
        {login === null ? (
          LINE.NOT_CONNECTED
        ) : (
          <>
            Connected to
            <Avatar
              name={login}
              src={githubUserAvatarUrl({ login })}
              size={AVATAR_SIZE.INLINE}
              decorative
            />
            <span className="github-dialog-login">{login}</span>
          </>
        )}
      </span>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<RefreshCwIcon />}
        onClick={() => tell(ACT_KIND.TASKS_REFRESH)}
      >
        Refresh
      </Button>
    </div>
  );
}

/** A saved token: its hint, login, expiry, and status, with Remove. */
function SavedToken({
  token,
  onRemove,
}: {
  token: GitHubTokenSummary;
  onRemove: () => Promise<string | undefined>;
}): React.JSX.Element {
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const status = statusLabel(token.status);
  const remove = () => {
    setRemoving(true);
    setProblem(undefined);
    void onRemove().then((refused) => {
      setRemoving(false);
      setProblem(refused);
    });
  };
  return (
    <div className="github-dialog-panel">
      <span className="github-dialog-facts">
        <code className="api-key-hint">{token.hint}</code>
        {" · "}
        <span className="github-dialog-login">{token.login}</span>
        {token.expiresAt === null ? null : ` · Expires ${dayText(token.expiresAt)}`}
        {status === undefined ? null : (
          <>
            {" · "}
            <Problem>{status}</Problem>
          </>
        )}
        {problem === undefined ? null : (
          <>
            {" · "}
            <Problem>{problem}</Problem>
          </>
        )}
      </span>
      <Button
        variant={BUTTON_VARIANT.DANGER_OUTLINE}
        busy={removing}
        busyLabel="Removing the token"
        onClick={remove}
      >
        Remove
      </Button>
    </div>
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
    <div className="github-dialog-token">
      <form
        className="api-key-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextField
          type={TEXT_FIELD_TYPE.PASSWORD}
          autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
          label="Personal access token"
          placeholder="ghp_…"
          spellCheck={false}
          disabled={saving}
          value={pasted}
          onChange={(value) => {
            setPasted(value);
            setProblem(undefined);
          }}
        />
        <Button
          type={BUTTON_TYPE.SUBMIT}
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={pasted.trim() === ""}
          busy={saving}
          busyLabel="Checking the token"
        >
          Save
        </Button>
      </form>
      {problem === undefined ? null : <Problem>{problem}</Problem>}
    </div>
  );
}

/** The dialog Manage opens on the GitHub row. */
export function GitHubDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { act } = useAct();
  const openLink = useOpenLink();
  const [option, setOption] = useState<Option>(OPTION.APP);
  const [token, setToken] = useState<GitHubTokenSummary | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The dialog opening reads the token as the service holds it now, and opens on it where one is saved.
  useEffect(() => {
    let live = true;
    setReadFailed(false);
    act(ACT_KIND.GITHUB_TOKEN_READ).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) {
          setReadFailed(true);
          return;
        }
        setToken(answer.token);
        if (answer.token !== null) setOption(OPTION.TOKEN);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, attempt]);

  const save = (pasted: string): Promise<string | undefined> =>
    act(ACT_KIND.GITHUB_TOKEN_SAVE, { token: pasted })
      .catch(() => undefined)
      .then((answer) => {
        if (answer === undefined || "failure" in answer) return LINE.SAVE_FAILED;
        setToken(answer.token);
        return answer.rejected === undefined ? undefined : rejectionLabel(answer.rejected);
      });

  const remove = (): Promise<string | undefined> =>
    act(ACT_KIND.GITHUB_TOKEN_REMOVE)
      .catch(() => undefined)
      .then((answer) => {
        if (answer === undefined || "failure" in answer) return LINE.REMOVE_FAILED;
        setToken(answer.token);
        return undefined;
      });

  const tokenPanel = readFailed ? (
    <ErrorState onRetry={() => setAttempt((count) => count + 1)}>{LINE.READ_FAILED}</ErrorState>
  ) : token === undefined ? null : token === null ? (
    <TokenForm onSave={save} />
  ) : (
    <SavedToken token={token} onRemove={remove} />
  );

  return (
    <Dialog
      title="GitHub"
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="github-dialog">
        <ChoiceList<Option>
          legend="GitHub access"
          look={CHOICE_LOOK.MARKED}
          options={[
            { value: OPTION.APP, label: "Luke GitHub App", badge: "Recommended" },
            {
              value: OPTION.TOKEN,
              label: "Personal access token",
              aside: (
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
              ),
            },
          ]}
          value={[option]}
          onChange={([next]) => {
            if (next !== undefined) setOption(next);
          }}
        />
        {option === OPTION.APP ? <AppPanel /> : <div className={NO_CAPTURE}>{tokenPanel}</div>}
      </div>
    </Dialog>
  );
}
