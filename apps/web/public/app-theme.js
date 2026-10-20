// app-theme.js -- the web app's theme before its first frame: the theme the
// account last chose in this browser, kept by `src/app/web-appearance.tsx`
// under `luke.theme`, worn on the root and the browser's chrome before the
// stylesheet paints, so a dark tab is never light while its state is read.
// A classic script rather than a module, because only a classic script in
// the head runs before the first frame, and a file rather than inline,
// because the page's policy runs no inline script. System, and no choice
// kept, follow the machine, as the setting's default does. The grounds are
// the site palette's own (`@luke/ui`'s `palettes.css`), which a test holds
// this file to.
(() => {
  const GROUND = { light: "#fbfbfa", dark: "#08090b" };
  let chosen = null;
  try {
    chosen = localStorage.getItem("luke.theme");
  } catch {
    // A storage the browser refuses keeps no choice, so the machine's stands.
  }
  const theme =
    chosen === "light" || chosen === "dark"
      ? chosen
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-luke-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", GROUND[theme]);
})();
