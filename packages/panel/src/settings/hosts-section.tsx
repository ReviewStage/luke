import { DEVICE_STANDING, type DeviceStanding } from "@luke/features/agent-wire";
import {
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DevicePlatform,
  HOST_UPDATE,
} from "@luke/features/device-agent-wire";
import {
  HOST_UNINSTALL_COMMAND,
  type Host,
  hostInstallCommand,
  hostUpgradeCommand,
} from "@luke/features/host-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { agoText } from "@luke/features/time-format";
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
  ErrorState,
  GAP,
  PlusIcon,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  SPINNER_SIZE,
  SpinnerRing,
  STATUS_TONE,
  Stack,
  TEXT_TONE,
  Text,
  TrashIcon,
  useAnnounce,
  useConfirmDialog,
  useMinute,
  useSecond,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
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
import { hostUpdateWords } from "../device-setup.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { HostConnectDialog, useHostConnect } from "./host-connect-dialog.js";
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
 * hosts-section.tsx -- Settings › Hosts: the member's own machines that run their local agents, Linux servers and Macs alike, and Add hosts, which shows the install command and waits for the hosts it adds.
 *
 * A machine is any device of the member's enrolled with a secret of its own
 * (`@luke/features/host-wire`): a Linux server or a Mac that ran the install
 * command, or a Mac its desktop enrolled. The list names each, what it is by
 * its platform (`DEVICE_PLATFORM_NAME`), whether it is online, held against
 * the window's own clock as a Mac's label is (`macOnline`), when it was last
 * seen otherwise, the host program's version it last called with, where its
 * setup stands while it is not ready, getting ready or couldn't set up and
 * why, in the words This Mac's row says them in (`setupLineOf`), where its
 * update to a newer release stands while one is under way, waiting for its
 * agents to finish, updating, or couldn't update and why
 * (`hostUpdateWords`), on every row but This Mac's, whose line is its own
 * app's reading, for a Mac that it runs while its user is logged in,
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
 * Add hosts shows the install command, public and the same for every
 * member, which pairs a box with a code the member approves, and waits.
 * While it stands the list is read every few seconds, and the dialog names
 * each host the list holds that it did not hold as the dialog opened,
 * moving by itself from connecting through getting ready to ready or
 * couldn't set up and why (`joinedLine`). A host so named is approved,
 * since the service lists no box before its approve, so the dialog never
 * names one that is not. A pairing's link opened in this window stands its
 * dialog over the page, Add hosts among it (`host-connect-dialog.tsx`), and
 * once Connect makes the host the list is read again over the rows
 * standing, so an open Add hosts names it and moves on by itself. The page
 * stands only while the Bring your own host
 * experiment is on (`settings-rows.ts`'s `PAGE_EXPERIMENT`), so while it is
 * off nothing here is drawn, read, or turned on.
 */

/** `useMinute` counts in milliseconds, so the minute the list stands on is read off it in whole ones. */
const MINUTE_MS = 60_000;

/** How often the list is read while a host is getting ready or updating, or Add hosts waits for one, as often as This Mac's row reads its own. */
const WATCHED_READ_EVERY_MS = 5_000;

/**
 * A size containment: the command does not wrap, so without it its width
 * widens the dialog's grid track past a phone's and puts its card off the
 * screen. It scrolls inside its card instead.
 */
const COMMAND = "contain-inline-size";

const WORDS = {
  ADD: "Add hosts",
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
  INSTALL_NEXT: "Then open the link it prints, and approve its code.",
  MAC_SESSION: "A Mac host runs your agents only while its user is logged in.",
  WAITING: "Waiting for approval",
  CONNECTING: "Connecting…",
  READY: "Ready",
  CLOSE: "Close",
} as const;

/** The row that stands while the machines are read: a machine with its ⋯. */
const HOSTS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.MORE] },
];

/** Add hosts' own line under the list, the button stretched to the rows' width. */
const ADD_LINE = "grid";

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
/** A remove the service did not take, said in the dialog that asked. */
const REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "Luke could not reach the service. Try again.",
};

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

/**
 * Where a host that is not this Mac stands in updating itself: waiting for
 * its agents to finish or updating, plain, or couldn't update and why,
 * tinted; nothing while no update is under way, or while it is offline,
 * whose last word of its update may no longer hold.
 */
function updateLine(host: Host, standing: DeviceStanding): HostLine | null {
  if (host.update === undefined || standing === DEVICE_STANDING.OFFLINE) return null;
  return {
    words: hostUpdateWords(host.update, host.updateFailure),
    state:
      host.update === HOST_UPDATE.FAILED ? SETTINGS_ROW_STATE.ATTENTION : SETTINGS_ROW_STATE.PLAIN,
  };
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

/** One machine's row: its name, what it is, whether it is online, and its version, where its setup stands while it is not ready and its update while one is under way, for a Mac whose login it runs in, Upgrade needed with how to upgrade it, and Remove behind its ⋯; for this Mac, where its `luke-host` stands and Retry where it failed. */
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
  const versioned = host.version === null ? seen : `${seen} · ${host.version}`;
  const removeWords =
    thisMac !== undefined
      ? REMOVE_WORDS.THIS_MAC
      : platform === DEVICE_PLATFORM.DARWIN
        ? REMOVE_WORDS.MAC
        : REMOVE_WORDS.SERVER;
  const standing = hostStanding(host, book);
  // Note that this Mac's own line is its app's reading of its `luke-host`, which says its setup and more, with Retry, and its update is its app's.
  const line = thisMac !== undefined ? thisMac.line : setupLine(host, standing);
  const update = thisMac !== undefined ? null : updateLine(host, standing);
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
              {versioned}
              {session === null ? null : <HostStateLine line={session} />}
              {line === null ? null : <HostStateLine line={line} />}
              {update === null ? null : <HostStateLine line={update} />}
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

/**
 * Where a host that joined while Add hosts stood is, in the words its row
 * says its setup in: connecting until its program first calls in, then
 * getting ready, or couldn't set up and why, while it says so, and ready.
 * Like its row it offers no Retry, since a host retries its setup itself.
 */
function joinedLine(host: Host): HostLine {
  // Note that a service older than `calledIn` lists none, so its hosts read as called in rather than connecting for good.
  if (host.calledIn === false) return { words: WORDS.CONNECTING, state: SETTINGS_ROW_STATE.PLAIN };
  if (host.setup !== undefined) return setupLineOf(host.setup, host.setupFailure);
  return { words: WORDS.READY, state: SETTINGS_ROW_STATE.CONNECTED };
}

/**
 * The dialog Add hosts opens: the install command, what comes after it, and
 * the hosts that joined since it opened, each where it stands, or a wait
 * until one does; a reader is told as each moves. Its one answer is a
 * quiet Close, which only closes: nothing waits on it, since the dialog
 * moves on by itself whether or not it is pressed.
 */
function AddHostsDialog({
  known,
  hosts,
  installScriptUrl,
  onClose,
}: {
  /** The ids of the account's hosts as the dialog opened, which it never names as joined. */
  known: ReadonlySet<string>;
  hosts: readonly Host[];
  installScriptUrl: string;
  onClose: () => void;
}): React.JSX.Element {
  const joined = hosts.filter((host) => !known.has(host.id));
  useAnnounce(
    ANNOUNCE.POLITE,
    joined.map((host) => `${host.name}: ${joinedLine(host).words}`).join(" "),
  );
  return (
    <Dialog
      open
      title={WORDS.ADD}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
          {WORDS.CLOSE}
        </Button>
      }
    >
      <div className={COMMAND}>
        <CodeCard
          title={WORDS.INSTALL_TITLE}
          titleIs={CODE_CARD_TITLE.WORDS}
          code={hostInstallCommand(installScriptUrl)}
          copy={copyThroughShell}
        />
      </div>
      <Stack gap={GAP.TIGHT}>
        <Text>{WORDS.INSTALL_NEXT}</Text>
        <Text tone={TEXT_TONE.MUTED}>{WORDS.MAC_SESSION}</Text>
      </Stack>
      <SettingsSection>
        {joined.length === 0 ? (
          <SettingsRow leading={<SpinnerRing size={SPINNER_SIZE.INLINE} />} label={WORDS.WAITING} />
        ) : (
          joined.map((host) => (
            <SettingsRow
              key={host.id}
              label={host.name}
              description={
                <>
                  {DEVICE_PLATFORM_NAME[host.platform ?? DEVICE_PLATFORM.LINUX]}
                  <HostStateLine line={joinedLine(host)} />
                </>
              }
            />
          ))
        )}
      </SettingsSection>
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
  // The ids of the account's hosts as Add hosts opened, while its dialog stands.
  const [adding, setAdding] = useState<ReadonlySet<string> | undefined>(undefined);
  const thisMac = useThisMacHost(signedIn);
  const [connecting, closeConnect] = useHostConnect();
  // A pairing's question does not outlive the page it was asked over.
  useEffect(() => closeConnect, [closeConnect]);

  // The page opening reads the hosts the service holds now, which a server may just have joined.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setHosts(undefined);
    setReadFailed(false);
    setAdding(undefined);
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
  // Note that while a host is getting ready or updating, or Add hosts waits for one, the list is read every few seconds instead, so a host reads approved, ready, updated, or why it couldn't about as soon as This Mac's row would.
  const changing =
    hosts?.some(
      (host) => host.setup === DEVICE_SETUP.PREPARING || host.update === HOST_UPDATE.UPDATING,
    ) ?? false;
  const watched = changing || adding !== undefined;
  const period = watched ? Math.floor(now / WATCHED_READ_EVERY_MS) : minute;
  // A read after the page's first lands over the list standing, so no skeleton covers the rows the member is reading.
  const relist = useCallback(
    (live: () => boolean) =>
      act(ACT_KIND.HOSTS_LIST).then(
        (answer) => {
          if (!live() || "failure" in answer) return;
          setHosts((standing) => (standing === undefined ? standing : answer.hosts));
        },
        () => undefined,
      ),
    [act],
  );
  const mountMinute = useRef(minute);
  useEffect(() => {
    // The mount's own read is the effect above, so the minute it began in stands as it is.
    if (!signedIn || (!watched && period === mountMinute.current)) return;
    let live = true;
    relist(() => live);
    return () => {
      live = false;
    };
  }, [signedIn, watched, period, relist]);

  // Note that Add hosts waits for the list, since the dialog names only the hosts the list did not hold as it opened, and its command names the script the list's answer does.
  const add = useCallback(() => {
    if (hosts !== undefined) setAdding(new Set(hosts.map((host) => host.id)));
  }, [hosts]);

  // Note that closing Add hosts reads the list once more, so a host approved since the dialog's last read is drawn now rather than at the next minute.
  const closeAdd = useCallback(() => {
    setAdding(undefined);
    relist(() => true);
  }, [relist]);

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
            disabled={!loaded}
            onClick={add}
          >
            {WORDS.ADD}
          </Button>
        </div>
      ) : null}
      {adding === undefined || !loaded ? null : (
        <AddHostsDialog
          known={adding}
          hosts={hosts}
          installScriptUrl={installScriptUrl}
          onClose={closeAdd}
        />
      )}
      {/* Note that a pairing's dialog comes after Add hosts, so it stands over it where both are open. */}
      {connecting === undefined || !signedIn ? null : (
        <HostConnectDialog
          key={connecting}
          code={connecting}
          onClose={closeConnect}
          onConnected={() => relist(() => true)}
        />
      )}
    </>
  );
}
