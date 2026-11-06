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

type CommandRun = {
  current: () => void;
  over: { current: (() => boolean) | undefined };
};

const offers = new Map<AppCommand, CommandRun[]>();

const HELD_UNDER_OVERLAY: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.BACK,
  APP_COMMAND.FORWARD,
  APP_COMMAND.NEXT_RECENT_TAB,
  APP_COMMAND.PREVIOUS_RECENT_TAB,
]);

const offersHeard = new Set<(commands: readonly AppCommand[]) => void>();

let offersTellingDue = false;

function offersChanged(): void {
  if (offersTellingDue || offersHeard.size === 0) return;
  offersTellingDue = true;
  queueMicrotask(() => {
    offersTellingDue = false;
    const commands = offeredCommands();
    for (const hear of offersHeard) hear(commands);
  });
}

function offeredCommands(): readonly AppCommand[] {
  return [...offers.keys()].filter((command) => (offers.get(command)?.length ?? 0) > 0).toSorted();
}

let overlaysStanding = 0;

export function overlayHoldsKeyboard(): boolean {
  return overlaysStanding > 0 || document.querySelector('[aria-modal="true"]') !== null;
}

const KEYED: readonly KeyedCommand[] = KEYED_COMMANDS.filter((command) => {
  const { chord } = APP_SHORTCUTS[command];
  return !shortcutLayered(chord) && !shortcutSwitching(chord);
});

function platformCarries(command: KeyedCommand): boolean {
  const { capability } = APP_SHORTCUTS[command] as { capability?: HostCapability };
  return capability === undefined || capabilityNow(capability);
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

function answeringOffer(command: AppCommand): CommandRun | undefined {
  const held = offers.get(command) ?? [];
  return (
    held.findLast((offer) => offer.over.current?.() === true) ??
    held.findLast((offer) => offer.over.current === undefined) ??
    held.at(-1)
  );
}

export function runAppCommand(command: AppCommand): boolean {
  const offer = answeringOffer(command);
  if (offer === undefined) return false;
  offer.current();
  return true;
}

export function appCommandOffered(command: AppCommand): boolean {
  return (offers.get(command)?.length ?? 0) > 0;
}

export const FOCUSED_OFFER = (): boolean => true;

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

export function useOverlayHold(standing: boolean): void {
  useEffect(() => {
    if (!standing) return;
    overlaysStanding += 1;
    return () => {
      overlaysStanding -= 1;
    };
  }, [standing]);
}

export function useAppKeymap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      const command =
        commandForKey(
          KEYED.filter((each) => (offers.get(each)?.length ?? 0) > 0),
          event,
        ) ?? commandForKey(KEYED, event);
      if (command === undefined) return;
      if (shortcutEditsText(APP_SHORTCUTS[command].chord) && typingInto(event.target)) return;
      if (!event.repeat && !offers.get(command)?.length) return;
      if (event.repeat && !offers.get(command)?.length && !platformCarries(command)) return;
      event.preventDefault();
      if (!event.repeat) runAppCommand(command);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled]);
}

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
    offersChanged();
    return () => {
      offersHeard.delete(hear);
    };
  }, []);
}

export function useMenuCommands(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    return appPlatform().onMenuCommand((command) => {
      if (HELD_UNDER_OVERLAY.has(command) && overlayHoldsKeyboard()) return;
      runAppCommand(command);
    });
  }, [enabled]);
}
