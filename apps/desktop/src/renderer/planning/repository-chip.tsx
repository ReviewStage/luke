import type { GitHubRepository } from "@sidecar/hosted";
import { PLAN_CALL_FAILURE, type PlanningRepositoriesAnswer } from "@sidecar/hosted/planning-view";
import { ExternalIcon, LockIcon } from "@sidecar/panel";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GitHubMark } from "../account-marks";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { repositoryFailureNote } from "./planning-model";

/**
 * repository-chip.tsx -- the chip that names a plan's GitHub repository, and the menu that picks one.
 *
 * Drawn along the composer card's foot for a plan about to start, the way a
 * branch or model chip is: the GitHub mark and `owner/name`, or the pick it
 * is waiting on. In the open plan's toolbar it stands in the actions row,
 * reading `Choose repository` while the plan has none; once the plan names
 * one, the sidebar's row says which and the toolbar draws no chip, and the
 * menu alone is left, opened by the plan menu's Change repository… and
 * hung from the toolbar. Its menu is the shared searchable one: a search over every
 * repository the Luke GitHub App reaches, the repositories the account's
 * plans were about lately first and the rest as GitHub last saw them
 * change, each under the GitHub mark or a lock where it is private, and
 * pinned under the list the page on GitHub where the developer chooses
 * which repositories the App reaches, which with the App installed nowhere
 * is the page that installs it. With the App installed nowhere and no
 * repository named, the chip offers installing it instead of a menu. The
 * list is read from the service when the chip mounts and again whenever
 * the window takes focus, so a developer back from installing the App in
 * the browser sees the change on the next opening; nothing polls. The menu
 * closes on a choice, on Escape, and on focus leaving it; Escape stops
 * there, so it closes the menu and not the panel behind it.
 */

/** What the chip's menu offers, read from the account's plans and the service. */
export interface RepositoryChooser {
  /** The repositories the account's plans were about lately, the newest first, each once. */
  recent: readonly string[];
  /** Reads the repositories the account reaches now, as the service answers them. */
  read: () => Promise<PlanningRepositoriesAnswer>;
  /** Opens a page of GitHub's in the browser. */
  openGitHub: (url: string) => void;
}

/** Where the chip stands, which is how it is sized. */
export const CHIP_PLACE = {
  COMPOSER: "composer",
  TOOLBAR: "toolbar",
} as const;

export type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

/** The chip's words while it waits on a pick, and while the App is installed nowhere. */
const CHIP_LABEL = {
  CHOOSE: "Choose repository",
  INSTALL: "Install Luke on GitHub",
} as const;

/** What the menu says in the list's place. */
const MENU_NOTE = {
  READING: "Reading your repositories…",
  NONE_REACHED: "Luke can't see any repository yet.",
  NO_MATCH: "No repositories match",
} as const;

/**
 * The menu's rows: the recent repositories first, then every other the App
 * reaches as the service ordered them, most recently updated first, each
 * once. A recent repository the App no longer reaches is still offered,
 * under the GitHub mark, since the plan it came from still names it.
 */
function repositoryRows(
  recent: readonly string[],
  reached: readonly GitHubRepository[] | undefined,
): MenuRow[] {
  const privacy = new Map((reached ?? []).map((each) => [each.fullName, each.private]));
  const names = [...recent];
  for (const each of reached ?? []) {
    if (!names.includes(each.fullName)) names.push(each.fullName);
  }
  return names.map((fullName) => ({
    id: fullName,
    label: fullName,
    icon: privacy.get(fullName) === true ? <LockIcon /> : <GitHubMark />,
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
  const [open, setOpen] = useState(false);
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

  // Each ask from elsewhere, such as the plan menu's Change repository…, opens the menu.
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
  const installing = listed !== undefined && !listed.installed;
  // With the App installed nowhere and no repository named, the chip's one press is installing it.
  const offersInstall = installing && props.value === null;
  const label = props.value ?? (offersInstall ? CHIP_LABEL.INSTALL : CHIP_LABEL.CHOOSE);
  const installationUrl = listed?.installationUrl;
  const press = () => {
    if (offersInstall && installationUrl !== undefined) {
      chooser.openGitHub(installationUrl);
      return;
    }
    opener.current = trigger.current;
    setOpen(!open);
  };
  // The toolbar's chip is drawn only while the plan has no repository; the sidebar names one it has.
  const triggerDrawn = props.place !== CHIP_PLACE.TOOLBAR || props.value === null;

  const rows = repositoryRows(chooser.recent, listed?.repositories);
  const note =
    failure !== undefined ? (
      <>
        <p className="plan-compose-menu-note" role="alert">
          {repositoryFailureNote(failure)}
        </p>
        <button type="button" className="plan-compose-menu-row" onClick={read}>
          <span className="plan-compose-menu-name">Try again</span>
        </button>
      </>
    ) : list === undefined ? (
      <p className="plan-compose-menu-note">{MENU_NOTE.READING}</p>
    ) : rows.length === 0 && listed?.installed ? (
      <p className="plan-compose-menu-note">{MENU_NOTE.NONE_REACHED}</p>
    ) : undefined;

  return (
    <div className="repository-chip" data-place={props.place} ref={chip}>
      {triggerDrawn ? (
        <button
          ref={trigger}
          type="button"
          className="plan-compose-chip"
          aria-haspopup={offersInstall ? undefined : "listbox"}
          aria-expanded={offersInstall ? undefined : open}
          aria-controls={open ? menuId : undefined}
          onClick={press}
        >
          <GitHubMark />
          <span className="plan-compose-chip-name">{label}</span>
          {offersInstall ? <ExternalIcon /> : null}
        </button>
      ) : null}
      {open ? (
        <SearchableMenu
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
          foot={
            installationUrl !== undefined ? (
              <button
                type="button"
                className="plan-compose-menu-row"
                onClick={() => choose(() => chooser.openGitHub(installationUrl))}
              >
                <span className="plan-compose-menu-name">GitHub</span>
                <ExternalIcon />
              </button>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
}
