import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  GITHUB_ACCESS,
  type GitHubAccess,
  type GitHubRepository,
} from "@repo/features/github-repositories-wire";
import { GITHUB_TOKEN_CREATE_URL } from "@repo/features/github-token-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ALIGN,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  GAP,
  MARK_PROVIDER,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  SETTINGS_ROW_STATE,
  SecretField,
  SettingsRowStateLine,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { githubTokenQuery, repositoryListsQuery } from "../live-reads.js";
import { rejectionLabel } from "../settings/github-dialog.js";
import {
  TokenRepositoryPicker,
  useTokenRepositories,
} from "../settings/workspace-token-repositories.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";

/**
 * setup-github.tsx -- setup's GitHub step: the App installed on the workspace's repositories, or the member's own token, chosen as two cards.
 *
 * The App is one trip to GitHub, which also links the member's GitHub
 * (the service keeps the install's user token). The token is made on
 * GitHub's own page and pasted here, then the repositories it may push to
 * are picked, several at once, in a menu that checks each one added. The
 * token stands on its own, needing no GitHub account linked first. The step
 * is done once the workspace
 * reaches a repository, which is read again whenever the window is focused,
 * so a trip finished in the browser lands on its own, its done line naming
 * the owners the repositories stand on.
 */

/** What setup says over GitHub's cards, which setup lets be skipped: agents work in the account's repositories. */
export const GITHUB_PURPOSE = "Agents work in your repositories and open pull requests.";

/** A card's words under its choice, in the caption's muted ink. */
function CardWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {children}
    </Text>
  );
}

/** The most owners the done line names before it counts the rest. */
const OWNERS_NAMED = 3;

/** The owners the workspace's repositories stand on, each once, in the order the read lists them, the most recently updated first. */
function ownersOf(repositories: readonly GitHubRepository[]): string {
  const owners = [...new Set(repositories.map(({ owner }) => owner))];
  const named = owners.slice(0, OWNERS_NAMED);
  const rest = owners.length - named.length;
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    rest > 0 ? [...named, `${rest} more`] : named,
  );
}

/**
 * What the App's done line says: how many repositories the workspace
 * reaches, and the owners they stand on, so a developer sees which GitHub
 * account or organization was connected.
 * Note that the owners are a person's words and stay masked in a screen
 * recording.
 */
function ReachedWords({
  repositories,
}: {
  repositories: readonly GitHubRepository[];
}): React.JSX.Element {
  const count = repositories.length;
  const counted = count === 1 ? "1 repository" : `${count} repositories`;
  return (
    <>
      {`${counted} on `}
      <ReplayMask>{ownersOf(repositories)}</ReplayMask>
      {" through the GitHub App"}
    </>
  );
}

/**
 * The route the workspace's repositories are reached through: the App
 * wherever it reaches one, since the App wins, and a row with no access
 * named is the App's, from a service older than tokens.
 */
function reachedRoute(repositories: readonly GitHubRepository[]): GitHubAccess {
  const onApp = repositories.some(({ access }) => access !== GITHUB_ACCESS.TOKEN);
  return onApp ? GITHUB_ACCESS.APP : GITHUB_ACCESS.TOKEN;
}

/** The App's card: one press sends the browser to GitHub's install page. */
function AppRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const connectGitHub = useMutation(actMutation(ACT_KIND.WORKSPACE_GITHUB_CONNECT));
  const refusal = connectGitHub.error?.message;
  const install = () => connectGitHub.mutate({ workspaceId });
  return (
    <>
      <ProviderButton
        provider={MARK_PROVIDER.GITHUB}
        name="GitHub"
        words="Install on GitHub"
        size={PROVIDER_BUTTON_SIZE.GATE}
        primary
        busy={connectGitHub.isPending}
        busyLabel="Opening GitHub"
        onPress={install}
      />
      {refusal === undefined ? null : (
        <CardWords>
          <ReplayMask>{refusal}</ReplayMask>
        </CardWords>
      )}
    </>
  );
}

/** The token's card: a classic token made on GitHub and pasted here, then the repositories it may push to, picked several at once and changed for as long as the step stands. */
function TokenRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const saveToken = useMutation(actMutation(ACT_KIND.GITHUB_TOKEN_SAVE));
  const openLink = useOpenLink();
  const repositories = useTokenRepositories(workspaceId);
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const held = useQuery(githubTokenQuery(accountId));
  // Note that a token read that failed is taken for none, so the card offers a paste rather than waiting.
  const token = held.isError ? null : held.data?.token;
  const [pasted, setPasted] = useState("");
  const saved = saveToken.data;
  const saving = saveToken.isPending;
  const failed = saveToken.isError || (saved !== undefined && "failure" in saved);
  const rejection = saved === undefined || "failure" in saved ? undefined : saved.rejected;
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const save = () => {
    const typed = pasted.trim();
    if (typed === "" || saving) return;
    saveToken.mutate(
      { token: typed },
      {
        onSuccess: (answer) => {
          if (!("failure" in answer) && answer.rejected === undefined) setPasted("");
        },
      },
    );
  };
  if (token !== undefined && token !== null) {
    return (
      <>
        <span className="flex">
          <TokenRepositoryPicker
            workspaceId={workspaceId}
            repositories={repositories}
            onRefused={setRefusal}
          />
        </span>
        {refusal === undefined ? null : (
          <CardWords>
            <ReplayMask>{refusal}</ReplayMask>
          </CardWords>
        )}
      </>
    );
  }
  // Note that the card's two steps, making a token and pasting it, stand a block apart, each held tight within.
  return (
    <Stack gap={GAP.BLOCK}>
      <Stack gap={GAP.CONTROL} align={ALIGN.START}>
        <ButtonLink
          href={GITHUB_TOKEN_CREATE_URL}
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={linkPressOf(openLink, GITHUB_TOKEN_CREATE_URL)}
        >
          Create a token on GitHub
        </ButtonLink>
      </Stack>
      <Stack gap={GAP.CONTROL}>
        <SecretField
          label="Classic token"
          placeholder="ghp_…"
          value={pasted}
          onChange={setPasted}
          onEnter={save}
        />
        {rejection !== undefined ? (
          <CardWords>{rejectionLabel(rejection)}</CardWords>
        ) : failed ? (
          <CardWords>The token could not be saved. Try again.</CardWords>
        ) : null}
      </Stack>
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
    </Stack>
  );
}

/**
 * Setup's GitHub step for `workspaceId`; `onReached` hears whether the
 * workspace reaches a repository. Note that the host holds the workspace's
 * repositories while the step stands and asks again as the window comes
 * back from the install in the browser and as a token repository is added
 * (`LIVE_READ.REPOSITORY_LISTS`), so the step reads none of its own.
 */
export function GitHubSetup({
  workspaceId,
  onReached,
}: {
  workspaceId: string;
  onReached: (reached: boolean) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<GitHubAccess>(GITHUB_ACCESS.APP);
  const repositories = useQuery(repositoryListsQuery(workspaceId)).data?.repositories;
  const reached = repositories?.length ?? 0;
  useEffect(() => onReached(reached > 0), [reached, onReached]);
  // Note that once a repository is reached the route is the one that reaches it, never the card last chosen, which a remount forgets.
  const route = repositories !== undefined && reached > 0 ? reachedRoute(repositories) : chosen;
  // Note that the reached route becomes the card chosen, so taking the last token repository back keeps the token's card rather than falling to the App's.
  useEffect(() => {
    if (reached > 0) setChosen(route);
  }, [reached, route]);
  const done =
    reached > 0 ? (
      <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
        <ReachedWords repositories={repositories ?? []} />
      </SettingsRowStateLine>
    ) : null;
  const options: readonly ChoiceOption<GitHubAccess>[] = [
    {
      value: GITHUB_ACCESS.APP,
      label: "GitHub App",
      badge: "Recommended",
      below: route !== GITHUB_ACCESS.APP ? null : (done ?? <AppRoute workspaceId={workspaceId} />),
    },
    {
      value: GITHUB_ACCESS.TOKEN,
      label: "Personal access token",
      // Note that the token's card keeps its picker once a repository is reached, its chip naming them, so more are added or taken back in setup.
      below: route !== GITHUB_ACCESS.TOKEN ? null : <TokenRoute workspaceId={workspaceId} />,
    },
  ];
  return (
    <ChoiceList
      legend="How agents reach your repositories"
      look={CHOICE_LOOK.CARD}
      options={options}
      value={[route]}
      disabled={reached > 0}
      onChange={([picked]) => {
        if (picked !== undefined) setChosen(picked);
      }}
    />
  );
}
