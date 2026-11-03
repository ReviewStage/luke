import type { GitHubTokenSummary } from "@repo/features/github-token-wire";
import type { TasksRepositoriesAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  MARK_PROVIDER,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  SETTINGS_ROW_STATE,
  SettingsRowStateLine,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useGitHubConnection } from "../github-connect.js";
import { GitHubTokenDialog } from "../settings/github-dialog.js";
import {
  AddTokenRepository,
  useTokenRepositories,
} from "../settings/workspace-token-repositories.js";
import type { RepositoryChooser } from "../tasks/repository-chip.js";
import { useDrawnThroughExit } from "../use-held-through-exit.js";

/**
 * setup-github.tsx -- setup's GitHub step: the App installed on the workspace's repositories, or the member's own token, chosen as two cards.
 *
 * The App is one trip to GitHub, which also links the member's GitHub
 * (the service keeps the install's user token). The token takes the member's
 * GitHub linked first, since a token must be that account's, then the token,
 * then the repositories it may push to. The step is done once the workspace
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

/** The token's card: GitHub linked, then the token, then the repositories it may push to. */
function TokenRoute({
  workspaceId,
  onAdded,
}: {
  workspaceId: string;
  onAdded: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const { connection, connect } = useGitHubConnection();
  const repositories = useTokenRepositories(workspaceId);
  const [token, setToken] = useState<GitHubTokenSummary | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const { drawn, onExited } = useDrawnThroughExit(open);
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
  let step: React.ReactNode;
  if (connection?.connected !== true) {
    step = (
      <ProviderButton
        provider={MARK_PROVIDER.GITHUB}
        name="GitHub"
        words="Link GitHub"
        size={PROVIDER_BUTTON_SIZE.GATE}
        onPress={() => void connect()}
      />
    );
  } else if (token === null) {
    step = (
      <span className="flex">
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          Add token
        </Button>
      </span>
    );
  } else if (token !== undefined) {
    step = (
      <span className="flex">
        <AddTokenRepository
          workspaceId={workspaceId}
          repositories={repositories}
          onRefused={setRefusal}
        />
      </span>
    );
  }
  return (
    <>
      <CardWords>No admin needed. Reviews and checks reach agents up to a minute late.</CardWords>
      {step}
      {refusal === undefined ? null : <CardWords>{refusal}</CardWords>}
      {!drawn ? null : (
        <GitHubTokenDialog
          open={open}
          token={token ?? null}
          onToken={(saved) => {
            setToken(saved);
            if (saved !== null) setOpen(false);
          }}
          onClose={() => setOpen(false)}
          onExited={onExited}
        />
      )}
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
