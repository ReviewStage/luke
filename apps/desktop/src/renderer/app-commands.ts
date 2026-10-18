/**
 * app-commands.ts -- the window's one keymap: which control can run each shortcut's command right now, and the one listener that runs it.
 *
 * A command is offered by the control it belongs to, for as long as that
 * control is on screen and able: the sidebar toggle offers the sidebar's
 * chord, the open task's toolbar its Copy and Delete. So whether a chord
 * answers is whether its control is there to answer it, and a chord nothing
 * offers is left to whatever else wants it. A menu-bar item reaches the same
 * offer, which is why the menu needs no state of its own.
 *
 * An overlay that holds the keyboard, a dialog's card or the command palette,
 * holds off the menu bar's Back and Forward while it stands, as it holds off
 * their chords, so a click on the menu or a mouse's back button (which a
 * swipe hands the window the same way) leaves the page behind it alone.
 */

import { appPlatform } from "@luke/panel/app-platform";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  type AppCommand,
  commandForKey,
  KEYED_COMMANDS,
  type KeyedCommand,
  shortcutEditsText,
  shortcutLayered,
} from "@luke/settings/shortcuts";
import { useEffect, useLayoutEffect, useRef } from "react";

type CommandRun = { current: () => void };

/** The offers standing for each command, the latest last: a remount's offer replaces the one it follows. */
const offers = new Map<AppCommand, CommandRun[]>();

/** The menu bar's commands an overlay standing holds off: the ones that would move the page behind it. */
const HELD_UNDER_OVERLAY: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.BACK,
  APP_COMMAND.FORWARD,
]);

/** How many overlays holding the keyboard stand now that are no dialog: the command palette, while open. */
let overlaysStanding = 0;

/** Whether an overlay holds the keyboard now: a dialog's card, which every dialog marks modal, or an overlay held by {@link useOverlayHold}. */
function overlayStands(): boolean {
  return overlaysStanding > 0 || document.querySelector('[aria-modal="true"]') !== null;
}

/** The commands the keymap answers: every one but those whose key is the window's layered Escape. */
const KEYED: readonly KeyedCommand[] = KEYED_COMMANDS.filter(
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

/** Whether a command's offer stands now, so running it would do something: what the command palette lists. */
export function appCommandOffered(command: AppCommand): boolean {
  return (offers.get(command)?.length ?? 0) > 0;
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

/** Holds off the menu bar's Back and Forward while `standing`: an overlay's that is no dialog, for as long as it holds the keyboard. */
export function useOverlayHold(standing: boolean): void {
  useEffect(() => {
    if (!standing) return;
    overlaysStanding += 1;
    return () => {
      overlaysStanding -= 1;
    };
  }, [standing]);
}

/**
 * The keymap, answering only while `enabled`: the window's content has the
 * keyboard, not a sheet over it. A chord is claimed only when an offer
 * stands, and a held chord runs once rather than once per repeat, its
 * repeats claimed whether or not an offer still stands.
 */
export function useAppKeymap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      const command = commandForKey(KEYED, event);
      if (command === undefined) return;
      if (shortcutEditsText(APP_SHORTCUTS[command].chord) && typingInto(event.target)) return;
      // Note that a held chord's repeats stay the window's even once its
      // offer is gone, because a repeat falling through to the menu bar runs
      // what the press never asked for: a held ⌘W closing the tab, and then
      // the window behind it.
      if (!event.repeat && !offers.get(command)?.length) return;
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
    return appPlatform().onMenuCommand((command) => {
      if (HELD_UNDER_OVERLAY.has(command) && overlayStands()) return;
      runAppCommand(command);
    });
  }, [enabled]);
}
