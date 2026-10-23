/**
 * replay-motion.ts -- plays an element's one-shot answer again from its start: a
 * button's pulse or shake, a dialog's nudge or shake.
 *
 * The answer is an attribute the element's sheet animates while it stands,
 * on the element itself or on a part of it that moves, as a button's face
 * pulses under the button. It is taken off and set again, so a second press
 * restarts it rather than landing on one still running, and it leaves as
 * the moving part's animation ends. It is the element's own, which React never draws, so no
 * render clears it mid-play.
 */

/**
 * Plays `attribute`'s animation on `element` again from its start, `mover`
 * being what the animation moves and `value` the attribute's, where its value
 * says which answer plays.
 */
export function replayMotion(
  element: HTMLElement,
  attribute: string,
  mover: Element = element,
  value = "true",
): void {
  element.removeAttribute(attribute);
  // Note that reading the layout here makes the engine see the attribute
  // gone before it is set again, which is what starts it anew.
  void element.offsetWidth;
  element.setAttribute(attribute, value);
  // Note that every animation inside it ending bubbles here too, as a pulse
  // of a button in a card does, so only the mover's takes the answer away.
  const ended = (event: Event) => {
    if (event.target !== mover) return;
    element.removeAttribute(attribute);
    element.removeEventListener("animationend", ended);
  };
  element.addEventListener("animationend", ended);
}
