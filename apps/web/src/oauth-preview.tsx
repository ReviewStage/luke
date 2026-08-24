import {
  accountLoopbackPage,
  LOOPBACK_CONNECTION_SOURCE,
  LOOPBACK_PAGE_TONE,
  type LoopbackPage,
} from "@sidecar/credentials/loopback-page";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type PreviewLink = {
  readonly label: string;
  readonly href: string;
};

function pageUrl(path: string): string {
  return path;
}

function loopbackUrl(page: LoopbackPage): string {
  return URL.createObjectURL(
    new Blob([accountLoopbackPage(page)], { type: "text/html;charset=utf-8" }),
  );
}

const hostedLinks: readonly PreviewLink[] = [
  {
    label: "Hosted Sign-In: Google",
    href: pageUrl("/sign-in.html?preview=1&state=google.preview"),
  },
  {
    label: "Hosted Sign-In: GitHub",
    href: pageUrl("/sign-in.html?preview=1&state=github.preview"),
  },
  {
    label: "Hosted Sign-In: Missing Provider",
    href: pageUrl("/sign-in.html"),
  },
  {
    label: "Hosted Consent",
    href: pageUrl("/consent.html"),
  },
];

const accountLinks: readonly PreviewLink[] = [
  {
    label: "Signed In To Luke: Google",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Signed in",
      title: "Signed in to Luke",
      body: "You can close this tab and return to Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.GOOGLE,
    }),
  },
  {
    label: "Signed In To Luke: GitHub",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Signed in",
      title: "Signed in to Luke",
      body: "You can close this tab and return to Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.GITHUB,
    }),
  },
  {
    label: "Account: Not Verified",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.ATTENTION,
      badge: "Not verified",
      title: "Luke could not verify this sign-in",
      body: "Return to Luke and try again.",
      source: LOOPBACK_CONNECTION_SOURCE.GOOGLE,
    }),
  },
  {
    label: "Account: Not Completed",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.ATTENTION,
      badge: "Not completed",
      title: "Sign-in was not completed",
      body: "Return to Luke and try again.",
      source: LOOPBACK_CONNECTION_SOURCE.GOOGLE,
    }),
  },
  {
    label: "Account: Already Used",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Already used",
      title: "This sign-in has already been used",
      body: "You can close this tab and return to Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.GOOGLE,
    }),
  },
];

const calendarLinks: readonly PreviewLink[] = [
  {
    label: "Connected To Google Calendar",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Connected",
      title: "Connected to Google Calendar",
      body: "You can close this tab and return to Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.GOOGLE_CALENDAR,
    }),
  },
  {
    label: "Google Calendar: Not Connected",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.ATTENTION,
      badge: "Not connected",
      title: "Sign-in didn\u2019t complete",
      body: "You can close this tab and try again from Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.GOOGLE_CALENDAR,
    }),
  },
];

const linearLinks: readonly PreviewLink[] = [
  {
    label: "Connected To Linear",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Connected",
      title: "Connected to Linear",
      body: "You can close this tab and return to Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.LINEAR,
    }),
  },
  {
    label: "Linear: Not Connected",
    href: loopbackUrl({
      tone: LOOPBACK_PAGE_TONE.ATTENTION,
      badge: "Not connected",
      title: "Sign-in didn\u2019t complete",
      body: "You can close this tab and try again from Luke.",
      source: LOOPBACK_CONNECTION_SOURCE.LINEAR,
    }),
  },
];

function LinkSection({
  title,
  links,
}: {
  readonly title: string;
  readonly links: readonly PreviewLink[];
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      <div className="mt-4 grid gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground no-underline transition-colors duration-150 hover:bg-muted"
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}

function OAuthPreview(): React.JSX.Element {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-[760px] content-center gap-5 p-6">
      <header>
        <h1 className="m-0 text-3xl leading-tight font-semibold">OAuth Page Preview</h1>
        <p className="mt-2 mb-0 text-muted-foreground">
          Opens each page in a new tab. Hosted sign-in links use a dev-only preview flag so they do
          not immediately leave for the identity provider.
        </p>
      </header>
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <LinkSection title="Hosted" links={hostedLinks} />
        <LinkSection title="Account Loopback" links={accountLinks} />
        <LinkSection title="Calendar Loopback" links={calendarLinks} />
        <LinkSection title="Tracker Loopback" links={linearLinks} />
      </div>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <OAuthPreview />
  </StrictMode>,
);
