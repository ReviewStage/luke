import { signedInAccountId } from "@repo/credentials/snapshot";
import { orListParts } from "@repo/features/words";
import { EVERY_WORKSPACE } from "@repo/host/app-state";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { memberActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { ActorRef } from "../actor-ref.js";
import { githubTokenQuery, repositoryListsQuery } from "../live-reads.js";
import { useOpenSettings } from "../open-settings.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import {
  ANY_OWNER,
  otherOwnersWords,
  type RepositoryChooser,
  useOwnersToAsk,
} from "./repository-chip.js";

const NO_REPOSITORIES_COPY = {
  TITLE: "This workspace has no repositories yet",
  ADD_WITH_TOKEN: "Add with your token",
} as const;

const GITHUB_STATE = {
  NOT_CONNECTED: {
    label: "Connect GitHub",
    detail: "Connect GitHub to choose which repositories its agents work in.",
    ask: "connect GitHub",
  },
  LAPSED: {
    label: "Reconnect GitHub",
    detail: "Its GitHub was removed or suspended. Reconnect it to choose repositories again.",
    ask: "reconnect GitHub",
  },
  NONE_REACHED: {
    label: "Choose repositories",
    detail: "GitHub is connected but reaches no repository. Choose which its agents work in.",
    ask: "choose its repositories",
  },
} as const;

type GitHubState = (typeof GITHUB_STATE)[keyof typeof GITHUB_STATE];

function gitHubState(installed: boolean, connected: boolean): GitHubState {
  if (installed) return GITHUB_STATE.NONE_REACHED;
  return connected ? GITHUB_STATE.LAPSED : GITHUB_STATE.NOT_CONNECTED;
}

function MemberDetail({
  workspaceId,
  ask,
}: {
  workspaceId: string;
  ask: GitHubState["ask"];
}): React.JSX.Element {
  const { named, rest } = useOwnersToAsk(workspaceId);
  const items: readonly React.ReactNode[] = [
    ...named.map((member) => (
      <ActorRef key={member.userId} actor={memberActor(member, undefined)} sentence />
    )),
    ...(rest > 0 ? [otherOwnersWords(rest)] : []),
  ];
  const whom =
    items.length === 0
      ? ANY_OWNER
      : orListParts(items.length).map((part) => ("words" in part ? part.words : items[part.item]));
  return (
    <>
      Ask <ReplayMask>{whom}</ReplayMask> to {ask}, or add one with your own GitHub token.
    </>
  );
}

export function NoRepositoriesBanner({
  chooser,
}: {
  chooser: RepositoryChooser;
}): React.JSX.Element | null {
  const openSettings = useOpenSettings();
  const listed = useQuery(repositoryListsQuery(chooser.scope ?? EVERY_WORKSPACE)).data;
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const token = useQuery(githubTokenQuery(accountId)).data?.token;
  const { scope } = chooser;
  if (scope === undefined || listed === undefined || listed.repositories.length > 0) return null;
  const state = gitHubState(listed.installed, chooser.connected === true);
  const destination: SettingsLink =
    chooser.manages || (token !== undefined && token !== null)
      ? {
          page: SETTINGS_VIEW.WORKSPACE,
          section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
          workspaceId: scope,
        }
      : { page: SETTINGS_VIEW.ACCOUNT, section: SETTINGS_SECTION.GITHUB_TOKEN };
  const open = () => openSettings(destination);
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
      actions={
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={chooser.manages ? <ProviderMark provider={MARK_PROVIDER.GITHUB} /> : undefined}
          onClick={open}
        >
          {chooser.manages ? state.label : NO_REPOSITORIES_COPY.ADD_WITH_TOKEN}
        </Button>
      }
    >
      <Text variant={TEXT_VARIANT.SECTION}>{NO_REPOSITORIES_COPY.TITLE}</Text>
      <Text tone={TEXT_TONE.MUTED}>
        {chooser.manages ? state.detail : <MemberDetail workspaceId={scope} ask={state.ask} />}
      </Text>
    </Banner>
  );
}
