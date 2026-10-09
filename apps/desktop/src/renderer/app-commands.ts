/**
 * app-commands.ts -- the window's one keymap: which control can run each shortcut's command right now, and the one listener that runs it.
 *
 * A command is offered by the control it belongs to, for as long as that
 * control is on screen and able: the sidebar toggle offers the sidebar's
 * chord, the open plan's toolbar its Copy and Delete. So whether a chord
 * answers is whether its control is there to answer it, and a chord nothing
 * offers is left to whatever else wants it. A menu-bar item reaches the same
 * offer, which is why the menu needs no state of its own.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  APP_COMMANDS,
  APP_SHORTCUTS,
  type AppCommand,
  commandForKey,
  shortcutEditsText,
  shortcutLayered,
} from "#shared/shortcuts";

type CommandRun = { current: () => void };

/** The offers standing for each command, the latest last: a remount's offer replaces the one it follows. */
const offers = new Map<AppCommand, CommandRun[]>();

/** The commands the keymap answers: every one but those whose key is the window's layered Escape. */
const KEYED: readonly AppCommand[] = APP_COMMANDS.filter(
  (command) => !shortcutLayered(APP_SHORTCUTS[command].chord),
);

/** Whether the press landed in something taking typing, which keeps the keys it edits with. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * Runs a command's standing offer, answering whether there was one: how the
 * keymap and the menu bar run a command, and how the window's layered Escape
 * runs one of the commands it leaves the keymap.
 */
export function runAppCommand(command: AppCommand): boolean {
  const offer = offers.get(command)?.at(-1);
  if (offer === undefined) return false;
  offer.current();
  return true;
}

/**
 * Offers a command while `run` is given. The latest `run` is the one a press
 * calls, so a caller hands a fresh closure each render without re-offering.
 */
export function useAppCommand(command: AppCommand, run: (() => void) | undefined): void {
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  const offered = run !== undefined;
  useEffect(() => {
    if (!offered) return;
    const offer: CommandRun = { current: () => latest.current?.() };
    offers.set(command, [...(offers.get(command) ?? []), offer]);
    return () => {
      offers.set(
        command,
        (offers.get(command) ?? []).filter((held) => held !== offer),
      );
    };
  }, [command, offered]);
}

/**
 * The keymap, answering only while `enabled`: the window's content has the
 * keyboard, not a sheet over it. A chord is claimed only when an offer
 * stands, and a held chord runs once rather than once per repeat.
 */
export function useAppKeymap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      const command = commandForKey(KEYED, event);
      if (command === undefined || !offers.get(command)?.length) return;
      if (shortcutEditsText(APP_SHORTCUTS[command].chord) && typingInto(event.target)) return;
      event.preventDefault();
      if (!event.repeat) runAppCommand(command);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled]);
}

/** The menu bar's commands, run on the same offers and the same terms as the keys. */
export function useMenuCommands(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    return window.sidecar.onMenuCommand((command) => {
      runAppCommand(command);
    });
  }, [enabled]);
}
