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
 * Where two things offer one command, the open task's Permanently delete
 * and the agent's in its column, the latest offer answers unless another
 * says it answers over the rest at the press (`over`): the focused sidebar
 * row's U and P over the open thing's, or the focused column's agent over
 * the plan (`FOCUSED_OFFER`). So which thing a chord acts
 * on is read where the keyboard stands as it is pressed, never as offers
 * happened to mount.
 *
 * An overlay that holds the keyboard, a dialog's card or the command palette,
 * holds off the menu bar's Back and Forward while it stands, as it holds off
 * their chords, so a click on the menu or a mouse's back button (which a
 * swipe hands the window the same way) leaves the page behind it alone.
 */

import type { HostCapability } from "@repo/settings";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  type AppCommand,
  commandForKey,
  KEYED_COMMANDS,
  type KeyedCommand,
  shortcutEditsText,
  shortcutLayered,
  shortcutSwitching,
} from "@repo/settings/shortcuts";
import { useEffect, useLayoutEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { capabilityNow } from "./use-app-state.js";

/** One offer: the latest `run` a press calls, and the latest `over`, which says at the press whether it answers over the offers that say nothing. */
type CommandRun = {
  current: () => void;
  over: { current: (() => boolean) | undefined };
};

/** The offers standing for each command, the latest last: a remount's offer replaces the one it follows. */
const offers = new Map<AppCommand, CommandRun[]>();

/** The menu bar's commands an overlay standing holds off: the ones that would move the page behind it. */
const HELD_UNDER_OVERLAY: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.BACK,
  APP_COMMAND.FORWARD,
  APP_COMMAND.NEXT_RECENT_TAB,
  APP_COMMAND.PREVIOUS_RECENT_TAB,
]);

/** Who hears the commands offered each time the set changes: the shell's menu bar, through `useMenuOffers`. */
const offersHeard = new Set<(commands: readonly AppCommand[]) => void>();

/** Whether a telling of the offers waits on the current commit's offers and withdrawals to settle. */
let offersTellingDue = false;

/**
 * Tells who hears the offers the commands offered now, once the offers made
 * and withdrawn in this commit have settled, so a page's many controls
 * mounting at once are told as one set.
 */
function offersChanged(): void {
  if (offersTellingDue || offersHeard.size === 0) return;
  offersTellingDue = true;
  queueMicrotask(() => {
    offersTellingDue = false;
    const commands = offeredCommands();
    for (const hear of offersHeard) hear(commands);
  });
}

/** The commands an offer stands for now, in one order, so an unchanged set reads the same. */
function offeredCommands(): readonly AppCommand[] {
  return [...offers.keys()].filter((command) => (offers.get(command)?.length ?? 0) > 0).toSorted();
}

/** How many overlays holding the keyboard stand now that are no dialog: the command palette, while open. */
let overlaysStanding = 0;

/** Whether an overlay holds the keyboard now: a dialog's card, which every dialog marks modal, or an overlay held by {@link useOverlayHold}. */
export function overlayHoldsKeyboard(): boolean {
  return overlaysStanding > 0 || document.querySelector('[aria-modal="true"]') !== null;
}

/** The commands the keymap answers: every one but those whose key is the window's layered Escape, and the tab switcher's ⌃Tab, which it holds itself. */
const KEYED: readonly KeyedCommand[] = KEYED_COMMANDS.filter((command) => {
  const { chord } = APP_SHORTCUTS[command];
  return !shortcutLayered(chord) && !shortcutSwitching(chord);
});

/** Whether the platform offers what the command's feature stands on: a chord of one it lacks is the browser's or the system's, never the window's. */
function platformCarries(command: KeyedCommand): boolean {
  const { capability } = APP_SHORTCUTS[command] as { capability?: HostCapability };
  return capability === undefined || capabilityNow(capability);
}

/** Whether the press landed in something taking typing, which keeps the keys it edits with. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * The offer a press of `command` runs now: the latest that answers over the
 * rest at this moment, else the latest that claims nothing, else the latest.
 */
function answeringOffer(command: AppCommand): CommandRun | undefined {
  const held = offers.get(command) ?? [];
  return (
    held.findLast((offer) => offer.over.current?.() === true) ??
    held.findLast((offer) => offer.over.current === undefined) ??
    held.at(-1)
  );
}

/**
 * Runs a command's standing offer, answering whether there was one: how the
 * keymap and the menu bar run a command, and how the window's layered Escape
 * runs one of the commands it leaves the keymap.
 */
export function runAppCommand(command: AppCommand): boolean {
  const offer = answeringOffer(command);
  if (offer === undefined) return false;
  offer.current();
  return true;
}

/** Whether a command's offer stands now, so running it would do something: what the command palette lists. */
export function appCommandOffered(command: AppCommand): boolean {
  return (offers.get(command)?.length ?? 0) > 0;
}

/** The `over` of an offer made only while its thing is focused, which answers over the open thing's for as long as it stands. */
export const FOCUSED_OFFER = (): boolean => true;

/**
 * Offers a command while `run` is given. The latest `run` is the one a press
 * calls, so a caller hands a fresh closure each render without re-offering.
 * `over`, read at the press, says whether this offer answers over those that
 * say nothing, as the focused thing's does over the open thing's; one whose
 * `over` says no gives way to them.
 */
export function useAppCommand(
  command: AppCommand,
  run: (() => void) | undefined,
  over?: () => boolean,
): void {
  const latest = useRef(run);
  const latestOver = useRef(over);
  useLayoutEffect(() => {
    latest.current = run;
    latestOver.current = over;
  });
  const offered = run !== undefined;
  useEffect(() => {
    if (!offered) return;
    const offer: CommandRun = { current: () => latest.current?.(), over: latestOver };
    offers.set(command, [...(offers.get(command) ?? []), offer]);
    offersChanged();
    return () => {
      offers.set(
        command,
        (offers.get(command) ?? []).filter((held) => held !== offer),
      );
      offersChanged();
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
      // Note that the command offered is read first, because commands share a key, as Escape, and only the one offered answers it.
      const command =
        commandForKey(
          KEYED.filter((each) => (offers.get(each)?.length ?? 0) > 0),
          event,
        ) ?? commandForKey(KEYED, event);
      if (command === undefined) return;
      if (shortcutEditsText(APP_SHORTCUTS[command].chord) && typingInto(event.target)) return;
      // Note that a held chord's repeats stay the window's even once its
      // offer is gone, because a repeat falling through to the menu bar runs
      // what the press never asked for: a held ⌘W closing the tab, and then
      // the window behind it.
      // Note that a command the platform lacks has its repeats left alone, because the browser's own zoom keeps stepping while ⌘+ is held.
      if (!event.repeat && !offers.get(command)?.length) return;
      if (event.repeat && !offers.get(command)?.length && !platformCarries(command)) return;
      event.preventDefault();
      if (!event.repeat) runAppCommand(command);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled]);
}

/**
 * Tells the shell the commands offered now, each time the set changes, so
 * its menu bar dims an item whose command nothing would run; a shell with no
 * menu bar is told nothing.
 */
export function useMenuOffers(): void {
  useEffect(() => {
    const tell = appPlatform().menuOffers;
    if (tell === undefined) return;
    let told: string | undefined;
    const hear = (commands: readonly AppCommand[]) => {
      const joined = commands.join();
      if (joined === told) return;
      told = joined;
      tell(commands);
    };
    offersHeard.add(hear);
    // Note that the first telling waits on the commit as every later one does, since the controls beside this one offer theirs in the same commit.
    offersChanged();
    return () => {
      offersHeard.delete(hear);
    };
  }, []);
}

/** The menu bar's commands, run on the same offers and the same terms as the keys. */
export function useMenuCommands(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    return appPlatform().onMenuCommand((command) => {
      if (HELD_UNDER_OVERLAY.has(command) && overlayHoldsKeyboard()) return;
      runAppCommand(command);
    });
  }, [enabled]);
}
