import { DEVICE_STANDING, type DeviceStanding } from "@luke/features/agent-wire";
import {
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import {
  HOST_UNINSTALL_COMMAND,
  HOST_WIRE,
  type Host,
  hostInstallCommand,
  hostUpgradeCommand,
} from "@luke/features/host-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { agoText, momentText } from "@luke/features/time-format";
import { readingWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  ANNOUNCE,
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
  ErrorLine,
  ErrorState,
  GAP,
  PlusIcon,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
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
import { DEVICE_PLATFORM_NAME, macSessionWords } from "../device-platform.js";
import {
  type PresenceBook,
  presenceAgeMs,
  presenceStanding,
  useDevicePresence,
} from "../device-presence.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { MenuRow } from "./menu-row.js";
import {
  type HostLine,
  HostStateLine,
  setupLineOf,
  ThisMacAct,
  type ThisMacHost,
  ThisMacHostRow,
  useThisMacHost,
} from "./this-mac-host-row.js";

/**
 * hosts-section.tsx -- Settings › Hosts: the member's own machines that run their local agents, Linux servers and Macs alike, and Add hosts, which shows the install command once.
 *
 * A machine is any device of the member's enrolled with a secret of its own
 * (`@luke/features/host-wire`): a Linux server or a Mac that ran the install
 * command, or a Mac its desktop enrolled. The list names each, what it is by
 * its platform (`DEVICE_PLATFORM_NAME`), whether it is online, held against
 * the window's own clock as a Mac's label is (`macOnline`), when it was last
 * seen otherwise, where its setup stands while it is not ready, getting
 * ready or couldn't set up and why, in the words This Mac's row says them
 * in (`setupLineOf`), for a Mac that it runs while its user is logged in,
 * since its host runs in their login session, and, where its host program
 * is below the service's floor, Upgrade needed with how to upgrade it: the
 * install command's upgrade, this Mac's app updated, or, for another Mac,
 * either, since the service lists no word of how a Mac joined. Remove,
 * behind the row's ⋯, refuses that machine at once, after asking with the
 * command that takes Luke off the machine itself where the install command
 * may have set it up. Adding takes a Linux server and a Mac alike, through
 * one command.
 *
 * In the desktop app this Mac stands first, with where its `luke-host`
 * stands under it (`this-mac-host-row.tsx`) and Retry where it failed: on
 * its own machine's row, matched by the device it is enrolled as, or, where
 * the service lists no machine for it (not turned on, removed, a turn-on
 * that failed, or another account's), on a This Mac row of its own with
 * Turn on, Turn on again, or Retry, so there is always a way in. A browser
 * tab has no This Mac, so it draws neither, and with no host says what one
 * is above Add hosts.
 *
 * Add hosts mints an install token here, in the window, and hands the
 * service its SHA-256 alone, so the token never leaves the window that
 * shows it: it stands in this section's state while the dialog is open,
 * inside the install command the member runs on each host, and is gone once
 * the dialog closes. Revoke this command stops new servers enrolling with it, and none it
 * already enrolled. The page stands only while the Bring your own host
 * experiment is on (`settings-rows.ts`'s `PAGE_EXPERIMENT`), so while it is
 * off nothing here is drawn, read, or turned on.
 */

/** The bytes of randomness behind an install token, as many as a device secret's. */
const INSTALL_TOKEN_BYTES = 32;

/** `useMinute` counts in milliseconds, so the minute the list stands on is read off it in whole ones. */
const MINUTE_MS = 60_000;

/** How often the list is read while a host is getting ready, as often as This Mac's row reads its own. */
const SETTING_UP_READ_EVERY_MS = 5_000;

/**
 * The class PostHog's recorder leaves out of a recording, element and children
 * alike, and a size containment: the commands do not wrap, so without it
 * their width widens the dialog's grid track past a phone's and puts the card,
 * its Done among it, off the screen. They scroll inside their cards instead.
 */
const COMMANDS = "ph-no-capture contain-inline-size";

const WORDS = {
  ADD: "Add hosts",
  ADDING: "Making a command",
  ADD_FAILED: "Could not make an install command. Try again.",
  READ_FAILED: "Could not read your hosts.",
  NONE: "No hosts yet. A host is a Mac or Linux server of yours that runs your agents instead of the cloud.",
  SIGNED_OUT: "Sign in to see your hosts.",
  ONLINE: "Online",
  UNKNOWN: "Can't check status",
  CHECKING: "Checking",
  UPGRADE_NEEDED: "Upgrade needed",
  UPGRADE_TITLE: "Run this on the host to upgrade it",
  MAC_UPGRADE: "Update the Luke app on this Mac to upgrade it.",
  OTHER_MAC_UPGRADE: "If you added it from the Luke app on it, update the app there.",
  OTHER_MAC_UPGRADE_TITLE: "If you used the install command, run this on it",
  INSTALL_TITLE: "Run this on each host",
  REVOKE: "Revoke this command",
} as const;

/** The row that stands while the machines are read: a machine with its ⋯. */
const HOSTS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.MORE] },
];

/** Add hosts' own line under the list, the button stretched to the rows' width and its failure under it. */
const ADD_LINE = "grid";

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

/** Where a host stands now; one the read does not name, though it is the account's own, is gone. */
function hostStanding(host: Host, book: PresenceBook): DeviceStanding {
  return presenceStanding(book, host.id) ?? DEVICE_STANDING.OFFLINE;
}

/** A host's line under its name: online, or when it was last seen. */
function seenWords(host: Host, book: PresenceBook, now: number): string {
  const standing = hostStanding(host, book);
  if (standing === DEVICE_STANDING.ONLINE) return WORDS.ONLINE;
  if (standing === DEVICE_STANDING.CHECKING) return WORDS.CHECKING;
  const age = presenceAgeMs(book, host.id);
  // Note that the age is the service's, so the moment is made from the window's clock and the age alone.
  const lastSeen = age === undefined ? "" : ` · last seen ${agoText(now - age, now)}`;
  return `${standing === DEVICE_STANDING.OFFLINE ? "Offline" : WORDS.UNKNOWN}${lastSeen}`;
}

/**
 * Where a host that is not this Mac stands in its setup: getting ready, or
 * couldn't set up and why; nothing for one that is ready, or offline,
 * whose last word of its setup may no longer hold. It offers no Retry,
 * since nothing here can ask another machine's host to try again.
 */
function setupLine(host: Host, standing: DeviceStanding): HostLine | null {
  if (host.setup === undefined || standing === DEVICE_STANDING.OFFLINE) return null;
  return setupLineOf(host.setup, host.setupFailure);
}

/** How a host is upgraded, under its Upgrade needed: this Mac's app updated, the install command's upgrade run on a server, and either for another Mac. */
function UpgradeHow({
  platform,
  thisMac,
  installScriptUrl,
}: {
  platform: DevicePlatform;
  thisMac: boolean;
  installScriptUrl: string;
}): React.JSX.Element {
  if (thisMac) return <Text>{WORDS.MAC_UPGRADE}</Text>;
  const mac = platform === DEVICE_PLATFORM.DARWIN;
  const command = (
    <CodeCard
      title={mac ? WORDS.OTHER_MAC_UPGRADE_TITLE : WORDS.UPGRADE_TITLE}
      titleIs={CODE_CARD_TITLE.WORDS}
      code={hostUpgradeCommand(installScriptUrl)}
      copy={copyThroughShell}
    />
  );
  if (!mac) return command;
  return (
    <Stack gap={GAP.CONTROL}>
      <Text>{WORDS.OTHER_MAC_UPGRADE}</Text>
      {command}
    </Stack>
  );
}

/** What Remove says goes, whatever the machine. */
const REMOVED =
  "It stops taking agents now, and its agents stop. Their tasks and transcripts stay in Luke.";

/**
 * What Remove says, and the title of the uninstall command it shows, by what
 * the machine is: a server the install command set up is cleaned on the box
 * itself, this Mac's own This Mac joins again only from its app, and another
 * Mac may be either, since the service lists no word of how a Mac joined.
 */
const REMOVE_WORDS = {
  SERVER: { body: REMOVED, uninstall: "Run this on the host to remove Luke from it" },
  THIS_MAC: {
    body: `${REMOVED} To use it again, choose Turn on again under This Mac.`,
    uninstall: undefined,
  },
  MAC: {
    body: `${REMOVED} If you added it from the Luke app on it, choose Turn on again under This Mac there to use it again.`,
    uninstall: "If you used the install command, run this on it",
  },
} as const;

/** One machine's row: its name, what it is and whether it is online, where its setup stands while it is not ready, for a Mac whose login it runs in, Upgrade needed with how to upgrade it, and Remove behind its ⋯; for this Mac, where its `luke-host` stands and Retry where it failed. */
function HostRow({
  host,
  book,
  now,
  installScriptUrl,
  onRemove,
  thisMac,
}: {
  host: Host;
  book: PresenceBook;
  now: number;
  installScriptUrl: string;
  onRemove: (id: string) => Promise<ActionResult>;
  /** Where this Mac stands, on the row of the machine it is enrolled as alone. */
  thisMac?: ThisMacHost | undefined;
}): React.JSX.Element {
  const removing = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    () => onRemove(host.id),
    confirmFailure(FAILURE_SURFACE.HOST_REMOVE),
  );
  // Note that a service older than platforms listed only Linux servers.
  const platform = host.platform ?? DEVICE_PLATFORM.LINUX;
  const seen = `${DEVICE_PLATFORM_NAME[platform]} · ${seenWords(host, book, now)}`;
  const removeWords =
    thisMac !== undefined
      ? REMOVE_WORDS.THIS_MAC
      : platform === DEVICE_PLATFORM.DARWIN
        ? REMOVE_WORDS.MAC
        : REMOVE_WORDS.SERVER;
  // Note that this Mac's own line is its app's reading of its `luke-host`, which says its setup and more, with Retry.
  const line = thisMac !== undefined ? thisMac.line : setupLine(host, hostStanding(host, book));
  const session: HostLine | null =
    platform === DEVICE_PLATFORM.DARWIN
      ? { words: macSessionWords(host.loginName), state: SETTINGS_ROW_STATE.PLAIN }
      : null;
  return (
    <>
      <MenuRow
        thing="Host"
        alone
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
          label: thisMac === undefined ? host.name : `${host.name} (this Mac)`,
          adornment: host.upgradeNeeded ? (
            <Badge tone={STATUS_TONE.ATTENTION}>{WORDS.UPGRADE_NEEDED}</Badge>
          ) : undefined,
          description: (
            <>
              {host.upgradeNeeded && host.version !== null
                ? `${seen} · runs ${host.version}`
                : seen}
              {session === null ? null : <HostStateLine line={session} />}
              {line === null ? null : <HostStateLine line={line} />}
            </>
          ),
          control: thisMac === undefined ? undefined : <ThisMacAct thisMac={thisMac} />,
          below: !host.upgradeNeeded ? undefined : (
            <UpgradeHow
              platform={platform}
              thisMac={thisMac !== undefined}
              installScriptUrl={installScriptUrl}
            />
          ),
        }}
      />
      <ConfirmDialog
        open
        confirm={removing}
        question={{
          title: `Remove ${host.name}?`,
          body: removeWords.body,
          verb: "Remove",
          running: "Removing",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      >
        {removeWords.uninstall === undefined ? null : (
          <CodeCard
            title={removeWords.uninstall}
            titleIs={CODE_CARD_TITLE.WORDS}
            code={HOST_UNINSTALL_COMMAND}
            copy={copyThroughShell}
          />
        )}
      </ConfirmDialog>
    </>
  );
}

/** The dialog Add hosts opens: the install command with the token in it, shown this once, and Revoke. */
function AddHostsDialog({
  shown,
  onRevoke,
  onClose,
}: {
  shown: ShownToken;
  onRevoke: () => Promise<ActionResult>;
  onClose: () => void;
}): React.JSX.Element {
  const revoking = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    onRevoke,
    confirmFailure(FAILURE_SURFACE.HOST_REVOKE),
  );
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
          <Text>{`It works until ${momentText(shown.expiresAt)}, and isn't shown again.`}</Text>
          <CodeCard
            title={WORDS.INSTALL_TITLE}
            titleIs={CODE_CARD_TITLE.WORDS}
            code={hostInstallCommand(shown.installScriptUrl, shown.installToken)}
            copy={copyThroughShell}
          />
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

/** The Hosts page's one group, untitled under the page's own title: the member's machines, read when the page opens, or why they cannot be drawn, and Add hosts under them. */
export function HostsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element | null {
  const { act } = useAct();
  const now = useSecond();
  const minute = Math.floor(useMinute() / MINUTE_MS);
  const [hosts, setHosts] = useState<readonly Host[] | undefined>(undefined);
  // Note that the list is read once a minute for the hosts that join or leave, while each host's beat is the window's shared presence, read often enough that a host that keeps beating never reads offline.
  const book = useDevicePresence(signedIn);
  const [installScriptUrl, setInstallScriptUrl] = useState<string | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const [shown, setShown] = useState<ShownToken | undefined>(undefined);
  const thisMac = useThisMacHost(signedIn);

  // The page opening reads the hosts the service holds now, which a server may just have joined.
  useEffect(() => {
    if (!signedIn) return;
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
  }, [act, signedIn, attempt]);

  // A server that joins while the page stands is drawn within a minute, with no skeleton over the list the member is reading.
  // Note that while a host is getting ready the list is read every few seconds instead, so it reads ready, or why it couldn't set up, about as soon as This Mac's row would.
  const settingUp = hosts?.some((host) => host.setup === DEVICE_SETUP.PREPARING) ?? false;
  const period = settingUp ? Math.floor(now / SETTING_UP_READ_EVERY_MS) : minute;
  const mountMinute = useRef(minute);
  useEffect(() => {
    // The mount's own read is the effect above, so the minute it began in stands as it is.
    if (!signedIn || (!settingUp && period === mountMinute.current)) return;
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
  }, [act, signedIn, settingUp, period]);

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

  const thisMacId = thisMac.standing?.deviceId;
  const listedMac =
    thisMacId === undefined ? undefined : hosts?.find((host) => host.id === thisMacId);
  const loaded = signedIn && hosts !== undefined && installScriptUrl !== undefined;
  const ordered =
    hosts === undefined || listedMac === undefined
      ? (hosts ?? [])
      : [listedMac, ...hosts.filter((host) => host !== listedMac)];
  const thisMacAlone = listedMac === undefined && thisMac.line !== null;
  return (
    <>
      {/* Note that signed out the section holds the search anchor, since Add hosts is drawn only for a signed-in member. */}
      <SettingsSection anchor={signedIn ? undefined : SETTINGS_SEARCH_ROW.ADD_HOSTS}>
        {!signedIn ? (
          <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
        ) : loaded && ordered.length === 0 && !thisMacAlone ? (
          <SettingsLine>{WORDS.NONE}</SettingsLine>
        ) : loaded ? (
          <>
            {thisMacAlone && thisMac.line !== null ? (
              <ThisMacHostRow thisMac={thisMac} line={thisMac.line} />
            ) : null}
            {ordered.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                book={book}
                now={now}
                installScriptUrl={installScriptUrl}
                onRemove={remove}
                thisMac={host === listedMac ? thisMac : undefined}
              />
            ))}
          </>
        ) : readFailed ? (
          <SettingsLine>
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.HOSTS_READ)}
              onRetry={() => setAttempt((count) => count + 1)}
            >
              {WORDS.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label={readingWords("your hosts")} rows={HOSTS_SKELETON} />
        )}
      </SettingsSection>
      {signedIn ? (
        <div className={ADD_LINE} {...searchAnchorProps(SETTINGS_SEARCH_ROW.ADD_HOSTS)}>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<PlusIcon />}
            busy={adding}
            busyLabel={WORDS.ADDING}
            onClick={add}
          >
            {WORDS.ADD}
          </Button>
          <ErrorLine
            level={ANNOUNCE.ALERT}
            error={
              addFailed
                ? {
                    words: WORDS.ADD_FAILED,
                    failure: unreadShown(FAILURE_SURFACE.HOST_INSTALL_COMMAND),
                  }
                : undefined
            }
          />
        </div>
      ) : null}
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
  );
}
