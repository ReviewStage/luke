import { styleElementSheets, touchesStyle } from "../style-element-sheets.js";

export function adoptInlineStyles(root: HTMLElement): () => void {
  const sheets = styleElementSheets(root);
  let adopted = new Set<CSSStyleSheet>();
  const others = () => document.adoptedStyleSheets.filter((sheet) => !adopted.has(sheet));
  const adopt = () => {
    const mine = new Set(sheets());
    document.adoptedStyleSheets = [...others(), ...mine];
    adopted = mine;
  };
  const observer = new MutationObserver((records) => {
    if (records.some(touchesStyle)) adopt();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  adopt();
  return () => {
    observer.disconnect();
    document.adoptedStyleSheets = others();
    adopted = new Set();
  };
}
