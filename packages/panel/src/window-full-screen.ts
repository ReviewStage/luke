import { useLayoutEffect } from "react";

const FULL_SCREEN_ATTRIBUTE = "data-full-screen";

export function useWindowFullScreen(fullScreen: boolean | undefined): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (fullScreen === true) root.setAttribute(FULL_SCREEN_ATTRIBUTE, "true");
    else root.removeAttribute(FULL_SCREEN_ATTRIBUTE);
  }, [fullScreen]);
}
