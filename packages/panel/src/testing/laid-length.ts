const NAMED = /var\((--[\w-]+)\)/u;

function arithmetic(sum: string): number {
  const tokens = sum.match(/\d+(?:\.\d+)?|[-+*/()]/gu) ?? [];
  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const value = terms();
      at += 1;
      return value;
    }
    if (token === "-") return -factor();
    return Number(token);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === "*" || tokens[at] === "/") {
      value = tokens[at++] === "*" ? value * factor() : value / factor();
    }
    return value;
  };
  const terms = (): number => {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      value = tokens[at++] === "+" ? value + product() : value - product();
    }
    return value;
  };
  return terms();
}

export function pixelsOf(element: Element, length: string): number {
  const style = getComputedStyle(element);
  let spelled = length;
  for (let named = NAMED.exec(spelled); named !== null; named = NAMED.exec(spelled)) {
    const [whole, property = ""] = named;
    spelled = spelled.replace(whole, `(${style.getPropertyValue(property).trim()})`);
  }
  const sum = spelled.replace(/calc/gu, "").replace(/px/gu, "");
  const pixels = /^[\d\s.+\-*/()]+$/u.test(sum) ? arithmetic(sum) : Number.NaN;
  if (!Number.isFinite(pixels)) throw new Error(`${length} works out to no length: ${sum}`);
  return pixels;
}

export function wayBackGap(bar: HTMLElement, opening: HTMLElement): number {
  const back = bar.querySelector("button");
  if (back === null) throw new Error("the bar leads with no way back");
  const row = pixelsOf(bar, getComputedStyle(bar).minHeight);
  const control = pixelsOf(back, "var(--ui-control-height)");
  return (row - control) / 2 + pixelsOf(opening, getComputedStyle(opening).paddingTop);
}
