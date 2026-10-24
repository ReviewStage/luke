import type { GitHubRepository } from "@luke/features";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { TASK_CALL_FAILURE, type TasksRepositoriesAnswer } from "@luke/features/tasks-view";
import { countWords, orList, REFRESH_FAILED_WORDS } from "@luke/features/words";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import {
  AVATAR_SIZE,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  Chip,
  type ChipLook,
  ChipName,
  type ChipWidth,
  ErrorState,
  GearIcon,
  type MenuRow,
  POPOVER_ALIGN,
  type PopoverAlign,
  ProviderMark,
  SearchableMenu,
  Spinner,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
} from "@luke/ui";
import { repositoryFailureNote } from "@luke/ui/tasks-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { OPEN_SETTINGS_LABEL, useOpenSettings } from "../open-settings.js";
import { RepositoryPicture } from "../repository-picture.js";
import { RepositoryCard, repositoryMenuRow } from "../repository-row.js";
import { useWorkspaceMembers } from "./use-workspace-members.js";

/**
 * repository-chip.tsx -- the chip that names a task's GitHub repository, and the menu that picks one.
 *
 * Drawn along the composer card's foot for a task about to start, the way a
 * branch or model chip is: the owner's picture and `owner/name`, or the
 * GitHub mark and the pick it is waiting on. In the open task's toolbar it stands in the actions row,
 * reading `Choose repository` while the task has none; once the task names
 * one, the sidebar's row says which and the toolbar draws no chip, and the
 * menu alone is left, opened by the task menu's Change repository and
 * hung from the toolbar. Its menu is the shared searchable one: a search over every
 * repository the GitHub connected to the workspace reaches, the
 * repositories the account's tasks were about lately first and the rest as
 * GitHub last saw them change, each under its owner's picture, one the
 * developer's own GitHub token reaches marked Token. Nothing the
 * workspace's GitHub does not reach is offered, so a task never starts on
 * a repository its workspace cannot work in; a pick the read finds out of
 * reach is handed back, and with nothing to offer the chip reads No
 * repository, which a task can start with. With no
 * GitHub connected to the workspace, or one GitHub removed or suspended,
 * the menu says which in the list's place: an owner or an admin is offered
 * Open Settings at the workspace's GitHub repositories, the one place they
 * are set, and a member is told which owners and admins, by name, to ask;
 * the same holds where GitHub is installed and reaches no repository. The list is read from the service when the chip mounts and again
 * whenever the window takes focus, so a developer back from connecting
 * GitHub in the browser sees the change on the next opening; nothing polls. The menu
 * is placed as a Settings picker's is, below the chip or above it where the
 * window leaves more room there, its list capped to that room. It
 * closes on a choice, on Escape, and on focus leaving it; Escape stops
 * there, so it closes the menu and not the panel behind it.
 */

/** What the chip's menu offers, read from the account's tasks and the service. */
export interface RepositoryChooser {
  /** The repositories the account's tasks were about lately, the newest first, each once. */
  recent: readonly string[];
  /** Reads the repositories the account reaches now, as the service answers them. */
  read: () => Promise<TasksRepositoriesAnswer>;
  /** Opens a page of GitHub's in the browser, such as a repository's own. */
  openGitHub: (url: string) => void;
  /** Whether a repository is drawn with its owner's picture: not in a fixture run (`repository-picture.tsx`). */
  pictures: boolean;
  /** The workspace the list is for, where one is chosen; a chip keyed by it reads afresh when it changes. */
  scope?: string | undefined;
  /** Whether the account manages that workspace, so can connect its GitHub; a member is told to ask. */
  manages: boolean;
  /** The workspace's name, which a list with no GitHub connected says it of. */
  workspaceName?: string | undefined;
  /**
   * Whether the workspace has a GitHub connected, as its row last said: a read
   * that then finds none installed means GitHub removed or suspended it, which
   * the list says rather than that none is connected, whether or not the row
   * has heard yet.
   */
  connected?: boolean | undefined;
}

/** Where the chip stands, which is how it is sized. */
export const CHIP_PLACE = {
  COMPOSER: "composer",
  TOOLBAR: "toolbar",
  /** A form row's value, as a Settings picker's chip is drawn. */
  FIELD: "field",
} as const;

export type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

/** The chip's look in each place: the composer's pill, the toolbar chip the toolbar's buttons beside it are drawn as, or a form row's field. */
const PLACE_LOOK = {
  [CHIP_PLACE.COMPOSER]: CHIP_LOOK.PILL,
  [CHIP_PLACE.TOOLBAR]: CHIP_LOOK.TOOLBAR,
  [CHIP_PLACE.FIELD]: CHIP_LOOK.FIELD,
} as const satisfies Record<ChipPlace, ChipLook>;

/** The chip's words while it waits on a pick. */
const CHOOSE_LABEL = "Choose repository";

/** The chip's words where the workspace's GitHub reaches nothing to pick. */
const NONE_LABEL = "No repository";

/** What the menu says in the list's place. */
const MENU_NOTE = {
  NONE_REACHED: "Luke can't see any repository yet.",
  NOT_CONNECTED: "No GitHub is connected to this workspace yet.",
  NOT_CONNECTED_IN: (workspace: string) => `${workspace} has no GitHub connected yet.`,
  LAPSED: "This workspace's GitHub connection was removed or suspended on GitHub.",
  LAPSED_IN: (workspace: string) =>
    `${workspace}'s GitHub connection was removed or suspended on GitHub.`,
  NO_MATCH: "No repositories match",
} as const;

/** What a member is told to ask the workspace's owners and admins to do, each finishing "Ask … to". */
const OWNER_ASK = {
  CONNECT: "connect GitHub",
  RECONNECT: "reconnect GitHub",
  ADD_REPOSITORY: "add a repository to Luke's GitHub App",
} as const;

type OwnerAsk = (typeof OWNER_ASK)[keyof typeof OWNER_ASK];

/** How many owners and admins a member's note names before it counts the rest. */
const NAMED_OWNERS = 3;

/**
 * What a menu with nothing to pick says first, for an owner or an admin or
 * for a member: that GitHub was removed or suspended, or that none is
 * connected, which a member is told through the ask beneath instead. A
 * lapsed workspace says so to both.
 */
function unconnectedLines(chooser: RepositoryChooser): readonly string[] {
  const name = chooser.workspaceName;
  if (chooser.connected === true) {
    return [name === undefined ? MENU_NOTE.LAPSED : MENU_NOTE.LAPSED_IN(name)];
  }
  if (chooser.manages) {
    return [name === undefined ? MENU_NOTE.NOT_CONNECTED : MENU_NOTE.NOT_CONNECTED_IN(name)];
  }
  return [];
}

/**
 * A member's way out of a dead end: the workspace's owners and admins by
 * name, who alone can fix it, read while the note stands. Until the read
 * answers, or if it never does, the note says an owner or admin without
 * names, since a name is only ever a help.
 */
function AskOwners({
  workspaceId,
  workspaceName,
  ask,
}: {
  workspaceId: string | undefined;
  /** The workspace, named where the note above does not name it. */
  workspaceName: string | undefined;
  ask: OwnerAsk;
}): React.JSX.Element {
  const members = useWorkspaceMembers(workspaceId === undefined ? undefined : { id: workspaceId });
  const owners = (members ?? [])
    .filter((each) => each.role === WORKSPACE_ROLE.OWNER || each.role === WORKSPACE_ROLE.ADMIN)
    .map((each) => each.name);
  const named = owners.slice(0, NAMED_OWNERS);
  const rest = owners.length - named.length;
  const others = rest > 0 ? [countWords(rest, { one: "other", many: "others" })] : [];
  const words =
    owners.length === 0
      ? `Ask an owner or admin${workspaceName === undefined ? "" : ` of ${workspaceName}`} to ${ask}.`
      : `Ask ${orList([...named, ...others])} to ${ask}${workspaceName === undefined ? "" : ` for ${workspaceName}`}.`;
  return (
    <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {words}
    </Text>
  );
}

/** Whether the read's repositories hold one, as GitHub spells it or not. */
function listedIn(reached: readonly GitHubRepository[], repository: string): boolean {
  const wanted = repository.toLowerCase();
  return reached.some((each) => each.fullName.toLowerCase() === wanted);
}

/**
 * The menu's rows: the recent repositories first, then every other the App
 * reaches as the service ordered them, most recently updated first, each
 * once, every one under its owner's picture whether private or not. Once
 * the read has answered, a recent repository it does not list is left out,
 * because a plan started on it would be refused. A row names the repository
 * first and its owner muted after it, since the owner is the part rows most
 * often share, and a narrow menu cuts the end of a row; it is found by its
 * whole `owner/name` all the same.
 */
function repositoryRows(
  recent: readonly string[],
  reached: readonly GitHubRepository[] | undefined,
  pictures: boolean,
): MenuRow[] {
  const names =
    reached === undefined ? [...recent] : recent.filter((each) => listedIn(reached, each));
  for (const each of reached ?? []) {
    if (!names.includes(each.fullName)) names.push(each.fullName);
  }
  const onToken = new Set(
    (reached ?? [])
      .filter((each) => each.access === GITHUB_ACCESS.TOKEN)
      .map((each) => each.fullName),
  );
  return names.map((fullName) => repositoryMenuRow(fullName, pictures, onToken.has(fullName)));
}

/** What a read that listed answers: the repositories, and whether the App is installed. */
type ListedRepositories = Extract<
  TasksRepositoriesAnswer,
  { repositories: unknown }
>["repositories"];

export function RepositoryChip(props: {
  /** The repository named now, `owner/name`, or null while none is. */
  value: string | null;
  chooser: RepositoryChooser;
  onChoose: (repository: string) => void;
  /** Lets go of a pick the read finds the workspace's GitHub does not reach, where the pick is the chip's own to drop. */
  onUnreached?: (() => void) | undefined;
  /** Hears the repositories each successful read lists, `owner/name`. */
  onListed?: ((repositories: readonly string[]) => void) | undefined;
  /** Counts the asks from elsewhere to open the menu, each opening it. */
  openRequest?: number | undefined;
  place: ChipPlace;
  /** A form row's chip: the edge its menu hangs from, the trailing one where none is named, as a Settings picker's does. */
  align?: PopoverAlign | undefined;
  /** A form row's chip: how wide it stands, its words' own width where none is named. */
  width?: ChipWidth | undefined;
  /** A form row's chip: the ids of the row's words that describe it, its error among them while it has one. */
  describedBy?: string | undefined;
  /** A form row's chip: whether the row says its value is refused. */
  invalid?: true | undefined;
}): React.JSX.Element {
  const { chooser, openRequest, onUnreached, onListed, value } = props;
  const openSettings = useOpenSettings();
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [list, setList] = useState<TasksRepositoriesAnswer | undefined>(undefined);
  // The last read that listed, kept while a later one fails, so the rows stand and a line says the refresh did not land.
  const [lastListed, setLastListed] = useState<ListedRepositories | undefined>(undefined);
  const menuId = useId();
  const chip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** What held focus as the menu opened, which closing hands it back to. */
  const opener = useRef<HTMLElement | null>(null);
  // Note that the chooser is read through a ref, because the tab hands a
  // new one on every render and a read is owed to the window's focus, not
  // to a render.
  const latest = useRef(chooser);
  latest.current = chooser;

  const read = useCallback(() => {
    const settle = (answer: TasksRepositoriesAnswer) => {
      setList(answer);
      if ("repositories" in answer) setLastListed(answer.repositories);
    };
    latest.current.read().then(settle, () => {
      settle({ failure: TASK_CALL_FAILURE.UNANSWERED });
    });
  }, []);

  // The list is read on arrival and whenever the window comes back, which
  // is how a developer returns from installing the App in the browser.
  useEffect(() => {
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  // Each ask from elsewhere, such as the task menu's Change repository, opens the menu.
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, [openRequest]);

  // Note that we hand focus back to where it came from, the chip or the task
  // menu's button, as a native menu returns it to its trigger, because
  // closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const choose = (pick: () => void) => {
    close();
    pick();
  };

  const listed = lastListed;
  const failure = list !== undefined && "failure" in list ? list.failure : undefined;
  // A pick the read does not list is handed back, so nothing out of reach stands chosen.
  const unreached = value !== null && listed !== undefined && !listedIn(listed.repositories, value);
  useEffect(() => {
    if (unreached) onUnreached?.();
  }, [unreached, onUnreached]);
  useEffect(() => {
    if (listed !== undefined) onListed?.(listed.repositories.map((each) => each.fullName));
  }, [listed, onListed]);
  // A GitHub not connected, or reaching nothing, is mended at the workspace's GitHub row.
  const workspaceGitHub: SettingsLink = {
    page: SETTINGS_VIEW.WORKSPACE,
    section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
    ...(chooser.scope === undefined ? undefined : { workspaceId: chooser.scope }),
  };
  const press = () => {
    opener.current = trigger.current;
    setOpen(!open);
  };
  // The toolbar's chip is drawn only while the task has no repository; the sidebar names one it has.
  const triggerDrawn = props.place !== CHIP_PLACE.TOOLBAR || props.value === null;

  const rows = repositoryRows(chooser.recent, listed?.repositories, chooser.pictures);
  const label =
    props.value ?? (rows.length === 0 && listed !== undefined ? NONE_LABEL : CHOOSE_LABEL);
  // A list with nothing to pick says why, then offers an owner Settings and a member the owners to ask.
  const deadEnd = (lines: readonly string[], ask: OwnerAsk, askedOf: string | undefined) => (
    <>
      {lines.map((words) => (
        <Text key={words} as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {words}
        </Text>
      ))}
      {chooser.manages ? (
        <Button
          variant={BUTTON_VARIANT.QUIET}
          icon={<GearIcon />}
          onClick={() => choose(() => openSettings(workspaceGitHub))}
        >
          {OPEN_SETTINGS_LABEL}
        </Button>
      ) : (
        <AskOwners workspaceId={chooser.scope} workspaceName={askedOf} ask={ask} />
      )}
    </>
  );
  const note =
    failure !== undefined ? (
      <ErrorState onRetry={read}>
        {listed === undefined ? repositoryFailureNote(failure) : REFRESH_FAILED_WORDS}
      </ErrorState>
    ) : listed !== undefined && !listed.installed && listed.repositories.length === 0 ? (
      // Only an owner or an admin can connect the workspace's GitHub, so a member is shown whom to ask.
      deadEnd(
        unconnectedLines(chooser),
        chooser.connected === true ? OWNER_ASK.RECONNECT : OWNER_ASK.CONNECT,
        chooser.connected === true ? undefined : chooser.workspaceName,
      )
    ) : list === undefined ? (
      <Spinner delay label="Loading repositories" />
    ) : rows.length === 0 && listed?.installed ? (
      // Installed but giving Luke nothing: the repositories are chosen on GitHub, through the workspace's row.
      deadEnd([MENU_NOTE.NONE_REACHED], OWNER_ASK.ADD_REPOSITORY, undefined)
    ) : undefined;

  return (
    <div className="repository-chip" data-place={props.place} ref={chip}>
      {triggerDrawn ? (
        <Tooltip
          label={open ? undefined : (props.value ?? undefined)}
          card={
            props.value === null || open ? undefined : (
              <RepositoryCard repository={props.value} pictures={chooser.pictures} />
            )
          }
        >
          <Chip
            ref={trigger}
            look={PLACE_LOOK[props.place]}
            width={props.width}
            chevron={props.place === CHIP_PLACE.FIELD}
            aria-describedby={props.describedBy}
            aria-invalid={props.invalid}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={press}
          >
            {props.value === null ? (
              <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
            ) : (
              <RepositoryPicture
                repository={props.value}
                pictures={chooser.pictures}
                fallback={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
                size={AVATAR_SIZE.GLYPH}
              />
            )}
            <ChipName>{label}</ChipName>
          </Chip>
        </Tooltip>
      ) : null}
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label="Repository"
          placeholder="Search repositories"
          rows={rows}
          value={props.value ?? undefined}
          note={note}
          noMatch={MENU_NOTE.NO_MATCH}
          align={props.align ?? POPOVER_ALIGN.END}
          onPick={(repository) => choose(() => props.onChoose(repository))}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && chip.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
