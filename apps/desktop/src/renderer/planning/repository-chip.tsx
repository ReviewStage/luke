import type { GitHubRepository } from "@luke/features";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { PLAN_CALL_FAILURE, type PlanningRepositoriesAnswer } from "@luke/features/planning-view";
import { GearIcon } from "@luke/ui";
import { RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CHIP_LOOK, Chip, type ChipLook } from "../chip";
import { OPEN_SETTINGS_LABEL, useOpenSettings } from "../open-settings";
import { ProviderMark } from "../provider-marks";
import { RepositoryPicture } from "../repository-picture";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "../settings-views";
import { Spinner } from "../spinner";
import { useDisclosure } from "../use-disclosure";
import { repositoryFailureNote } from "./planning-model";

/**
 * repository-chip.tsx -- the chip that names a plan's GitHub repository, and the menu that picks one.
 *
 * Drawn along the composer card's foot for a plan about to start, the way a
 * branch or model chip is: the owner's picture and `owner/name`, or the
 * GitHub mark and the pick it is waiting on. In the open plan's toolbar it stands in the actions row,
 * reading `Choose repository` while the plan has none; once the plan names
 * one, the sidebar's row says which and the toolbar draws no chip, and the
 * menu alone is left, opened by the plan menu's Change repository and
 * hung from the toolbar. Its menu is the shared searchable one: a search over every
 * repository the GitHub connected to the workspace reaches, the
 * repositories the account's plans were about lately first and the rest as
 * GitHub last saw them change, each under its owner's picture. With no
 * GitHub connected to the workspace, the menu says so in the list's place:
 * an owner or an admin is offered Open Settings at the workspace's GitHub
 * repositories, the one place they are set, and a member is told to ask
 * one. The list is read from the service when the chip mounts and again
 * whenever the window takes focus, so a developer back from connecting
 * GitHub in the browser sees the change on the next opening; nothing polls. The menu
 * closes on a choice, on Escape, and on focus leaving it; Escape stops
 * there, so it closes the menu and not the panel behind it.
 */

/** What the chip's menu offers, read from the account's plans and the service. */
export interface RepositoryChooser {
  /** The repositories the account's plans were about lately, the newest first, each once. */
  recent: readonly string[];
  /** Reads the repositories the account reaches now, as the service answers them. */
  read: () => Promise<PlanningRepositoriesAnswer>;
  /** Opens a page of GitHub's in the browser, such as a repository's own. */
  openGitHub: (url: string) => void;
  /** Whether a repository is drawn with its owner's picture: not in a fixture run (`repository-picture.tsx`). */
  pictures: boolean;
  /** The workspace the list is for, where one is chosen; a chip keyed by it reads afresh when it changes. */
  scope?: string | undefined;
  /** Whether the account manages that workspace, so can connect its GitHub; a member is told to ask. */
  manages: boolean;
}

/** Where the chip stands, which is how it is sized. */
export const CHIP_PLACE = {
  COMPOSER: "composer",
  TOOLBAR: "toolbar",
} as const;

export type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

/** The chip's look in each place: the composer's pill, or the toolbar chip the toolbar's buttons beside it are drawn as. */
const PLACE_LOOK = {
  [CHIP_PLACE.COMPOSER]: CHIP_LOOK.PILL,
  [CHIP_PLACE.TOOLBAR]: CHIP_LOOK.TOOLBAR,
} as const satisfies Record<ChipPlace, ChipLook>;

/** The chip's words while it waits on a pick. */
const CHOOSE_LABEL = "Choose repository";

/** What the menu says in the list's place. */
const MENU_NOTE = {
  NONE_REACHED: "Luke can't see any repository yet.",
  NOT_CONNECTED: "No GitHub is connected to this workspace yet.",
  ASK_TO_CONNECT: "Ask an owner or admin to connect GitHub.",
  NO_MATCH: "No repositories match",
} as const;

/**
 * The menu's rows: the recent repositories first, then every other the App
 * reaches as the service ordered them, most recently updated first, each
 * once, every one under its owner's picture whether private or not. A recent
 * repository the App no longer reaches is still offered, since the plan it
 * came from still names it.
 */
function repositoryRows(
  recent: readonly string[],
  reached: readonly GitHubRepository[] | undefined,
  pictures: boolean,
): MenuRow[] {
  const names = [...recent];
  for (const each of reached ?? []) {
    if (!names.includes(each.fullName)) names.push(each.fullName);
  }
  return names.map((fullName) => ({
    id: fullName,
    label: fullName,
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
  /** Counts the asks from elsewhere to open the menu, each opening it. */
  openRequest?: number | undefined;
  place: ChipPlace;
}): React.JSX.Element {
  const { chooser, openRequest } = props;
  const openSettings = useOpenSettings();
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [list, setList] = useState<PlanningRepositoriesAnswer | undefined>(undefined);
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
    latest.current.read().then(setList, () => {
      setList({ failure: PLAN_CALL_FAILURE.UNANSWERED });
    });
  }, []);

  // The list is read on arrival and whenever the window comes back, which
  // is how a developer returns from installing the App in the browser.
  useEffect(() => {
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  // Each ask from elsewhere, such as the plan menu's Change repository, opens the menu.
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, [openRequest]);

  // Note that we hand focus back to where it came from, the chip or the plan
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
  // No GitHub connected is mended at the workspace's Integrations.
  const workspaceGitHub: SettingsLink = {
    page: SETTINGS_VIEW.WORKSPACE,
    section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
    ...(chooser.scope === undefined ? undefined : { workspaceId: chooser.scope }),
  };
  const label = props.value ?? CHOOSE_LABEL;
  const press = () => {
    opener.current = trigger.current;
    setOpen(!open);
  };
  // The toolbar's chip is drawn only while the plan has no repository; the sidebar names one it has.
  const triggerDrawn = props.place !== CHIP_PLACE.TOOLBAR || props.value === null;

  const rows = repositoryRows(chooser.recent, listed?.repositories, chooser.pictures);
  const note =
    failure !== undefined ? (
      <>
        <p className="plan-compose-menu-note" role="alert">
          {repositoryFailureNote(failure)}
        </p>
        <button type="button" className="menu-item" onClick={read}>
          <RotateCwIcon aria-hidden="true" />
          <span className="plan-compose-menu-name">Retry</span>
        </button>
      </>
    ) : listed !== undefined && !listed.installed ? (
      // Only an owner or an admin can connect the workspace's GitHub, so a member is told to ask.
      chooser.manages ? (
        <>
          <p className="plan-compose-menu-note">{MENU_NOTE.NOT_CONNECTED}</p>
          <button
            type="button"
            className="menu-item"
            onClick={() => choose(() => openSettings(workspaceGitHub))}
          >
            <GearIcon />
            <span className="plan-compose-menu-name">{OPEN_SETTINGS_LABEL}</span>
          </button>
        </>
      ) : (
        <p className="plan-compose-menu-note">{MENU_NOTE.ASK_TO_CONNECT}</p>
      )
    ) : list === undefined ? (
      <div className="plan-compose-menu-note">
        <Spinner label="Loading repositories" />
      </div>
    ) : rows.length === 0 && listed?.installed ? (
      <p className="plan-compose-menu-note">{MENU_NOTE.NONE_REACHED}</p>
    ) : undefined;

  return (
    <div className="repository-chip" data-place={props.place} ref={chip}>
      {triggerDrawn ? (
        <Chip
          ref={trigger}
          look={PLACE_LOOK[props.place]}
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
          <span className="chip-name">{label}</span>
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
