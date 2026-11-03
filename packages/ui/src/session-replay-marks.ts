/**
 * session-replay-marks.ts -- what a component or a surface wears so the screen recording keeps no value or sheet of a person's past the masking: the class on an input whose value the recorder must not read, and the mark a stylesheet built from a person's words is written under.
 *
 * The recording masks every word the panel draws and every attribute but
 * the ones it lays out by (`@repo/panel`'s `session-replay.ts`). Two things
 * reach it past that masking, and each is answered here, once, for every
 * surface that has one.
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
