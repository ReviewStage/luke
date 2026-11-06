import {
  AVATAR_SIZE,
  Avatar,
  IconButtonLink,
  MARK_PROVIDER,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  PublicPage,
  PublicSection,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { SITE_PAGE, SiteBarDownload, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

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

const FOUNDERS: readonly Founder[] = [
  {
    name: "Charles Pan",
    role: "Cofounder",
    photoSrc: "/assets/charles-pan.jpeg",
    bio: "Previously developer at Five Rings, early engineer at Yuzu Health.",
    socials: {
      linkedin: "https://www.linkedin.com/in/charleslpan/",
      x: "https://x.com/ceefryingpan",
    },
  },
  {
    name: "Dean Stratakos",
    role: "Cofounder",
    photoSrc: "/assets/dean-stratakos.jpeg",
    bio: "Previously building coding agents at Five Rings.",
    socials: {
      linkedin: "https://www.linkedin.com/in/dean-stratakos/",
      x: "https://x.com/DeanStratakos",
    },
  },
];

export function AboutPage(): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation current={{ page: SITE_PAGE.ABOUT }} />}
      bannerCall={<SiteBarDownload />}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.ABOUT }} />}
      title="About"
    >
      <PublicSection>
        <div className="grid gap-8 min-[560px]:grid-cols-2 min-[560px]:gap-6">
          {FOUNDERS.map((founder) => (
            <FounderCard founder={founder} key={founder.name} />
          ))}
        </div>
      </PublicSection>
    </PublicPage>
  );
}

function FounderCard({ founder }: { readonly founder: Founder }): React.JSX.Element {
  return (
    <article className="flex items-start gap-4">
      <Avatar name={founder.name} src={founder.photoSrc} size={AVATAR_SIZE.PORTRAIT} />
      <div className="min-w-0">
        <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.SECTION}>
          {founder.name}
        </Text>
        <div className="mt-0.5">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} font={TEXT_FONT.MONO}>
            {founder.role}
          </Text>
        </div>
        <div className="mt-2 text-pretty">
          <Text tone={TEXT_TONE.MUTED}>{founder.bio}</Text>
        </div>
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
    <div className="-my-2 -ml-3.5 mt-1 flex items-center">
      <IconButtonLink
        href={socials.linkedin}
        icon={<ProviderMark provider={MARK_PROVIDER.LINKEDIN} size={PROVIDER_MARK_SIZE.ICON} />}
        label={`${name} on LinkedIn`}
        newTab
      />
      <IconButtonLink
        href={socials.x}
        icon={<ProviderMark provider={MARK_PROVIDER.X} size={PROVIDER_MARK_SIZE.ICON} />}
        label={`${name} on X`}
        newTab
      />
    </div>
  );
}
