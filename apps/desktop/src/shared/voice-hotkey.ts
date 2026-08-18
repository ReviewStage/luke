/**
 * The key that starts, sends, and interrupts a spoken turn.
 *
 * It is registered with the system rather than with a window, so it answers
 * from whatever app is frontmost. That is also why it is chosen carefully: a
 * global shortcut takes its key away from every other app on the machine.
 */

/**
 * Tried in order when the user has not chosen one.
 *
 * Option-Space is where a macOS user reaches for a voice assistant —
 * Superwhisper, the ChatGPT desktop app and Alfred all sit there. It stands
 * alone, with no fallback chord: S is for stop, and a talk key that sometimes
 * lands on the stop key's chord would make which key does what depend on what
 * else is installed.
 */
export const DEFAULT_VOICE_HOTKEYS: readonly string[] = ["Alt+Space"];

/**
 * The key that cuts off a reply being spoken, from whatever app is frontmost.
 *
 * Option-S because S is for stop, and Option-letter is the family the other
 * Luke keys already live in. A sibling of Escape rather than of the talk key:
 * it asks for quiet and nothing in its place, where the talk key over a reply
 * interrupts by taking the turn.
 */
export const DEFAULT_STOP_HOTKEYS: readonly string[] = ["Alt+S"];

/**
 * The stop chords worth asking the system for, in order, on the ask key's
 * exact terms: a chosen chord goes first — it is what the user asked for —
 * with the default kept behind it, and any chord the other Luke keys could
 * sit on is left out, because the keys must never compete for one chord —
 * whichever registered first would silently cost the other its whole
 * feature, with nothing on screen saying why.
 */
export function stopHotkeyCandidates(
  chosen: string | undefined,
  taken: readonly (string | undefined)[],
): readonly string[] {
  const candidates = chosen
    ? [chosen, ...DEFAULT_STOP_HOTKEYS.filter((candidate) => candidate !== chosen)]
    : DEFAULT_STOP_HOTKEYS;
  return candidates.filter((candidate) => !taken.includes(candidate));
}

/**
 * The key that summons the ask field from whatever app is frontmost, tried in
 * order like the talk key's candidates.
 *
 * A sibling of the talk key on purpose: hold Option-Space to speak to Luke,
 * tap Option-L to type to him — one modifier for both halves of the same
 * conversation. It is deliberately not Command-L, which is the address bar in
 * every browser and a taken chord in most editors; a global registration
 * would swallow it machine-wide. Option-L costs the system only the ¬
 * character, and Option-letter is the family launcher apps already claim.
 */
export const DEFAULT_ASK_HOTKEYS: readonly string[] = ["Alt+L", "Alt+Shift+L"];

/**
 * The ask chords worth asking the system for, in order. A chosen chord goes
 * first — it is what the user asked for — with the defaults kept behind it,
 * exactly as the talk key's candidates work. Any chord the talk key holds is
 * left out, the chosen one included: the two Luke keys must never compete for
 * one chord — whichever registered first would silently cost the other its
 * whole feature, with nothing on screen saying why.
 */
export function askHotkeyCandidates(
  chosen: string | undefined,
  taken: readonly (string | undefined)[],
): readonly string[] {
  const candidates = chosen
    ? [chosen, ...DEFAULT_ASK_HOTKEYS.filter((candidate) => candidate !== chosen)]
    : DEFAULT_ASK_HOTKEYS;
  return candidates.filter((candidate) => !taken.includes(candidate));
}

/**
 * The modifiers a talk key may carry, written the way Electron accelerators
 * name them. Their order here is the order macOS writes a chord in — ⌃⌥⇧⌘ —
 * so every accelerator this module produces follows macOS's chord order.
 */
export const VOICE_HOTKEY_MODIFIER = {
  CONTROL: "Control",
  ALT: "Alt",
  SHIFT: "Shift",
  COMMAND: "Command",
} as const;

export type VoiceHotkeyModifier =
  (typeof VOICE_HOTKEY_MODIFIER)[keyof typeof VOICE_HOTKEY_MODIFIER];

const MODIFIER_ORDER: readonly VoiceHotkeyModifier[] = [
  VOICE_HOTKEY_MODIFIER.CONTROL,
  VOICE_HOTKEY_MODIFIER.ALT,
  VOICE_HOTKEY_MODIFIER.SHIFT,
  VOICE_HOTKEY_MODIFIER.COMMAND,
];

/** Every name the native helper's own table answers to, folded to one each. */
const MODIFIER_ALIASES: Readonly<Record<string, VoiceHotkeyModifier>> = {
  control: VOICE_HOTKEY_MODIFIER.CONTROL,
  ctrl: VOICE_HOTKEY_MODIFIER.CONTROL,
  alt: VOICE_HOTKEY_MODIFIER.ALT,
  option: VOICE_HOTKEY_MODIFIER.ALT,
  shift: VOICE_HOTKEY_MODIFIER.SHIFT,
  command: VOICE_HOTKEY_MODIFIER.COMMAND,
  cmd: VOICE_HOTKEY_MODIFIER.COMMAND,
  commandorcontrol: VOICE_HOTKEY_MODIFIER.COMMAND,
  cmdorctrl: VOICE_HOTKEY_MODIFIER.COMMAND,
};

/**
 * The keys a talk key may end in: Space or a letter, because that is the whole
 * of the native helper's table. Anything wider stored here would register
 * through the helper as nothing and silently fall back to the defaults, so the
 * limit is enforced where the chord is chosen rather than discovered where it
 * fails.
 */
function voiceHotkeyKey(name: string): string | undefined {
  if (name === "space") return "Space";
  return /^[a-z]$/.test(name) ? name.toUpperCase() : undefined;
}

function joinVoiceHotkey(held: ReadonlySet<VoiceHotkeyModifier>, key: string): string {
  return [...MODIFIER_ORDER.filter((modifier) => held.has(modifier)), key].join("+");
}

/**
 * Whether the modifiers held cannot anchor a talk key: none at all, or Shift
 * alone. Shift-and-a-letter is how every app types a capital, and
 * Shift-and-Space is typed mid-sentence, so a chord Shift carries by itself
 * takes plain typing away exactly as a bare key would. Shift may still join a
 * chord another modifier anchors.
 */
function tooLightToHold(held: ReadonlySet<VoiceHotkeyModifier>): boolean {
  return held.size === 0 || (held.size === 1 && held.has(VOICE_HOTKEY_MODIFIER.SHIFT));
}

/**
 * Reads an accelerator into the one spelling the rest of the app uses, or
 * refuses it. This is the gate a stored or submitted chord passes on its way to
 * the system: one key from the helper's table behind at least one modifier
 * heavier than Shift — a bare key, or a Shift-only chord, would take plain
 * typing away from every app on the machine.
 */
export function parseVoiceHotkey(value: string): string | undefined {
  const held = new Set<VoiceHotkeyModifier>();
  let key: string | undefined;
  for (const part of value.split("+")) {
    const name = part.trim().toLowerCase();
    const modifier = MODIFIER_ALIASES[name];
    if (modifier) {
      held.add(modifier);
      continue;
    }
    // A second key in one chord is not a chord anything here can register.
    const candidate = voiceHotkeyKey(name);
    if (!candidate || key !== undefined) return undefined;
    key = candidate;
  }
  if (!key || tooLightToHold(held)) return undefined;
  return joinVoiceHotkey(held, key);
}

/**
 * The chords to try, in order. A chosen key goes first — it is what the user
 * asked for — and the defaults stay behind it, so a chord another app claims
 * while Luke is closed costs the user a different talk key rather than none.
 * The panel shows whichever one actually registered.
 */
export function voiceHotkeyCandidates(chosen: string | undefined): readonly string[] {
  if (!chosen) return DEFAULT_VOICE_HOTKEYS;
  return [chosen, ...DEFAULT_VOICE_HOTKEYS.filter((candidate) => candidate !== chosen)];
}

/** What became of one keystroke offered to the recording control. */
export const VOICE_HOTKEY_CAPTURE = {
  /** A whole chord: modifiers held and a key from the table pressed. */
  CAPTURED: "captured",
  /** Only modifiers so far — the chord is still being formed, not refused. */
  PENDING: "pending",
  /** A key the talk key cannot be, or one held by nothing heavier than Shift. */
  REFUSED: "refused",
} as const;

export type VoiceHotkeyCaptureOutcome =
  (typeof VOICE_HOTKEY_CAPTURE)[keyof typeof VOICE_HOTKEY_CAPTURE];

export type VoiceHotkeyCaptureResult =
  | { outcome: typeof VOICE_HOTKEY_CAPTURE.CAPTURED; accelerator: string }
  | { outcome: typeof VOICE_HOTKEY_CAPTURE.PENDING }
  | { outcome: typeof VOICE_HOTKEY_CAPTURE.REFUSED };

/** The fields of a `KeyboardEvent` a chord is read from, so a test needs no DOM. */
export interface VoiceHotkeyChord {
  /** `KeyboardEvent.code`: the physical key, unmoved by the modifiers held. */
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODE_PREFIXES = ["Alt", "Control", "Meta", "Shift"] as const;

/**
 * Reads one keystroke as a talk-key chord. `code` rather than `key`, because
 * on macOS Option moves letters — Option-S arrives as `ß` — and the chord
 * being recorded is the physical one the helper will watch for.
 */
export function capturedVoiceHotkey(chord: VoiceHotkeyChord): VoiceHotkeyCaptureResult {
  // A modifier going down on its own is a chord being formed, not an answer.
  if (MODIFIER_CODE_PREFIXES.some((prefix) => chord.code.startsWith(prefix))) {
    return { outcome: VOICE_HOTKEY_CAPTURE.PENDING };
  }
  const key =
    chord.code === "Space"
      ? "Space"
      : /^Key[A-Z]$/.test(chord.code)
        ? chord.code.slice("Key".length)
        : undefined;
  const held = new Set<VoiceHotkeyModifier>();
  if (chord.ctrlKey) held.add(VOICE_HOTKEY_MODIFIER.CONTROL);
  if (chord.altKey) held.add(VOICE_HOTKEY_MODIFIER.ALT);
  if (chord.shiftKey) held.add(VOICE_HOTKEY_MODIFIER.SHIFT);
  if (chord.metaKey) held.add(VOICE_HOTKEY_MODIFIER.COMMAND);
  if (!key || tooLightToHold(held)) return { outcome: VOICE_HOTKEY_CAPTURE.REFUSED };
  return { outcome: VOICE_HOTKEY_CAPTURE.CAPTURED, accelerator: joinVoiceHotkey(held, key) };
}

/**
 * The talk key a panel should show.
 *
 * Two things can say what the key is, and neither is reliably first. The helper
 * that registers it answers over its own stdout, which happens while the
 * renderer is still loading — so that message is sent to a window with nothing
 * listening yet and is simply gone. Bootstrap is the one the renderer asks for,
 * so it always arrives; a later change is what supersedes it, and that only
 * happens if the helper stops answering and the toggle takes over.
 *
 * Reading them in this order rather than seeding state from bootstrap is what
 * makes a lost message cost nothing.
 */
export function voiceHotkeyToShow(
  bootstrap: { voiceHotkey?: string; voiceHotkeyHeld: boolean },
  changed?: { hotkey?: string; held: boolean },
): { hotkey?: string; held: boolean } {
  if (changed) return changed;
  return {
    ...(bootstrap.voiceHotkey ? { hotkey: bootstrap.voiceHotkey } : {}),
    held: bootstrap.voiceHotkeyHeld,
  };
}

/**
 * Longer than a key is down when it was pressed rather than held.
 *
 * Under this, the press and the release are one gesture and mean one thing;
 * over it, the key was being held and the release is the end of what was said.
 * Too low and a deliberate quick answer is cut off mid-word; too high and a tap
 * feels like it did nothing for a quarter of a second. This is roughly where
 * the tools that do both put it.
 */
export const TALK_KEY_TAP_MS = 250;

/**
 * What a release of the talk key does to the turn it opened.
 *
 * Holding is the plain case: the turn lasts exactly as long as the key is down,
 * which is what makes it feel like a walkie-talkie and what stops a turn
 * outliving the finger that started it. A tap is for the question too long to
 * hold through — it leaves the turn open, and the next press ends it.
 */
export const TALK_KEY_RELEASE = {
  SEND: "send",
  LATCH: "latch",
} as const;

export type TalkKeyRelease = (typeof TALK_KEY_RELEASE)[keyof typeof TALK_KEY_RELEASE];

/**
 * Reads a release. `latched` is whether this key had already been tapped once
 * and left a turn open: the release that ends a latched turn sends it however
 * briefly it was held, because the gesture that opened the turn is over and
 * this press is a second one.
 */
export function talkKeyRelease(input: { heldMs: number; latched: boolean }): TalkKeyRelease {
  if (input.latched) return TALK_KEY_RELEASE.SEND;
  return input.heldMs < TALK_KEY_TAP_MS ? TALK_KEY_RELEASE.LATCH : TALK_KEY_RELEASE.SEND;
}

const MODIFIER_SYMBOLS: Readonly<Record<string, string>> = {
  Command: "⌘",
  CommandOrControl: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};

/** Renders an accelerator the way macOS writes it, for the panel to show. */
export function voiceHotkeyLabel(accelerator: string): string {
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts
    .slice(0, -1)
    .map((modifier) => MODIFIER_SYMBOLS[modifier] ?? `${modifier}+`)
    .join("");
  return `${modifiers}${key}`;
}

/**
 * The same chord as the keys a hand actually presses, in the order macOS
 * writes them: one entry per key, so a surface can draw a cap each rather than
 * one chip for the whole chord.
 *
 * The label stays what a sentence, a menu item, or a screen reader gets — a
 * chord read aloud is one thing to press, and only a drawn keyboard needs the
 * keys apart.
 */
export function voiceHotkeyKeycaps(accelerator: string): readonly string[] {
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1).map((modifier) => MODIFIER_SYMBOLS[modifier] ?? modifier);
  return [...modifiers, key];
}
