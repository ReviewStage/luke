/**
 * command-palette.tsx -- ⌘K: every command the window can run now and every plan, found by typing, in a dialog over the window.
 *
 * The palette is cmdk's own dialog, list, and scoring, drawn in the window's
 * menu rows. It decides nothing about a command: it lists the commands whose
 * control is on screen and able right now (`app-commands.ts`), so a row
 * runs exactly what its shortcut would, Delete plan's question included, and
 * it opens a plan through the same select the sidebar does, which takes its
 * ask back when the host does not open the plan. Each plan names its
 * repository beside it, so two plans of one name can be told apart.
 *
 * It is the nearest layer while it stands: no key pressed in it goes on to
 * the window, so Escape closes the palette and nothing else, a call's reply
 * included, and no chord changes what stands behind it. Closing hands focus
 * back to whatever had it, and only then runs what was chosen, so a command
 * acts from where the developer was, as its shortcut would have.
 *
 * Every row's value is an id, never words: cmdk writes it into an attribute,
 * which the session recording does not mask (`session-replay.ts`), and two
 * plans may share a name. The search reads each row's words instead.
 */

import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { SearchIcon } from "@sidecar/panel";
import { Command, defaultFilter } from "cmdk";
import { useEffect, useRef, useState } from "react";
import {
  APP_COMMAND,
  APP_SHORTCUT_GROUPS,
  type AppCommand,
  appCommandLabel,
  commandForKey,
  isKeyedCommand,
} from "#shared/shortcuts";
import { appCommandOffered, runAppCommand, useAppCommand } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import type { PlansControl } from "../planning/use-plans-tab";
import { ShortcutGlyphs } from "../tooltip";

/** The groups the palette lists commands under: the Keyboard shortcuts page's, then the menu bar's own dialogs. */
const COMMAND_GROUPS: readonly { title: string; commands: readonly AppCommand[] }[] = [
  ...APP_SHORTCUT_GROUPS,
  { title: "Help", commands: [APP_COMMAND.SEND_FEEDBACK, APP_COMMAND.SUGGEST_FEATURE] },
];

/** cmdk's own scoring over a row's words, its id left out. */
function scoreWords(_value: string, search: string, keywords?: string[]): number {
  return defaultFilter((keywords ?? []).join(" "), search);
}

/** The commands a group offers now, the palette's own left out. */
function offeredIn(commands: readonly AppCommand[]): AppCommand[] {
  return commands.filter(
    (command) => command !== APP_COMMAND.COMMAND_PALETTE && appCommandOffered(command),
  );
}

function CommandRow({
  command,
  onRun,
}: {
  command: AppCommand;
  onRun: (command: AppCommand) => void;
}): React.JSX.Element {
  const label = appCommandLabel(command);
  return (
    <Command.Item
      className="command-palette-row"
      value={command}
      keywords={[label]}
      onSelect={() => onRun(command)}
    >
      <span className="command-palette-name">{label}</span>
      {isKeyedCommand(command) ? (
        <ShortcutGlyphs command={command} className="command-palette-hint" />
      ) : null}
    </Command.Item>
  );
}

function PlanRow({
  plan,
  onOpen,
}: {
  plan: PlanSummary;
  onOpen: (planId: string) => void;
}): React.JSX.Element {
  return (
    <Command.Item
      className="command-palette-row"
      value={plan.id}
      keywords={plan.repository === null ? [plan.name] : [plan.name, plan.repository]}
      onSelect={() => onOpen(plan.id)}
    >
      <span className="command-palette-name">{plan.name}</span>
      {plan.repository !== null ? (
        <span className="command-palette-detail">{plan.repository}</span>
      ) : null}
    </Command.Item>
  );
}

/**
 * The palette, offering ⌘K while `available`: past the sign-in, where there
 * is something to run. A palette standing when that ends is taken down in
 * the render that finds it gone.
 */
export function CommandPalette({
  available,
  tab,
  onTabChange,
  plans,
}: {
  available: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  plans: PlansControl;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (open && !available) setOpen(false);
  const invoker = useRef<HTMLElement | null>(null);
  const chosen = useRef<(() => void) | undefined>(undefined);
  const shown = useRef(false);

  useAppCommand(
    APP_COMMAND.COMMAND_PALETTE,
    available
      ? () => {
          invoker.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
        }
      : undefined,
  );

  // Note that what was chosen runs once the palette is gone and focus is
  // back where it was, because a command that moves focus (Delete's
  // question, the new-plan field) would otherwise lose it to the palette's
  // own going.
  useEffect(() => {
    if (open) {
      shown.current = true;
      return;
    }
    if (!shown.current) return;
    shown.current = false;
    if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
    const run = chosen.current;
    chosen.current = undefined;
    run?.();
  }, [open]);

  const choose = (run: () => void) => {
    chosen.current = run;
    setOpen(false);
  };
  const runCommand = (command: AppCommand) => choose(() => runAppCommand(command));
  // A plan is always opened on the Plans tab, as a press in the sidebar is.
  const openPlan = (planId: string) =>
    choose(() => {
      if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
      plans.onSelect(planId);
    });

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the palette goes on to the window, because
    // the window's Escape would stop Luke mid-reply and a window chord would
    // change what stands behind the palette. Escape itself is the dialog's,
    // which closes the palette alone.
    event.stopPropagation();
    if (commandForKey([APP_COMMAND.COMMAND_PALETTE], event.nativeEvent) === undefined) return;
    event.preventDefault();
    setOpen(false);
  };

  const groups = open
    ? COMMAND_GROUPS.map((group) => ({ ...group, commands: offeredIn(group.commands) })).filter(
        (group) => group.commands.length > 0,
      )
    : [];
  const listed = open && plans.signedIn ? plans.plans : [];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      filter={scoreWords}
      loop
      overlayClassName="command-palette-backdrop"
      contentClassName="command-palette"
      onKeyDown={keyDown}
    >
      <div className="command-palette-search">
        <SearchIcon />
        <Command.Input placeholder="Search commands and plans…" />
      </div>
      <Command.List className="command-palette-list" label="Commands and plans">
        <Command.Empty className="command-palette-empty">Nothing matches.</Command.Empty>
        {groups.map((group) => (
          <Command.Group key={group.title} heading={group.title}>
            {group.commands.map((command) => (
              <CommandRow key={command} command={command} onRun={runCommand} />
            ))}
          </Command.Group>
        ))}
        {listed.length > 0 ? (
          <Command.Group heading="Go to plan">
            {listed.map((plan) => (
              <PlanRow key={plan.id} plan={plan} onOpen={openPlan} />
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}
