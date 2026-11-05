import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  GITHUB_TOKEN_CREATE_URL,
  type GitHubTokenRejection,
} from "@repo/features/github-token-wire";
import { LIVE_READ } from "@repo/features/live-wire";
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
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { rejectionLabel } from "../settings/github-dialog.js";
import {
  AddTokenRepository,
  useTokenRepositories,
} from "../settings/workspace-token-repositories.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";

/**
 * setup-github.tsx -- setup's GitHub step: the App installed on the workspace's repositories, or the member's own token, chosen as two cards.
 *
 * The App is one trip to GitHub, which also links the member's GitHub
 * (the service keeps the install's user token). The token is made on
 * GitHub's own page and pasted here, then the repositories it may push to
 * are added. The token stands on its own, needing no GitHub account linked
 * first. The step is done once the workspace
 * reaches a repository, which is read again whenever the window is focused,
 * so a trip finished in the browser lands on its own.
 */

/** What setup and Home say over GitHub's cards: that it is optional, since an agent works in no repository where none is chosen. */
export const GITHUB_OPTIONAL =
  "Optional. Agents can work without a repository; connect GitHub to have them work in your code and open pull requests.";

/** How the workspace reaches its repositories. */
const ROUTE = {
  APP: "app",
  TOKEN: "token",
} as const;

type Route = (typeof ROUTE)[keyof typeof ROUTE];

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
      {refusal === undefined ? null : (
        <CardWords>
          <ReplayMask>{refusal}</ReplayMask>
        </CardWords>
      )}
    </>
  );
}

/** The token's card: a classic token made on GitHub and pasted here, then the repositories it may push to. */
function TokenRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { act } = useAct();
  const openLink = useOpenLink();
  const repositories = useTokenRepositories(workspaceId);
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const held = useHostRead(LIVE_READ.GITHUB_TOKEN, accountId);
  // Note that a token read that failed is taken for none, so the card offers a paste rather than waiting.
  const token = held.status === HOST_READ_STATUS.FAILED ? null : held.rows?.token;
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<GitHubTokenRejection | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
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
        <CardWords>No admin needed. Reviews and checks reach agents up to a minute late.</CardWords>
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
  const [route, setRoute] = useState<Route>(ROUTE.APP);
  const reached =
    useHostRead(LIVE_READ.REPOSITORY_LISTS, workspaceId).rows?.repositories.length ?? 0;
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
      below: route !== ROUTE.TOKEN ? null : (done ?? <TokenRoute workspaceId={workspaceId} />),
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
