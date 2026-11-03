import {
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_REJECTION,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@repo/features/github-token-wire";
import type { TasksRepositoriesAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  MARK_PROVIDER,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  SETTINGS_ROW_STATE,
  SecretField,
  SettingsRowStateLine,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useGitHubConnection } from "../github-connect.js";
import { rejectionLabel } from "../settings/github-dialog.js";
import {
  AddTokenRepository,
  useTokenRepositories,
} from "../settings/workspace-token-repositories.js";
import type { RepositoryChooser } from "../tasks/repository-chip.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";

/**
 * setup-github.tsx -- setup's GitHub step: the App installed on the workspace's repositories, or the member's own token, chosen as two cards.
 *
 * The App is one trip to GitHub, which also links the member's GitHub
 * (the service keeps the install's user token). The token is made on
 * GitHub's own page and pasted here, then the repositories it may push to
 * are added; where the service refuses it for want of a linked GitHub
 * account, the card offers the link and the save again. The step is done once the workspace
 * reaches a repository, which is read again whenever the window is focused,
 * so a trip finished in the browser lands on its own.
 */

/** How the workspace reaches its repositories. */
const ROUTE = {
  APP: "app",
  TOKEN: "token",
} as const;

type Route = (typeof ROUTE)[keyof typeof ROUTE];

/** The repositories a read answered; none for a failed or unanswered read. */
function reachedOf(answer: TasksRepositoriesAnswer | undefined): number {
  return answer !== undefined && "repositories" in answer
    ? answer.repositories.repositories.length
    : 0;
}

/** A card's words under its choice, in the caption's muted ink. */
function CardWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {children}
    </Text>
  );
}

/** How many repositories the workspace reaches, as the done card says it. */
function reachedWords(count: number): string {
  return count === 1 ? "1 repository" : `${count} repositories`;
}

/** The App's card: one press sends the browser to GitHub's install page. */
function AppRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { act } = useAct();
  const [opening, setOpening] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const install = () => {
    setOpening(true);
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId })
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => setOpening(false));
  };
  return (
    <>
      <ProviderButton
        provider={MARK_PROVIDER.GITHUB}
        name="GitHub"
        words="Install on GitHub"
        size={PROVIDER_BUTTON_SIZE.GATE}
        primary
        busy={opening}
        busyLabel="Opening GitHub"
        onPress={install}
      />
      {refusal === undefined ? null : <CardWords>{refusal}</CardWords>}
    </>
  );
}

/** The token's card: a classic token made on GitHub and pasted here, then the repositories it may push to; GitHub linked only where the service asks for it. */
function TokenRoute({
  workspaceId,
  onAdded,
}: {
  workspaceId: string;
  onAdded: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const openLink = useOpenLink();
  const { connect } = useGitHubConnection();
  const repositories = useTokenRepositories(workspaceId);
  const [token, setToken] = useState<GitHubTokenSummary | null | undefined>(undefined);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<GitHubTokenRejection | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const added = repositories.listed.length;
  useEffect(() => {
    act(ACT_KIND.GITHUB_TOKEN_READ).then(
      (answer) => setToken("failure" in answer ? null : answer.token),
      () => setToken(null),
    );
  }, [act]);
  // A repository added reaches the workspace, which the step reads again.
  useEffect(() => {
    if (added > 0) onAdded();
  }, [added, onAdded]);
  const save = () => {
    const typed = pasted.trim();
    if (typed === "" || saving) return;
    setSaving(true);
    setRejection(undefined);
    setFailed(false);
    act(ACT_KIND.GITHUB_TOKEN_SAVE, { token: typed })
      .then(
        (answer) => {
          if ("failure" in answer) return setFailed(true);
          setToken(answer.token);
          setRejection(answer.rejected);
          if (answer.rejected === undefined) setPasted("");
        },
        () => setFailed(true),
      )
      .finally(() => setSaving(false));
  };
  if (token !== undefined && token !== null) {
    return (
      <>
        <span className="flex">
          <AddTokenRepository
            workspaceId={workspaceId}
            repositories={repositories}
            onRefused={setRefusal}
          />
        </span>
        {refusal === undefined ? null : <CardWords>{refusal}</CardWords>}
      </>
    );
  }
  return (
    <>
      <CardWords>No admin needed. Reviews and checks reach agents up to a minute late.</CardWords>
      <span className="flex">
        <ButtonLink
          href={GITHUB_TOKEN_CREATE_URL}
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={linkPressOf(openLink, GITHUB_TOKEN_CREATE_URL)}
        >
          Create a token on GitHub
        </ButtonLink>
      </span>
      <SecretField
        label="Classic token"
        placeholder="ghp_…"
        value={pasted}
        onChange={setPasted}
        onEnter={save}
      />
      {rejection === GITHUB_TOKEN_REJECTION.NO_GITHUB_ACCOUNT ? (
        <>
          <CardWords>Link the GitHub account this token is for, then save it again.</CardWords>
          <ProviderButton
            provider={MARK_PROVIDER.GITHUB}
            name="GitHub"
            words="Link GitHub"
            size={PROVIDER_BUTTON_SIZE.GATE}
            onPress={() => void connect()}
          />
        </>
      ) : rejection !== undefined ? (
        <CardWords>{rejectionLabel(rejection)}</CardWords>
      ) : failed ? (
        <CardWords>The token could not be saved. Try again.</CardWords>
      ) : null}
      <div className="flex justify-end">
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={pasted.trim() === ""}
          busy={saving}
          busyLabel="Saving"
          onClick={save}
        >
          Save
        </Button>
      </div>
    </>
  );
}

/** Setup's GitHub step for `workspaceId`; `onReached` hears whether the workspace reaches a repository. */
export function GitHubSetup({
  workspaceId,
  repositories,
  onReached,
}: {
  workspaceId: string;
  repositories: RepositoryChooser;
  onReached: (reached: boolean) => void;
}): React.JSX.Element {
  const [route, setRoute] = useState<Route>(ROUTE.APP);
  const [answer, setAnswer] = useState<TasksRepositoriesAnswer | undefined>(undefined);
  const { read } = repositories;
  const reread = useCallback(() => {
    read().then(setAnswer, () => undefined);
  }, [read]);
  // The install and the link finish in the browser, so the window's coming back reads the repositories again.
  useEffect(() => {
    reread();
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  }, [reread]);
  const reached = reachedOf(answer);
  useEffect(() => onReached(reached > 0), [reached, onReached]);
  const done =
    reached > 0 ? (
      <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
        {reachedWords(reached)}
      </SettingsRowStateLine>
    ) : null;
  const options: readonly ChoiceOption<Route>[] = [
    {
      value: ROUTE.APP,
      label: "GitHub App",
      badge: "Recommended",
      below: route !== ROUTE.APP ? null : (done ?? <AppRoute workspaceId={workspaceId} />),
    },
    {
      value: ROUTE.TOKEN,
      label: "Personal access token",
      below:
        route !== ROUTE.TOKEN
          ? null
          : (done ?? <TokenRoute workspaceId={workspaceId} onAdded={reread} />),
    },
  ];
  return (
    <ChoiceList
      legend="How agents reach your repositories"
      look={CHOICE_LOOK.CARD}
      options={options}
      value={[route]}
      disabled={reached > 0}
      onChange={([chosen]) => {
        if (chosen !== undefined) setRoute(chosen);
      }}
    />
  );
}
