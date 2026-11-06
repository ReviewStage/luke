import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import type { HostLine } from "@repo/features/host-live";
import { HOST_UNINSTALL_COMMAND, hostInstallCommand } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readFailedWords, readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  ANNOUNCE,
  Checkbox,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  type DialogConfirm,
  ErrorState,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  STATUS_TONE,
  Switch,
  TEXT_TONE,
  Text,
  useAnnounce,
  useConfirmDialog,
  useSecond,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { DEVICE_PLATFORM_NAME } from "../device-platform.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { hostsQuery, hostsRetryMutation } from "../live-reads.js";
import {
  isThisMac,
  type ListedMachine,
  machineName,
  THIS_MAC,
  useThisMac,
} from "../machine-name.js";
import { DeviceGlyph } from "../tasks/runs-on.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { HostConnectDialog, useHostConnect } from "./host-connect-dialog.js";
import { MenuRow } from "./menu-row.js";

const SECTION_TITLE = {
  HOSTS: "Your hosts",
  ADD: "Add a host",
} as const;

const WORDS = {
  NONE: "No hosts yet.",
  ONLINE: "Online",
  OFFLINE: "Offline",
  SETTING_UP: "Setting up…",
  UPDATING: "Updating…",
  INSTALL_LABEL: "Run this on a Mac or Linux server",
  INSTALL_NEXT:
    "Then open the link it prints, and approve its code. A Mac runs your agents only while its user is logged in.",
  INSTALL_FIELD: "Install command",
  CONNECTED: "is connected.",
} as const;

const HOSTS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.MORE] },
];

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
const REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "Could not reach the service. Try again.",
};

function machineOf(host: HostLine): ListedMachine {
  return { deviceId: host.id, name: host.name, machineId: host.machineId, model: host.model };
}

function standingOf(
  host: HostLine,
  book: PresenceBook,
  joined: boolean,
): { readonly words: string; readonly state: SettingsRowState } | undefined {
  if (host.update === HOST_UPDATE.UPDATING) {
    return { words: WORDS.UPDATING, state: SETTINGS_ROW_STATE.PLAIN };
  }
  const beat = presenceStanding(book, host.id);
  if (beat === undefined && joined)
    return { words: WORDS.SETTING_UP, state: SETTINGS_ROW_STATE.PLAIN };
  const standing = beat ?? DEVICE_STANDING.OFFLINE;
  if (standing === DEVICE_STANDING.OFFLINE) {
    return { words: WORDS.OFFLINE, state: SETTINGS_ROW_STATE.ATTENTION };
  }
  if (standing !== DEVICE_STANDING.ONLINE) return undefined;
  return { words: WORDS.ONLINE, state: SETTINGS_ROW_STATE.CONNECTED };
}

function StandingLine({
  host,
  book,
  joined,
}: {
  host: HostLine;
  book: PresenceBook;
  joined: boolean;
}): React.JSX.Element {
  const kind = DEVICE_PLATFORM_NAME[host.platform ?? DEVICE_PLATFORM.LINUX];
  const standing = standingOf(host, book, joined);
  if (standing === undefined) return <>{kind}</>;
  if (standing.state === SETTINGS_ROW_STATE.CONNECTED) {
    const line = `${standing.words} · ${kind}`;
    return <SettingsRowStateLine state={standing.state}>{line}</SettingsRowStateLine>;
  }
  return (
    <>
      <SettingsRowStateLine state={standing.state}>{standing.words}</SettingsRowStateLine>
      {` · ${kind}`}
    </>
  );
}

function MachineMark({ platform }: { platform: HostLine["platform"] }): React.JSX.Element {
  return (
    <SettingsRowMark>
      <DeviceGlyph device={{ platform: platform ?? DEVICE_PLATFORM.LINUX }} />
    </SettingsRowMark>
  );
}

const THIS_MAC_WORDS = {
  SWITCH: "Run agents on this Mac",
  OFF: "Run your agents on this Mac instead of the cloud.",
  TURN_ON_FAILED: "Could not turn on this Mac. Try again.",
} as const;

const THIS_MAC_OFF = {
  title: "Turn off agents on this Mac?",
  body: `${PRODUCT_NAME} removes its host from this Mac, and any agent running here stops. Their tasks and transcripts stay in ${PRODUCT_NAME}.`,
  verb: "Turn off",
  running: "Turning off",
} as const;

function deleteFoldersWords(count: number): { readonly label: string; readonly detail: string } {
  return {
    label: `Delete its agents' ${count === 1 ? "folder" : `${count} folders`} in ~/.vespin/agents`,
    detail: "Work in them that wasn't pushed goes with them.",
  };
}

const REMOVED = `It stops taking agents now, and ${PRODUCT_NAME} removes itself from the machine, its agents' folders included. Their tasks and transcripts stay in ${PRODUCT_NAME}.`;

const REMOVED_OFFLINE =
  "It's offline, so it does that the next time it's online. If it won't be, run this on it:";

function HostRow({
  host,
  label,
  book,
  joined,
  onRemove,
  locked,
}: {
  host: HostLine;
  label: string;
  book: PresenceBook;
  joined: boolean;
  onRemove: () => void;
  locked: boolean;
}): React.JSX.Element {
  return (
    <MenuRow
      thing={label}
      actions={[
        {
          label: "Remove",
          icon: <GLYPH.REMOVE />,
          danger: true,
          disabled: locked,
          onSelect: onRemove,
        },
      ]}
      row={{
        leading: <MachineMark platform={host.platform} />,
        label: <ReplayMask>{label}</ReplayMask>,
        description: <StandingLine host={host} book={book} joined={joined} />,
        landed: joined,
      }}
    />
  );
}

function ThisMacRow({
  host,
  book,
  on,
  onChange,
}: {
  host: HostLine | undefined;
  book: PresenceBook;
  on: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  const description = !on ? (
    THIS_MAC_WORDS.OFF
  ) : host === undefined ? (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
      {WORDS.OFFLINE}
    </SettingsRowStateLine>
  ) : (
    <StandingLine host={host} book={book} joined={false} />
  );
  return (
    <SettingsRow
      leading={<MachineMark platform={DEVICE_PLATFORM.DARWIN} />}
      label={THIS_MAC}
      description={description}
      labelsControl
    >
      {(control) => (
        <Switch
          id={control.controlId}
          checked={on}
          label={THIS_MAC_WORDS.SWITCH}
          describedBy={control["aria-describedby"]}
          onChange={(next) => onChange(next)}
        />
      )}
    </SettingsRow>
  );
}

interface RemoveAsked {
  readonly accountId: string | undefined;
  readonly host: HostLine;
  readonly label: string;
  readonly offline: boolean;
}

function RemoveHostDialog({
  asked,
  confirm,
}: {
  asked: RemoveAsked | undefined;
  confirm: DialogConfirm;
}): React.JSX.Element {
  return (
    <ConfirmDialog
      open
      confirm={confirm}
      question={{
        title: `Remove ${asked?.label ?? ""}?`,
        body: REMOVED,
        verb: "Remove host",
        running: "Removing",
        loss: CONFIRM_LOSS.IRREVERSIBLE,
        replayUnmasked: true,
        titleReplayMasked: true,
      }}
    >
      {asked?.offline === true ? (
        <>
          <Text tone={TEXT_TONE.MUTED}>{REMOVED_OFFLINE}</Text>
          <CopyField
            label="Uninstall command"
            value={HOST_UNINSTALL_COMMAND}
            what="command"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
            prompt={COPY_FIELD_PROMPT.SHELL}
          />
        </>
      ) : null}
    </ConfirmDialog>
  );
}

function AddHostSection({
  installScriptUrl,
  joined,
}: {
  installScriptUrl: string;
  joined: string | undefined;
}): React.JSX.Element {
  useAnnounce(ANNOUNCE.POLITE, joined === undefined ? "" : `${joined} ${WORDS.CONNECTED}`);
  return (
    <SettingsSection title={SECTION_TITLE.ADD} anchor={SETTINGS_SEARCH_ROW.ADD_HOSTS}>
      <SettingsRow
        label={WORDS.INSTALL_LABEL}
        description={WORDS.INSTALL_NEXT}
        below={() => (
          <CopyField
            label={WORDS.INSTALL_FIELD}
            value={hostInstallCommand(installScriptUrl)}
            what="command"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
            prompt={COPY_FIELD_PROMPT.SHELL}
          />
        )}
      />
      {joined === undefined ? null : (
        <SettingsLine>
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            <ReplayMask>{joined}</ReplayMask> {WORDS.CONNECTED}
          </SettingsRowStateLine>
        </SettingsLine>
      )}
    </SettingsSection>
  );
}

export function HostsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element | null {
  const { mutateAsync: sendHostsRemove, ...hostRemoving } = useMutation(
    actMutation(ACT_KIND.HOSTS_REMOVE),
  );
  useSecond();
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(hostsQuery(signedIn ? accountId : undefined));
  const retry = useMutation(hostsRetryMutation());
  const hosts = read.data?.hosts;
  const installScriptUrl = read.data?.installScriptUrl;
  const book = useDevicePresence(signedIn);
  const [known, setKnown] = useState<
    { readonly accountId: string | undefined; readonly ids: ReadonlySet<string> } | undefined
  >(undefined);
  if (hosts !== undefined && (known === undefined || known.accountId !== accountId)) {
    setKnown({ accountId, ids: new Set(hosts.map((host) => host.id)) });
  }
  const joinedNow = (host: HostLine) =>
    known !== undefined && known.accountId === accountId && !known.ids.has(host.id);
  const thisMac = useThisMac();
  const [connecting, closeConnect] = useHostConnect();
  useEffect(() => closeConnect, [closeConnect]);

  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);
  const removingAct = useConfirmAct(hostRemoving, {
    send: () => (asked === undefined ? Promise.resolve() : sendHostsRemove({ id: asked.host.id })),
    answered: (answer) => ("failure" in answer ? REFUSED : ACCEPTED),
    failed: () => REFUSED,
    refusedFirst: () => (asked === undefined ? REFUSED : undefined),
  });
  const removing = useConfirmDialog(
    { subject: asked !== undefined && asked.accountId === accountId, surfaceOpen: true },
    removingAct,
    confirmFailure(FAILURE_SURFACE.HOST_REMOVE),
  );
  const askRemove = (host: HostLine, label: string) => {
    const offline = standingOf(host, book, joinedNow(host))?.words === WORDS.OFFLINE;
    setAsked({ accountId, host, label, offline });
    removing.ask();
  };

  const turningOn = useMutation(actMutation(ACT_KIND.HOSTS_THIS_MAC_SET));
  const { mutateAsync: turnThisMacOff, ...offWriting } = useMutation(
    actMutation(ACT_KIND.HOSTS_THIS_MAC_SET),
  );
  const thisMacOn = turningOn.isPending || thisMac?.enrolled === true;
  const turnThisMacOn = () => {
    turningOn
      .mutateAsync({ on: true })
      .catch(() => undefined)
      .then((answer) => {
        if (answer !== undefined && !("failure" in answer)) return;
        showToast({
          words: THIS_MAC_WORDS.TURN_ON_FAILED,
          replayUnmasked: true,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.THIS_MAC_SET, cause: answer },
        });
      });
  };
  const [deleteFolders, setDeleteFolders] = useState(true);
  const agentFolders = thisMac?.agentFolders ?? 0;
  const turningOffAct = useConfirmAct(offWriting, {
    send: () =>
      turnThisMacOff({
        on: false,
        deleteFolders: deleteFolders || agentFolders === 0,
      }),
    answered: (answer) => ("failure" in answer ? REFUSED : ACCEPTED),
    failed: () => REFUSED,
  });
  const turningOff = useConfirmDialog(
    { subject: thisMac?.enrolled === true, surfaceOpen: true },
    turningOffAct,
    confirmFailure(FAILURE_SURFACE.THIS_MAC_SET),
  );
  const switchThisMac = (next: boolean) => {
    if (next) return turnThisMacOn();
    setDeleteFolders(true);
    turningOff.ask();
  };

  const listed = hosts?.map(machineOf) ?? [];
  const naming = thisMac?.enrolled === true ? thisMac : undefined;
  const listedMac =
    naming === undefined
      ? undefined
      : hosts?.find((host) =>
          naming.deviceId === undefined
            ? isThisMac(machineOf(host), naming)
            : host.id === naming.deviceId,
        );
  const loaded = signedIn && hosts !== undefined && installScriptUrl !== undefined;
  const others = hosts?.filter((host) => host !== listedMac) ?? [];
  const lastJoined = others.findLast(joinedNow);
  const empty = others.length === 0 && thisMac === undefined;
  const list = (
    <SettingsSection
      title={SECTION_TITLE.HOSTS}
      anchor={signedIn ? undefined : SETTINGS_SEARCH_ROW.ADD_HOSTS}
    >
      {!signedIn ? (
        <SettingsLine>{SIGNED_OUT_WORDS}</SettingsLine>
      ) : loaded && empty ? (
        <SettingsLine>{WORDS.NONE}</SettingsLine>
      ) : loaded ? (
        <>
          {thisMac === undefined ? null : (
            <ThisMacRow host={listedMac} book={book} on={thisMacOn} onChange={switchThisMac} />
          )}
          {others.map((host) => {
            const label = machineName(machineOf(host), listed, naming);
            return (
              <HostRow
                key={host.id}
                host={host}
                label={label}
                book={book}
                joined={joinedNow(host)}
                onRemove={() => askRemove(host, label)}
                locked={removing.busy}
              />
            );
          })}
        </>
      ) : read.isError ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.HOSTS_READ)}
            onRetry={() => retry.mutate()}
          >
            {readFailedWords("your hosts")}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton label={readingWords("your hosts")} rows={HOSTS_SKELETON} />
      )}
    </SettingsSection>
  );
  const add = loaded ? (
    <AddHostSection
      installScriptUrl={installScriptUrl}
      joined={
        lastJoined === undefined ? undefined : machineName(machineOf(lastJoined), listed, naming)
      }
    />
  ) : null;
  return (
    <>
      {loaded && empty ? (
        <>
          {add}
          {list}
        </>
      ) : (
        <>
          {list}
          {add}
        </>
      )}
      <RemoveHostDialog asked={asked} confirm={removing} />
      <ConfirmDialog
        open
        confirm={turningOff}
        question={{ ...THIS_MAC_OFF, loss: CONFIRM_LOSS.IRREVERSIBLE, replayUnmasked: true }}
      >
        {agentFolders === 0 ? null : (
          <Checkbox
            checked={deleteFolders}
            onChange={setDeleteFolders}
            label={deleteFoldersWords(agentFolders).label}
            detail={deleteFoldersWords(agentFolders).detail}
          />
        )}
      </ConfirmDialog>
      {connecting === undefined || !signedIn ? null : (
        <HostConnectDialog key={connecting} code={connecting} onClose={closeConnect} />
      )}
    </>
  );
}
