import { SiteFooter, SiteHeader } from "./SiteChrome";

type Founder = {
  readonly name: string;
  readonly role: string;
  readonly photoSrc: string;
  readonly bio: string;
  readonly socials: {
    readonly linkedin: string;
    readonly x: string;
  };
};

/**
 * The portraits are 128px webp — twice the box they are drawn in, and no more.
 * The camera originals carried EXIF the site has no business publishing, GPS
 * among it, so what ships is re-encoded with its metadata dropped rather than
 * the file that came off the phone.
 */
const FOUNDERS: readonly Founder[] = [
  {
    name: "Charles Pan",
    role: "Cofounder",
    photoSrc: "/assets/charles-pan.webp",
    bio: "Previously developer at Five Rings, early engineer at Yuzu Health.",
    socials: {
      linkedin: "https://www.linkedin.com/in/charleslpan/",
      x: "https://x.com/ceefryingpan",
    },
  },
  {
    name: "Dean Stratakos",
    role: "Cofounder",
    photoSrc: "/assets/dean-stratakos.webp",
    bio: "Previously building coding agents at Five Rings.",
    socials: {
      linkedin: "https://www.linkedin.com/in/dean-stratakos/",
      x: "https://x.com/DeanStratakos",
    },
  },
];

/** Who is behind the app: a page of its own, linked from the header and footer. */
export function AboutPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      <main className="shell pt-12 pb-16">
        <h1 className="m-0 text-[1.75rem] leading-[1.2] font-semibold tracking-[-0.02em]">About</h1>

        {/* Two up where the 700px column still leaves each card its measure, and
            stacked below that rather than squeezed beside a photo. */}
        <div className="mt-10 grid gap-8 min-[560px]:grid-cols-2 min-[560px]:gap-6">
          {FOUNDERS.map((founder) => (
            <FounderCard founder={founder} key={founder.name} />
          ))}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

function FounderCard({ founder }: { readonly founder: Founder }): React.JSX.Element {
  return (
    <article className="flex items-start gap-4">
      <img
        alt={founder.name}
        className="size-16 shrink-0 rounded-full border border-border object-cover"
        height={128}
        loading="lazy"
        src={founder.photoSrc}
        width={128}
      />
      <div className="min-w-0">
        <h3 className="m-0 text-base font-semibold tracking-[-0.01em]">{founder.name}</h3>
        <p className="mt-0.5 mb-0 font-mono text-xs text-muted-foreground">{founder.role}</p>
        <p className="mt-2 mb-0 text-sm text-pretty text-muted-foreground">{founder.bio}</p>
        <FounderSocials name={founder.name} socials={founder.socials} />
      </div>
    </article>
  );
}

function FounderSocials({
  name,
  socials,
}: {
  readonly name: string;
  readonly socials: Founder["socials"];
}): React.JSX.Element {
  return (
    /* The negative margin pulls the icons' padding back so the marks line up
       with the name above them rather than sitting inset from it. */
    <div className="-ml-1.5 mt-3 flex items-center gap-1">
      <SocialLink href={socials.linkedin} label={`${name} on LinkedIn`}>
        <LinkedInMark />
      </SocialLink>
      <SocialLink href={socials.x} label={`${name} on X`}>
        <XMark />
      </SocialLink>
    </div>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  readonly href: string;
  readonly label: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a
      aria-label={label}
      className="inline-flex items-center rounded-md p-1.5 text-muted-foreground no-underline transition-colors duration-150 hover:text-foreground motion-reduce:transition-none"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

/* Both marks are inlined for the same reason the GitHub mark is: the page
   fetches no icon at runtime, and `currentColor` leaves the color to the link. */
const LINKEDIN_MARK_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

const X_MARK_PATH =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";

function LinkedInMark(): React.JSX.Element {
  return (
    <svg className="block size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={LINKEDIN_MARK_PATH} />
    </svg>
  );
}

function XMark(): React.JSX.Element {
  return (
    <svg className="block size-[14px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={X_MARK_PATH} />
    </svg>
  );
}
