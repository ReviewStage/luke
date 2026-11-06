export const LANDED = {
  AROUND: "around",
  WITHIN: "within",
  HELD: "held",
} as const;

export type Landed = (typeof LANDED)[keyof typeof LANDED];

export const LANDED_ATTRIBUTE = "data-landed";

export const LANDED_ANIMATION = "ui-landed";

export function landedMark(
  lit: boolean,
  where: Landed = LANDED.AROUND,
): { readonly [LANDED_ATTRIBUTE]?: Landed } {
  return lit ? { [LANDED_ATTRIBUTE]: where } : {};
}

export function land(element: HTMLElement, where: Landed = LANDED.AROUND): void {
  element.removeAttribute(LANDED_ATTRIBUTE);
  void element.offsetWidth;
  element.setAttribute(LANDED_ATTRIBUTE, where);
  const ended = (event: AnimationEvent) => {
    if (event.target !== element || event.animationName !== LANDED_ANIMATION) return;
    element.removeAttribute(LANDED_ATTRIBUTE);
    element.removeEventListener("animationend", ended);
  };
  element.addEventListener("animationend", ended);
}
