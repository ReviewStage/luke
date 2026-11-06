export function scrollScript(role: string, by: number): string {
  return `(() => {
  const box = document.querySelector(${JSON.stringify(`[role="${role}"]`)});
  if (box === null) return false;
  box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: ${JSON.stringify(by)} }));
  box.scrollTop += ${JSON.stringify(by)};
  return true;
})()`;
}

export const PIN_SCROLL_FADES_SCRIPT = `(() => {
  const depths = ["--ui-scroll-area-fade-start", "--ui-scroll-area-fade-end"];
  for (const box of document.querySelectorAll("*")) {
    const style = getComputedStyle(box);
    if (!style.animationName.includes("ui-scroll-area-fade")) continue;
    for (const depth of depths) box.style.setProperty(depth, style.getPropertyValue(depth), "important");
  }
})()`;
