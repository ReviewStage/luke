import { macOnline } from "@luke/features/coding-agent-wire";
import {
  HOST_WIRE,
  type Host,
  hostInstallCommand,
  hostInstallLoopCommand,
  hostUpgradeCommand,
} from "@luke/features/host-wire";
import { agoText, momentText } from "@luke/features/time-format";
import { readingWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import {
  Badge,
  BUTTON_VARIANT,
  Button,
  CODE_CARD_TITLE,
  CONFIRM_LOSS,
  CodeCard,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  ErrorState,
  GAP,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  STATUS_TONE,
  Stack,
  Text,
  TrashIcon,
  useConfirmDialog,
  useMinute,
  useSecond,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Base64Url, Hex } from "effect/encoding";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { useExperiment } from "../use-app-state.js";
import { MenuRow } from "./menu-row.js";

/**
 * hosts-section.tsx -- Settings › Agents › Hosts: the member's own Linux servers that run their local agents, and Add hosts, which shows the install command once.
 *
 * A host is a server with nobody signed in at it (`@luke/features/host-wire`),
 * which joins its member's devices by running the install command as root.
 * The list names each of the member's hosts, whether it is online, held
 * against the window's own clock as a Mac's label is (`macOnline`), when it
 * was last seen otherwise, and, where its daemon is below the service's
 * floor, Upgrade needed with the command that upgrades it in place. Remove,
 * behind the row's ⋯, refuses that box at once, after asking.
 *
 * Add hosts mints an install token here, in the window, and hands the
 * service its SHA-256 alone, so the token never leaves the window that
 * shows it: it stands in this section's state while the dialog is open,
 * inside the install command and its loop for many servers, and is gone
 * once the dialog closes. Revoke this command stops new servers enrolling
 * with it, and none it already enrolled. The section stands nowhere while
 * the local agents experiment is off, which hosts sit behind as This Mac does.
 */

/** The bytes of randomness behind an install token, as many as a device secret's. */
const INSTALL_TOKEN_BYTES = 32;

/** `useMinute` counts in milliseconds, so the minute the list stands on is read off it in whole ones. */
const MINUTE_MS = 60_000;

/**
 * The class PostHog's recorder leaves out of a recording, element and children
 * alike, and a size containment: the commands do not wrap, so without it
 * their width widens the dialog's grid track past a phone's and puts the card,
 * its Done among it, off the screen. They scroll inside their cards instead.
 */
const COMMANDS = "ph-no-capture contain-inline-size";

const WORDS = {
  TITLE: "Hosts",
  EMPTY:
    "Run agents on your own Linux servers. They connect out to Luke, so nothing needs opening on them.",
  ADD: "Add hosts",
  ADD_DESCRIPTION: "One command adds any number of Linux servers, x64 or arm64, for 24 hours.",
  ADDING: "Making a command",
  ADD_FAILED: "Could not make an install command. Try again.",
  READ_FAILED: "Could not read your hosts.",
  SIGNED_OUT: "Sign in to see your hosts.",
  ONLINE: "Online",
  UPGRADE_NEEDED: "Upgrade needed",
  UPGRADE_TITLE: "Run this on the server to upgrade it",
  INSTALL_TITLE: "Run this as root on each server",
  LOOP_TITLE: "Or on many servers at once",
  SHOWN_FOLLOWS:
    "Each server shows up here as it connects. Its agents use your sign-ins and Luke's GitHub App, as in the cloud.",
  REVOKE: "Revoke this command",
} as const;

/** The rows that stand while the hosts are read: Add hosts, and a host with its ⋯. */
const HOSTS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] },
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.MORE] },
];

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
/** A remove or a revoke the service did not take, said in the dialog that asked. */
const REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "Luke could not reach the service. Try again.",
};

/** An install token minted for the dialog, and what the service answered keeping its hash. */
interface ShownToken {
  readonly installToken: string;
  readonly id: string;
  readonly expiresAt: number;
  readonly installScriptUrl: string;
}

/** A fresh install token and its SHA-256 in hex, from the platform's own Web Crypto, so the desktop and a browser mint one alike. */
async function mintedInstallToken(): Promise<{ installToken: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(INSTALL_TOKEN_BYTES));
  const installToken = `${HOST_WIRE.INSTALL_TOKEN_PREFIX}${Base64Url.encode(bytes)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(installToken));
  return { installToken, tokenHash: Hex.encode(new Uint8Array(digest)) };
}

/** A host's line under its name: online, or when it was last seen. */
function seenWords(host: Host, now: number): string {
  return macOnline(host.seenAt, now)
    ? WORDS.ONLINE
    : `Offline · last seen ${agoText(host.seenAt, now)}`;
}

/** One host's row: its name, whether it is online, Upgrade needed with its command, and Remove behind its ⋯. */
function HostRow({
  host,
  now,
  installScriptUrl,
  onRemove,
}: {
  host: Host;
  now: number;
  installScriptUrl: string;
  onRemove: (id: string) => Promise<ActionResult>;
}): React.JSX.Element {
  const removing = useConfirmDialog({ subject: true, surfaceOpen: true }, () => onRemove(host.id));
  return (
    <>
      <MenuRow
        thing="Host"
        actions={[
          {
            label: "Remove",
            icon: <TrashIcon />,
            danger: true,
            disabled: removing.busy,
            onSelect: removing.ask,
          },
        ]}
        row={{
          label: host.name,
          adornment: host.upgradeNeeded ? (
            <Badge tone={STATUS_TONE.ATTENTION}>{WORDS.UPGRADE_NEEDED}</Badge>
          ) : undefined,
          description:
            host.upgradeNeeded && host.version !== null
              ? `${seenWords(host, now)} · runs ${host.version}`
              : seenWords(host, now),
          below: host.upgradeNeeded ? (
            <CodeCard
              title={WORDS.UPGRADE_TITLE}
              titleIs={CODE_CARD_TITLE.WORDS}
              code={hostUpgradeCommand(installScriptUrl)}
              copy={copyThroughShell}
            />
          ) : undefined,
        }}
      />
      <ConfirmDialog
        open
        confirm={removing}
        question={{
          title: `Remove ${host.name}?`,
          body: "It stops taking agents now, and its agents stop. Their tasks and transcripts stay in Luke. To clean the server itself, run sudo luke-host uninstall on it.",
          verb: "Remove",
          running: "Removing",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}

/** The dialog Add hosts opens: the install command and its loop, each with the token in it, shown this once, and Revoke. */
function AddHostsDialog({
  shown,
  onRevoke,
  onClose,
}: {
  shown: ShownToken;
  onRevoke: () => Promise<ActionResult>;
  onClose: () => void;
}): React.JSX.Element {
  const revoking = useConfirmDialog({ subject: true, surfaceOpen: true }, onRevoke);
  return (
    <Dialog
      open
      title={WORDS.ADD}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actionsStart={
        <Button variant={BUTTON_VARIANT.QUIET} onClick={revoking.ask} disabled={revoking.busy}>
          {WORDS.REVOKE}
        </Button>
      }
      actions={<DialogActions onDone={onClose} />}
    >
      <div className={COMMANDS}>
        <Stack gap={GAP.CONTROL}>
          <Text>
            {`It works on as many servers as you like until ${momentText(shown.expiresAt)}, and isn't shown again.`}
          </Text>
          <CodeCard
            title={WORDS.INSTALL_TITLE}
            titleIs={CODE_CARD_TITLE.WORDS}
            code={hostInstallCommand(shown.installScriptUrl, shown.installToken)}
            copy={copyThroughShell}
          />
          <CodeCard
            title={WORDS.LOOP_TITLE}
            titleIs={CODE_CARD_TITLE.WORDS}
            code={hostInstallLoopCommand(shown.installScriptUrl, shown.installToken)}
            copy={copyThroughShell}
          />
          <Text>{WORDS.SHOWN_FOLLOWS}</Text>
        </Stack>
      </div>
      <ConfirmDialog
        open
        confirm={revoking}
        question={{
          title: "Revoke this command?",
          body: "No new server can be added with it. Servers already added keep working.",
          verb: "Revoke",
          running: "Revoking",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </Dialog>
  );
}

/** The Hosts group: Add hosts and the member's hosts, read when the page opens, or why they cannot be drawn. */
export function HostsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element | null {
  const on = useExperiment(EXPERIMENT.LOCAL_AGENTS);
  const { act } = useAct();
  const now = useSecond();
  const minute = Math.floor(useMinute() / MINUTE_MS);
  const [hosts, setHosts] = useState<readonly Host[] | undefined>(undefined);
  const [installScriptUrl, setInstallScriptUrl] = useState<string | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const [shown, setShown] = useState<ShownToken | undefined>(undefined);

  // The page opening reads the hosts the service holds now, which a server may just have joined.
  useEffect(() => {
    if (!on || !signedIn) return;
    let live = true;
    setHosts(undefined);
    setReadFailed(false);
    act(ACT_KIND.HOSTS_LIST).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) {
          setReadFailed(true);
          return;
        }
        setHosts(answer.hosts);
        setInstallScriptUrl(answer.installScriptUrl);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, on, signedIn, attempt]);

  // A server that joins while the page stands is drawn within a minute, with no skeleton over the list the member is reading.
  const mountMinute = useRef(minute);
  useEffect(() => {
    // The mount's own read is the effect above, so the minute it began in stands as it is.
    if (!on || !signedIn || minute === mountMinute.current) return;
    let live = true;
    act(ACT_KIND.HOSTS_LIST).then(
      (answer) => {
        if (!live || "failure" in answer) return;
        setHosts((standing) => (standing === undefined ? standing : answer.hosts));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, on, signedIn, minute]);

  const add = useCallback(() => {
    setAdding(true);
    setAddFailed(false);
    // Note that the token is minted here and only its hash is sent, so the token stands in this window alone.
    mintedInstallToken()
      .then(({ installToken, tokenHash }) =>
        act(ACT_KIND.HOSTS_KEEP_INSTALL_TOKEN, { tokenHash }).then((answer) => {
          if ("failure" in answer) {
            setAddFailed(true);
            return;
          }
          setShown({
            installToken,
            id: answer.id,
            expiresAt: answer.expiresAt,
            installScriptUrl: answer.installScriptUrl,
          });
        }),
      )
      .catch(() => setAddFailed(true))
      .finally(() => setAdding(false));
  }, [act]);

  const remove = useCallback(
    (id: string): Promise<ActionResult> =>
      act(ACT_KIND.HOSTS_REMOVE, { id })
        .catch(() => undefined)
        .then((answer) => {
          if (answer === undefined || "failure" in answer) return REFUSED;
          setHosts((standing) => standing?.filter((host) => host.id !== id));
          return ACCEPTED;
        }),
    [act],
  );

  const revoke = useCallback((): Promise<ActionResult> => {
    if (shown === undefined) return Promise.resolve(REFUSED);
    return act(ACT_KIND.HOSTS_REVOKE_INSTALL_TOKEN, { id: shown.id })
      .catch(() => undefined)
      .then((answer) => {
        if (answer === undefined || "failure" in answer) return REFUSED;
        setShown(undefined);
        return ACCEPTED;
      });
  }, [act, shown]);

  if (!on) return null;
  return (
    <SettingsSection title={WORDS.TITLE}>
      {!signedIn ? (
        <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
      ) : hosts !== undefined && installScriptUrl !== undefined ? (
        <>
          <SettingsRow
            label={WORDS.ADD}
            description={WORDS.ADD_DESCRIPTION}
            error={addFailed ? WORDS.ADD_FAILED : undefined}
          >
            {() => (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={adding}
                busyLabel={WORDS.ADDING}
                onClick={add}
              >
                {WORDS.ADD}
              </Button>
            )}
          </SettingsRow>
          {hosts.length === 0 ? (
            <SettingsLine>{WORDS.EMPTY}</SettingsLine>
          ) : (
            hosts.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                now={now}
                installScriptUrl={installScriptUrl}
                onRemove={remove}
              />
            ))
          )}
          {shown === undefined ? null : (
            <AddHostsDialog
              shown={shown}
              onRevoke={revoke}
              onClose={() => {
                setShown(undefined);
                // The list is read again, so a server that joined while the dialog stood is drawn.
                setAttempt((count) => count + 1);
              }}
            />
          )}
        </>
      ) : readFailed ? (
        <SettingsLine>
          <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
            {WORDS.READ_FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton label={readingWords("your hosts")} rows={HOSTS_SKELETON} />
      )}
    </SettingsSection>
  );
}
