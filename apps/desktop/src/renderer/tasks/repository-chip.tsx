import type { GitHubRepository } from "@luke/features";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { TASK_CALL_FAILURE, type TasksRepositoriesAnswer } from "@luke/features/tasks-view";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { CHIP_LOOK, Chip, type ChipLook, ChipName, GearIcon, ProviderMark } from "@luke/ui";
import { repositoryFailureNote } from "@luke/ui/tasks-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { OPEN_SETTINGS_LABEL, useOpenSettings } from "../open-settings";
import { RepositoryPicture } from "../repository-picture";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { PICKER_ALIGN, type PickerAlign, usePickerPlacement } from "../settings/picker-row";
import { Spinner } from "../spinner";

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
 * GitHub last saw them change, each under its owner's picture. Nothing the
 * workspace's GitHub does not reach is offered, so a task never starts on
 * a repository its workspace cannot work in; a pick the read finds out of
 * reach is handed back, and with nothing to offer the chip reads No
 * repository, which a task can start with. With no
 * GitHub connected to the workspace, or one GitHub removed or suspended,
 * the menu says which in the list's place: an owner or an admin is offered
 * Open Settings at the workspace's GitHub repositories, the one place they
 * are set, and a member is told to ask one. The list is read from the service when the chip mounts and again
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
  ASK_TO_CONNECT: "Ask an owner or admin to connect GitHub.",
  ASK_TO_CONNECT_IN: (workspace: string) =>
    `Ask an owner or admin of ${workspace} to connect GitHub.`,
  LAPSED: "This workspace's GitHub connection was removed or suspended on GitHub.",
  LAPSED_IN: (workspace: string) =>
    `${workspace}'s GitHub connection was removed or suspended on GitHub.`,
  ASK_TO_RECONNECT: "Ask an owner or admin to reconnect GitHub.",
  NO_MATCH: "No repositories match",
} as const;

/**
 * What an empty list says where the workspace's GitHub reaches nothing: that
 * it was removed or suspended on GitHub, or that none is connected, and for
 * a member, whom to ask. A member of a lapsed workspace is told both.
 */
function unconnectedNotes(chooser: RepositoryChooser): readonly string[] {
  const name = chooser.workspaceName;
  if (chooser.connected === true) {
    const lapsed = name === undefined ? MENU_NOTE.LAPSED : MENU_NOTE.LAPSED_IN(name);
    return chooser.manages ? [lapsed] : [lapsed, MENU_NOTE.ASK_TO_RECONNECT];
  }
  if (chooser.manages) {
    return [name === undefined ? MENU_NOTE.NOT_CONNECTED : MENU_NOTE.NOT_CONNECTED_IN(name)];
  }
  return [name === undefined ? MENU_NOTE.ASK_TO_CONNECT : MENU_NOTE.ASK_TO_CONNECT_IN(name)];
}

/** A repository's row words: its name, and its owner as the muted detail; a name with no owner is its label alone. */
function ownerApart(fullName: string): Pick<MenuRow, "label" | "detail"> {
  const slash = fullName.indexOf("/");
  if (slash <= 0) return { label: fullName };
  return { label: fullName.slice(slash + 1), detail: fullName.slice(0, slash) };
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
  return names.map((fullName) => ({
    id: fullName,
    ...ownerApart(fullName),
    terms: [fullName],
    icon: (
      <RepositoryPicture
        repository={fullName}
        pictures={pictures}
        fallback={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
      />
    ),
  }));
}

export function RepositoryChip(props: {
  /** The repository named now, `owner/name`, or null while none is. */
  value: string | null;
  chooser: RepositoryChooser;
  onChoose: (repository: string) => void;
  /** Lets go of a pick the read finds the workspace's GitHub does not reach, where the pick is the chip's own to drop. */
  onUnreached?: (() => void) | undefined;
  /** Counts the asks from elsewhere to open the menu, each opening it. */
  openRequest?: number | undefined;
  place: ChipPlace;
  /** A form row's chip: the edge its menu hangs from, the trailing one where none is named, as a Settings picker's does. */
  align?: PickerAlign | undefined;
  /** A form row's chip: the ids of the row's words that describe it, its error among them while it has one. */
  describedBy?: string | undefined;
  /** A form row's chip: whether the row says its value is refused. */
  invalid?: true | undefined;
}): React.JSX.Element {
  const { chooser, openRequest, onUnreached, value } = props;
  const openSettings = useOpenSettings();
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [list, setList] = useState<TasksRepositoriesAnswer | undefined>(undefined);
  const menuId = useId();
  const chip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const placement = usePickerPlacement(open, trigger, props.align ?? PICKER_ALIGN.END);
  /** What held focus as the menu opened, which closing hands it back to. */
  const opener = useRef<HTMLElement | null>(null);
  // Note that the chooser is read through a ref, because the tab hands a
  // new one on every render and a read is owed to the window's focus, not
  // to a render.
  const latest = useRef(chooser);
  latest.current = chooser;

  const read = useCallback(() => {
    latest.current.read().then(setList, () => {
      setList({ failure: TASK_CALL_FAILURE.UNANSWERED });
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

  const listed = list !== undefined && "repositories" in list ? list.repositories : undefined;
  const failure = list !== undefined && "failure" in list ? list.failure : undefined;
  // A pick the read does not list is handed back, so nothing out of reach stands chosen.
  const unreached = value !== null && listed !== undefined && !listedIn(listed.repositories, value);
  useEffect(() => {
    if (unreached) onUnreached?.();
  }, [unreached, onUnreached]);
  // No GitHub connected is mended at the workspace's Integrations.
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
  const note =
    failure !== undefined ? (
      <>
        <p className="task-compose-menu-note" role="alert">
          {repositoryFailureNote(failure)}
        </p>
        <button type="button" className="menu-item" onClick={read}>
          <RotateCwIcon aria-hidden="true" />
          <span className="task-compose-menu-name">Retry</span>
        </button>
      </>
    ) : listed !== undefined && !listed.installed ? (
      // Only an owner or an admin can connect the workspace's GitHub, so a member is told to ask.
      <>
        {unconnectedNotes(chooser).map((words) => (
          <p key={words} className="task-compose-menu-note">
            {words}
          </p>
        ))}
        {chooser.manages ? (
          <button
            type="button"
            className="menu-item"
            onClick={() => choose(() => openSettings(workspaceGitHub))}
          >
            <GearIcon />
            <span className="task-compose-menu-name">{OPEN_SETTINGS_LABEL}</span>
          </button>
        ) : null}
      </>
    ) : list === undefined ? (
      <div className="task-compose-menu-note">
        <Spinner label="Loading repositories" />
      </div>
    ) : rows.length === 0 && listed?.installed ? (
      <p className="task-compose-menu-note">{MENU_NOTE.NONE_REACHED}</p>
    ) : undefined;

  return (
    <div
      className="repository-chip"
      data-place={props.place}
      data-align={props.align ?? PICKER_ALIGN.END}
      {...placement}
      ref={chip}
    >
      {triggerDrawn ? (
        <Chip
          ref={trigger}
          look={PLACE_LOOK[props.place]}
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
            />
          )}
          <ChipName>{label}</ChipName>
        </Chip>
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
