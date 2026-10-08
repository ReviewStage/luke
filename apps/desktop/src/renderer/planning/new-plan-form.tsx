import { ArrowUpIcon, CheckIcon, FolderIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { folderLine, folderName } from "./planning-model";
import type { PlansControl } from "./use-plans-tab";

/**
 * new-plan-form.tsx -- the Plans tab's home: one composer that names a plan and the folder on this Mac it plans against.
 *
 * Drawn the way a devtool's new-task page is: a heading, and under it a card
 * holding the name and, along its foot, the folder chip and the round start
 * button. Ordinary setup fields and nothing spoken: nothing typed here reaches
 * the model as conversation. The folder starts on the one the last opened plan
 * read; the chip offers the other recent ones and the system's folder picker,
 * and the planning model's commands run in that folder for the plan's whole
 * life. Enter starts the plan; a refusal keeps the page with the reason under
 * the card, and the button can be pressed again.
 */

/** Everything the page draws, handed in whole so the layout decides nothing. */
interface NewPlanFormViewProps {
  name: string;
  /** The chosen folder's absolute path; nothing until one is chosen or used before. */
  folder: string | undefined;
  /** The folders this Mac's plans read, the last one used first. */
  recentFolders: readonly string[];
  starting: boolean;
  /** Why the last start or folder press did not land, in the page's words. */
  note: string | undefined;
  /** Counts the presses of New plan, so the name field takes focus on each. */
  focusRequest: number;
  onName: (name: string) => void;
  /** Opens the system's folder picker. */
  onChooseFolder: () => void;
  /** Takes one of the recent folders. */
  onFolder: (folderPath: string) => void;
  onStart: () => void;
}

/**
 * The chip along the card's foot: the folder's name, and a press that opens
 * the system's picker. With recent folders to offer it opens a short menu of
 * them over Choose folder instead, the way a branch or model chip does. The
 * menu closes on a choice, on Escape, and on focus leaving it; Escape stops
 * here, so it closes the menu and not the panel behind it.
 */
function FolderChip(props: {
  folder: string | undefined;
  recentFolders: readonly string[];
  onChooseFolder: () => void;
  onFolder: (folderPath: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const chip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Note that we hand focus back to the chip, as a native menu returns it to
  // its trigger, because closing takes the focused row away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const hasMenu = props.recentFolders.length > 0;
  const choose = (pick: () => void) => {
    close();
    pick();
  };

  // The menu opens with its first row focused, as a native menu does.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  // Arrows walk the menu's rows, wrapping at either end.
  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.findIndex((row) => row === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  };

  return (
    <div className="plan-compose-folder" ref={chip}>
      <button
        ref={trigger}
        type="button"
        className="plan-compose-chip"
        aria-haspopup={hasMenu ? "menu" : undefined}
        aria-expanded={hasMenu ? open : undefined}
        aria-controls={open ? menuId : undefined}
        title={props.folder === undefined ? undefined : folderLine(props.folder)}
        onClick={() => (hasMenu ? setOpen(!open) : props.onChooseFolder())}
      >
        <FolderIcon />
        <span className="plan-compose-chip-name">
          {props.folder === undefined ? "Choose folder" : folderName(props.folder)}
        </span>
      </button>
      {open ? (
        <div
          ref={menu}
          className="plan-compose-menu"
          id={menuId}
          role="menu"
          aria-label="Folder"
          onKeyDown={onMenuKey}
          onBlur={(event) => {
            if (!chip.current?.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <p className="plan-compose-menu-heading">Recent</p>
          {props.recentFolders.map((folderPath) => (
            <button
              key={folderPath}
              type="button"
              role="menuitem"
              className="plan-compose-menu-row"
              onClick={() => choose(() => props.onFolder(folderPath))}
            >
              <FolderIcon />
              <span className="plan-compose-menu-name">{folderName(folderPath)}</span>
              <span className="plan-compose-menu-path">{folderLine(folderPath)}</span>
              {folderPath === props.folder ? <CheckIcon /> : null}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            className="plan-compose-menu-row"
            onClick={() => choose(props.onChooseFolder)}
          >
            Choose another folder…
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewPlanFormView(props: NewPlanFormViewProps): React.JSX.Element {
  const titleId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const canStart = props.name.trim().length > 0 && props.folder !== undefined && !props.starting;
  const { focusRequest } = props;

  // Note that we focus on arrival as well as on each press of New plan,
  // because the page is the window's home and typing the name is its one job.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new request is what asks for focus.
  useEffect(() => {
    nameField.current?.focus();
  }, [focusRequest]);

  return (
    <section className="plan-compose" aria-labelledby={titleId}>
      <h1 id={titleId} className="plan-compose-title">
        What are we planning?
      </h1>
      <form
        className="plan-compose-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) props.onStart();
        }}
      >
        <input
          ref={nameField}
          type="text"
          className="plan-compose-name"
          aria-label="Plan name"
          value={props.name}
          placeholder="Name the feature, e.g. Dark mode toggle"
          maxLength={200}
          onChange={(event) => props.onName(event.currentTarget.value)}
        />
        <div className="plan-compose-foot">
          <FolderChip
            folder={props.folder}
            recentFolders={props.recentFolders}
            onChooseFolder={props.onChooseFolder}
            onFolder={props.onFolder}
          />
          <button
            type="submit"
            className="plan-compose-start"
            aria-label="Start plan"
            title={props.starting ? "Starting…" : "Start plan"}
            aria-busy={props.starting}
            disabled={!canStart}
          >
            <ArrowUpIcon />
          </button>
        </div>
      </form>
      {props.note !== undefined ? (
        <p className="plan-compose-note" role="alert">
          {props.note}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The page with its own state: the name, the folder chosen over the last
 * one used, and the start under way. A started plan becomes the host's open
 * one, which is what turns the tab to its document.
 */
export function NewPlanForm({ newPlan }: { newPlan: PlansControl["newPlan"] }): React.JSX.Element {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const folder = chosen ?? newPlan.recentFolders[0];

  // A cancelled picker keeps whichever folder was already chosen.
  const chooseFolder = () => {
    setNote(undefined);
    newPlan.pickFolder().then(
      (picked) => {
        if (picked !== null) setChosen(picked);
      },
      (refused: Error) => setNote(refused.message),
    );
  };

  const start = () => {
    if (folder === undefined) return;
    setStarting(true);
    setNote(undefined);
    newPlan
      .start(name.trim(), folder)
      .then(setNote)
      .finally(() => setStarting(false));
  };

  return (
    <NewPlanFormView
      name={name}
      folder={folder}
      recentFolders={newPlan.recentFolders}
      starting={starting}
      note={note}
      focusRequest={newPlan.presses}
      onName={setName}
      onChooseFolder={chooseFolder}
      onFolder={setChosen}
      onStart={start}
    />
  );
}
