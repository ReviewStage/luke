/**
 * session-replay-marks.tsx -- what a component or a surface wears so the screen recording shows the words that are the app's own and keeps no word, value, or sheet of a person's past the masking: the marks that unmask the app's own words and mask a person's again inside them, the class on an input whose value the recorder must not read, and the mark a stylesheet built from a person's words is written under.
 *
 * The recording masks every word the panel draws and every attribute but
 * the ones it lays out by (`@repo/panel`'s `session-replay.ts`), but for the
 * words a surface marks as the app's own.
 *
 * The app's own words: a label, a heading, a button's or a menu's words,
 * which say where someone is in the app and nothing about them. A surface
 * wraps them in `ReplayUnmask`, and every word under it, in nested elements
 * too, leaves the recording as it reads. Where such a region also draws a
 * person's words, a name, a title, a branch, an address, or anything they or
 * their agents wrote, those are wrapped in `ReplayMask` where they are drawn,
 * and the nearer mark wins: a sentence that mixes the two, such as
 * `` `Move to ${chosen.name}` ``, is drawn as
 * `<ReplayUnmask>Move to <ReplayMask>{chosen.name}</ReplayMask></ReplayUnmask>`.
 * Words under neither mark stay masked, so a surface nobody marked records
 * no word. Words being typed never leave, unmasked or not: a text area's
 * and an editable region's are masked under either mark. Both marks are
 * drawn as `display: contents`, so wrapping words in one never moves them,
 * and the recording's controller reads them off the live page
 * (`showsInReplay`), so the masking of attribute values does not reach them.
 *
 * Marks follow the page, not React's tree, so a mark round a caller never
 * reaches what its component draws in a portal: a menu, a dialog, the
 * command palette, a popover panel. And words a component is handed as a
 * string are drawn by the component, where its caller cannot wrap them.
 * Such a component takes a `replayUnmasked` opt-in, which unmasks the
 * words it draws itself, and where its items or its title may name a
 * person's thing, a `replayMasked` flag on the item (`titleReplayMasked`
 * on a dialog), which masks them again; each draws them through
 * `ReplayWords`. Words a caller hands as nodes are the caller's to mark,
 * inside the portal. A tooltip and a hover card take none, since the
 * recording leaves them out whole (`ph-no-capture`).
 *
 * Two things reach the recording past its masking, and each is answered
 * here, once, for every surface that has one.
 *
 * A radio's and a checkbox's value: the recorder reports what an input
 * holds as it changes, masking a field's words but never a radio's or a
 * checkbox's value, and every other radio of a group goes with the one
 * pressed. Base UI draws a hidden input beside each of its radios,
 * checkboxes, and switches, and gives it the option's value, which can be
 * an account's, a workspace's, or a task's id. The recorder's fixed
 * `ph-ignore-input` class keeps an input's changes out of the recording,
 * and Base UI takes no class for that input, so its ref puts the class
 * there. Note that it lands before the recorder reads the value React gave
 * the input as it was drawn, because the recorder reads a value set from
 * code a task after the setting.
 *
 * A stylesheet's rules: the recorder copies the rules of every sheet a
 * document or a shadow root adopts, and every rewrite of one, as they
 * stand, and no masking reaches CSS. Most sheets are the panel's own, but
 * one built from a person's words carries them in its selectors: a plan
 * diagram's measuring sheet names its classes, and the open comment
 * thread's names the thread. Such a sheet is written through
 * `writeWithheldSheet` and nothing else, which opens it with a rule that
 * matches nothing, and the recording's controller empties every sheet that
 * opens with that rule before a recording leaves. Note that the sheet is
 * only ever written whole, because the recorder sends a rule added one at a
 * time compressed, where the controller cannot read the mark.
 */

import type { ReactNode } from "react";

/** The attribute a region of the app's own words wears, under which they leave the recording as they read. */
const UNMASK = "data-replay-unmask";

/** The attribute a person's words wear inside such a region, under which they are masked again. */
const MASK = "data-replay-mask";

/** The nearest mark, either one, above words. */
const EITHER_MARK = `[${UNMASK}], [${MASK}]`;

/** Where words are being typed, which never leave whatever mark stands above them. */
const TYPED = 'textarea, [contenteditable]:not([contenteditable="false"])';

/** The recorder's fixed class for an input whose changes it never reads. */
const IGNORED_INPUT = "ph-ignore-input";

/** The selector a withheld sheet's first rule is written with, which no element wears. */
const WITHHELD = ".session-replay-withheld";

/** The ref a Base UI radio's, checkbox's, or switch's `inputRef` takes, so the recorder never reads the value its hidden input holds. */
export function ignoredByReplay(input: HTMLInputElement | null): void {
  input?.classList.add(IGNORED_INPUT);
}

/** Writes a sheet whose rules are built from a person's words, whole, under the mark that keeps them out of every recording. */
export function writeWithheldSheet(sheet: CSSStyleSheet, rules: string): void {
  sheet.replaceSync(`${WITHHELD} {}\n${rules}`);
}

/** Whether a stylesheet's text, or one of its rules as the recorder copied it, is a withheld sheet's mark. */
export function opensWithheldSheet(css: string): boolean {
  return css.startsWith(WITHHELD);
}

/** Words that are the app's own, a label, a heading, a button's or a menu's words, which leave the recording as they read; a person's words inside go in `ReplayMask`. */
export function ReplayUnmask({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="contents" {...{ [UNMASK]: "" }}>
      {children}
    </span>
  );
}

/** A person's words inside a `ReplayUnmask` region, a name, a title, a branch, or anything they or their agents wrote, masked again in the recording. */
export function ReplayMask({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="contents" {...{ [MASK]: "" }}>
      {children}
    </span>
  );
}

/**
 * Words a component draws from a string its caller handed it, marked as its
 * caller asked: under the mask mark where the caller masked them (a menu
 * item or a choice that names a person's thing), under the unmask mark where
 * the caller unmasked what the component draws (`replayUnmasked`), and
 * unmarked otherwise, so they take whatever mark stands above them. This is
 * how a component whose words stand in a portal, which no mark around its
 * caller reaches, or arrive as strings, which its caller cannot wrap, takes
 * its caller's marks.
 */
export function ReplayWords({
  unmasked = false,
  masked = false,
  children,
}: {
  unmasked?: boolean | undefined;
  masked?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  if (masked) return <ReplayMask>{children}</ReplayMask>;
  return unmasked ? <ReplayUnmask>{children}</ReplayUnmask> : <>{children}</>;
}

/**
 * Whether the words an element holds leave the recording as they read: the
 * nearest mark at or above it is `ReplayUnmask`'s, and they are not being
 * typed. No element, no mark, or a nearer `ReplayMask` keeps them masked.
 */
export function showsInReplay(element: Element | null | undefined): boolean {
  if (element === null || element === undefined || element.closest(TYPED) !== null) return false;
  return element.closest(EITHER_MARK)?.hasAttribute(UNMASK) === true;
}
