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
//
// It reads too whether the tab last read someone signed in here
// (`src/app/first-frame-hint.tsx`), and how the shell last drew its sidebar,
// which the panel keeps in this same storage (`@luke/panel`'s
// `sidebar-collapse.ts`): pinned, and how wide, so the frame app.html draws
// before the panel stands it the same. A browser signed out, or one that
// never signed in, draws no sidebar in the frame, since the sign-in gate
// stands none.
(() => {
  const GROUND = { light: "#fbfbfa", dark: "#08090b" };
  const SIDEBAR_WIDTH = { MIN: 200, MAX: 400 };
  let chosen = null;
  let signedIn = null;
  let sidebarCollapsed = null;
  let sidebarWidth = null;
  try {
    chosen = localStorage.getItem("luke.theme");
    signedIn = localStorage.getItem("luke.signed-in-here");
    sidebarCollapsed = localStorage.getItem("luke.sidebar-collapsed");
    sidebarWidth = localStorage.getItem("luke.sidebar-width");
  } catch {
    // A storage the browser refuses keeps no choice, so the machine's stands, and the frame draws no sidebar.
  }
  const theme =
    chosen === "light" || chosen === "dark"
      ? chosen
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  const root = document.documentElement;
  root.setAttribute("data-luke-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", GROUND[theme]);
  if (signedIn === "true" && sidebarCollapsed === "false") {
    root.setAttribute("data-luke-boot-sidebar", "pinned");
    const width = Number(sidebarWidth);
    if (sidebarWidth !== null && sidebarWidth.trim() !== "" && Number.isFinite(width)) {
      const clamped = Math.min(SIDEBAR_WIDTH.MAX, Math.max(SIDEBAR_WIDTH.MIN, Math.round(width)));
      root.style.setProperty("--luke-boot-sidebar-width", `${clamped}px`);
    }
  }
})();
