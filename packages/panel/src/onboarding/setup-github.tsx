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

export const GITHUB_PURPOSE = "Agents work in your repositories and open pull requests.";

function CardWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {children}
    </Text>
  );
}

const OWNERS_NAMED = 3;

function ownersOf(repositories: readonly GitHubRepository[]): string {
  const owners = [...new Set(repositories.map(({ owner }) => owner))];
  const named = owners.slice(0, OWNERS_NAMED);
  const rest = owners.length - named.length;
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    rest > 0 ? [...named, `${rest} more`] : named,
  );
}

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

function reachedRoute(repositories: readonly GitHubRepository[]): GitHubAccess {
  const onApp = repositories.some(({ access }) => access !== GITHUB_ACCESS.TOKEN);
  return onApp ? GITHUB_ACCESS.APP : GITHUB_ACCESS.TOKEN;
}

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

function TokenRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const saveToken = useMutation(actMutation(ACT_KIND.GITHUB_TOKEN_SAVE));
  const openLink = useOpenLink();
  const repositories = useTokenRepositories(workspaceId);
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const held = useQuery(githubTokenQuery(accountId));
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
  const route = repositories !== undefined && reached > 0 ? reachedRoute(repositories) : chosen;
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
