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

/**
 * no-repositories-banner.tsx -- the card over Home's composer while the workspace reaches no repository: that it has none yet, and the press that adds one.
 *
 * A teammate who accepts an invitation before the workspace's GitHub is
 * connected lands in a workspace with nothing to pick, and the repository
 * chip alone says so only once its menu is opened. So while the listing the
 * chip holds (`LIVE_READ.REPOSITORY_LISTS`) answers with no repository, Home
 * says so on a card of its own, under the card that asks for an agent where
 * one stands, since an agent holds Start and a repository does not: a task
 * may start with none. An owner or an admin is offered the press that mends
 * it as the chip's menu offers it, Connect GitHub, Reconnect GitHub where
 * GitHub removed or suspended the App, or Choose repositories where the App
 * reaches none; a member is told whom to ask to do the same, each owner and
 * admin named by their person chip (`ActorRef`), whose card and page open
 * from it, and offered adding one with their own GitHub token. A press opens Settings on the
 * workspace's GitHub repositories, where all of it is done, but a member's
 * with no token saved, which opens the token's row on Account instead, since
 * the workspace's Add repository stands only once a token is saved
 * (`AddTokenRepository`). Nothing stands until a workspace is chosen, nor
 * while the listing is still read or could not be, which the chip says.
 */

/** What the card says, worded once. */
const NO_REPOSITORIES_COPY = {
  TITLE: "This workspace has no repositories yet",
  ADD_WITH_TOKEN: "Add with your token",
} as const;

/**
 * Each way the workspace's GitHub leaves it with no repository, as the chip's
 * menu tells them apart: the press an owner or an admin mends it with, what
 * the card says beside that press, and what a member asks them to do,
 * finishing "Ask … to".
 */
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

/** Which way the workspace's GitHub stands: installed and reaching none, connected once but no longer installed, or never connected. */
function gitHubState(installed: boolean, connected: boolean): GitHubState {
  if (installed) return GITHUB_STATE.NONE_REACHED;
  return connected ? GITHUB_STATE.LAPSED : GITHUB_STATE.NOT_CONNECTED;
}

/**
 * A member's words: whom to ask, each owner and admin read as their person
 * chip, joined as a choice and the rest counted, or an owner or admin until
 * the workspace's people are read; what to ask them to do; then the token.
 */
function MemberDetail({
  workspaceId,
  ask,
}: {
  workspaceId: string;
  ask: GitHubState["ask"];
}): React.JSX.Element {
  const { named, rest } = useOwnersToAsk(workspaceId);
  // Each item the choice joins: an owner's or an admin's chip, then the rest counted.
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
  // Note that a person is the reader's teammate, so the chips stay masked while the rest is the app's own.
  return (
    <>
      Ask <ReplayMask>{whom}</ReplayMask> to {ask}, or add one with your own GitHub token.
    </>
  );
}

/** The card while the workspace `chooser` lists reaches no repository; nothing otherwise. */
export function NoRepositoriesBanner({
  chooser,
}: {
  chooser: RepositoryChooser;
}): React.JSX.Element | null {
  const openSettings = useOpenSettings();
  const listed = useQuery(repositoryListsQuery(chooser.scope ?? EVERY_WORKSPACE)).data;
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const token = useQuery(githubTokenQuery(accountId)).data?.token;
  // Note that every workspace's listing speaks for no one workspace, so the card waits for one to be chosen.
  const { scope } = chooser;
  if (scope === undefined || listed === undefined || listed.repositories.length > 0) return null;
  const state = gitHubState(listed.installed, chooser.connected === true);
  // A member known to have no token saved saves one first, on Account, since the workspace's Add repository waits on it.
  const destination: SettingsLink =
    chooser.manages || token !== null
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
