# Research: a better domain, or a better name

Status: research for Dean's ask, written 2026-10-15 against main at
`5ff5948d`. A second pass the same day looked for .com domains (§5) and
moved the recommendation (§6). Nothing was registered, bought, or reserved,
and no seller was contacted. Each domain below was checked from the sandbox
on 2026-10-15: RDAP at the TLD's registry (WHOIS where a TLD has no RDAP),
then `dig` for NS and A records, then the site's own page for a parked or
for-sale notice. A free domain can still carry a premium price from its
registry. Only a registrar's checkout shows that, and none was opened.

Dean's ask: "Kick off a worker to brainstorm better product/domain names.
tryluke.dev sucks." Then: "Look for .com URLs." And: the name "doesn't have
to be a person's name".

## TL;DR

- **Every credible `luke.*` is someone's.** luke.dev, luke.app, luke.so,
  luke.io, luke.sh, luke.to, luke.computer, and luke.co are other Lukes'
  personal sites. luke.com is held by an owner who registered it in 1995.
  Three are for sale: **luke.ai** (on Atom, with no price shown),
  **luke.team** ($7,800 on Afternic), and **lukeai.com** ($3,279 on
  Afternic). The free short ones are **luke.build**, **luke.new** (the .new
  TLD is about $412 a year, and its policy wants an address that starts
  something), and luke.inc.
- **"Luke" now has a direct namesake.** getluke.app (registered
  2026-05-10) is *"Luke — a personal AI that knows who you are"*: a free
  hold-to-talk AI assistant for macOS 14+ from Thinking Oracle, in limited
  research preview. That is the same OS, the same input (voice), and the
  same category (an AI you talk to). A second, unrelated "Luke Desktop" MCP
  server also exists. A domain change doesn't fix that confusion. A name
  change does.
- **Bare one-word domains are gone in every direction we tried.** Of 55
  brainstormed words, none had a free .com. Persona names (Otto, Archie,
  Mason, Penn, Bosun) are each already an AI startup's name. Bosun's
  getbosun.com is "Managed AI software delivery", registered in 2026. What
  is still free is a short .dev, .app, or .build on a coined word or an
  uncommon name.
- **A third "Luke" holds tryluke.com.** tryluke.com (2026-08-07) and
  useluke.com belong to "Luke AI", a LinkedIn growth service founded in
  2025 that bills itself as "Human Strategy. AI-powered Execution".
- **.com (§5):** no one-word .com that fits is free. Every bare word we
  tried is registered, and 2026 speculators have taken most voice-plus-build
  compounds (saytobuild.com, buildaloud.com, speakspec.com,
  spokenplan.com). What's left:
  - **Attainable bare .coms with a visible price:** **talkship.com
    ($3,495)** and **voiceship.com ($1,795)**, both at HugeDomains, both
    with low conflict, and both with .dev and .app free.
  - **Unregistered compounds with low conflict:** **planspoke.com**,
    shipaloud.com, spokespec.com, talktoship.com, and saytoship.com.
  - **Unregistered Luke compounds:** lukeplans.com and lukebuild.com.
- **Hashout fell out in the .com pass.** hashout.ai ("HashOut", 2025) and
  hashitout.ai ("HashItOut", 2026) are both AI products built on resolving
  disagreements. hashout.com has been held since 2004 and isn't listed.
- **Recommendation (§6):**
  1. **Keep "Luke" and move links to `luke.build`, now.** It's cheap, it
     reads well (`luke.build/acme/plan/…`), and "build" says what the
     product does. Keep `tryluke://` as the scheme. The change is roughly a
     day of code plus redirects (§4.1). If a .com home is wanted alongside,
     lukeplans.com is free.
  2. **Before the public launch, rename the product to Talkship and keep
     Luke as the teammate inside it:** "Talk it through with Luke, ship it
     with Talkship." talkship.com is $3,495 with nothing else using the
     name, and talkship.dev and .app are free. The cheaper runner-up is
     **VoiceShip** ($1,795). If the .com must cost nothing, take
     **Planspoke** (unregistered on .com, .dev, and .app).

## 1. Domains if the name stays "Luke"

"Link" shows how a plan link reads. "Price" is the visible aftermarket ask,
or the standard yearly price at a mainstream registrar (Porkbun's public
price list on 2026-10-15) for a free domain.

| Domain | Status (2026-10-15) | Price | Link |
| --- | --- | --- | --- |
| tryluke.dev | Ours. Name.com, 2026-08-13, Vercel DNS | — | `tryluke.dev/acme/plan/…` |
| **luke.build** | **Free** (RDAP and WHOIS: not found) | ~$26/yr standard; a registry premium can't be ruled out | `luke.build/acme/plan/…` |
| luke.new | Free | ~$412/yr; Google's .new policy requires the address to start an action (a new plan qualifies, a plan's link doesn't) | `luke.new` → New plan |
| luke.inc | Free | ~$258 first year, ~$2,060/yr renewal | `luke.inc/acme/plan/…` |
| luke.dev | Taken. Spaceship, 2019-02-22. Personal site ("Hello - luke.dev") | Not listed | `luke.dev/acme/plan/…` |
| luke.app | Taken. 2018. Personal site (Luke Brookhart) | Not listed | |
| luke.so | Taken. 2012. Redirects to luke.beard.co (personal) | Not listed | |
| luke.ai | Taken. 101domain, 2017-12-16. NS at atom.com, redirects to atom.com/name/Luke.ai | **For sale on Atom**, price hidden behind a 403. Comparable short .ai names sell in the five to six figures | `luke.ai/acme/plan/…` |
| luke.sh | Taken. 2023. Redirects to lou.cx (personal) | Not listed | |
| luke.io | Taken. 2013. Personal site (Luke Hatcher) | Not listed | |
| luke.com | Taken. Network Solutions, 1995-02-12. Blank page on Cloudflare | Not listed | |
| luke.co | Taken. "Luke.co - Built by AI. Written by a Human." | Not listed | |
| luke.team | Taken. NS at afternic.com | **$7,800** buy-now on Afternic | `luke.team/acme/plan/…` |
| luke.tools / .run / .studio / .fm | Taken. 2020, 2020, 2021, 2008. No site | Not listed | |
| luke.page / .computer / .to | Taken. Personal sites | Not listed | |
| getluke.com | Taken. 2007. Personal site (Luke Simpson) | Not listed | |
| getluke.app | Taken. 2026-05-10. **"Luke — a personal AI that knows who you are"** (the namesake, §2) | Not listed | |
| getluke.dev | **Free** | ~$9/yr, then ~$13 | `getluke.dev/acme/plan/…` |
| useluke.com | Taken. 2026-01-29, no answer over HTTPS | Not listed | |
| useluke.dev / useluke.app | **Free** / **Free** | ~$9/yr | `useluke.dev/acme/plan/…` |
| lukehq.com | Taken. Namecheap, 2024-12-14, parked | Not listed | |
| lukehq.dev | **Free** | ~$9/yr | `lukehq.dev/acme/plan/…` |
| withluke.com | Taken. 2017. Photographer | Not listed | |
| withluke.dev / withluke.app | **Free** / **Free** | ~$9/yr | |
| heyluke.app / heyluke.dev | **Free** / **Free** (heyluke.com taken, 2001) | ~$9/yr | `heyluke.app/acme/plan/…` |
| askluke.dev / askluke.app | **Free** / **Free** (askluke.com taken, 2004) | ~$9/yr | |
| meetluke.dev / meetluke.app | **Free** / **Free** (meetluke.com taken) | ~$9/yr | |
| talktoluke.com | Taken. A UK therapist's practice, "Talk to Luke" | Not listed | |
| lukeai.com | Taken. NS at afternic.com | **$3,279** buy-now on Afternic | |
| lukeai.dev / lukeapp.dev | Taken. lukeapp.dev was registered **2026-10-06**, nine days before this check | Not listed | |
| lukeapp.com | Taken. Porkbun, 2018 | Not listed | |
| lu.ke | Taken. KENIC, 2021. A personal site (Luke Childs) on Vercel DNS | Not listed | `lu.ke/acme/plan/…` |

Reading the table:

- **The one short, free, on-brand option is `luke.build`.** Its link reads
  as a sentence (`luke.build/acme/plan/teammate-invitations` would read
  even better if a slug is ever added). ".build" says what the product does
  after the plan. It's a newer TLD that a few corporate filters treat with
  suspicion. That matters little for a link a developer opens on their own
  machine.
- **The `get`/`use`/`hey`/`ask` prefixes on .dev or .app are free** and as
  cheap as tryluke.dev, but they're the same shape as tryluke.dev. Of them,
  `heyluke.app` is the most in voice ("hey Luke"), and the prefix still
  costs a syllable in every link.
- **Buying a bare name** (luke.ai on Atom, luke.team at $7,800) gets a
  short link but not a name of our own. getluke.app still stands next to
  it.

## 2. Why the name itself is worth questioning

- **getluke.app** is the same platform, input, and category: a Mac AI you
  talk to by holding a key. It launched in 2026 under Thinking Oracle Inc.
  It's in research preview, so it may grow or fold. Either way, it is what a
  developer finds when they search "Luke Mac AI".
- **Others named Luke in the space:** "Luke Desktop", an MCP-capable Claude
  Desktop alternative (github.com/DrJonBrock/luke-desktop, 29 stars), and
  LUKE, Studio Ousia's NLP model (727 stars), which is familiar to ML
  readers.
- **Trademarks:** Trademarkia lists live class 9 LUKE marks: Luke
  Applications, LLC, for asset-management and scheduling software
  (86867825, 87312171), and T2 Systems Canada, for payment stations
  (78974252). None is an AI product, but in class 9 a "Luke" for software
  is not clean. This is a search, not clearance.
- **github.com/luke** is a personal account, and the App Store has a
  utility called "LUKE" (LJA Engineering). The desktop scheme `luke://`
  was already refused in #2697 as too common, which is why it's
  `tryluke://`.
- **What Luke has going for it:** it's one syllable, unmistakable when
  spoken, and a person. "Talk to Luke" needs no explaining. The brand is
  built on it: the **L-face** (a capital-L nose that curls into a smile,
  `packages/brand`), the face-first wordmark, and the onboarding's "Hi!
  I'm Luke."

## 3. New names

### 3.1 The brainstorm

Every name below was checked on .dev and .app, most on .com, and some on
.build and .so too. "Taken" means every one checked is registered. A note
names the product that killed a name, where one did.

| Direction | Names, with what killed each one |
| --- | --- |
| A teammate, like Luke | Otto, Juno, Milo, Theo, Remy, Ezra, Arlo, Wren, Nico, Rory, Mabel, Gus, Hollis, Emmett, Wilbur, Jude, Ned, Cal, Zeke, Wes, Beau (all taken; most bare .build free); Archie (heyarchie.com is "AI-powered staff accountant"); Mason (taken; "Mason" is also Dart's brick generator); Sawyer (taken); Bosun (**getbosun.com is "Managed AI software delivery"**, 2026); **Penn**, **Ike**, **Reed**, **Nell** (shortlisted) |
| Planning, spec, blueprint | Blueprint, Drafter, Planwise, Vellum, Groundwork, Plotter, Tracer, Draftboard (a product), Draftline (draftline.dev: "Git-native versioning"), Blueline, Specwright (.dev for sale), Specship (**specship.dev: "AI coding agent for tickets"**), Planship (**planship.io: SaaS plan packaging**), Planly; Specout, Planhand, Scopecall (.dev and .app free, but they read as features); **Plait**, **Talkspec** (shortlisted) |
| Voice and conversation | Parley (parley.so: "the Legal Agent"), Huddle, Sayso, Talkthrough, Hark, Murmur, Natter, Confab, Talkover (talkover.app: a voice AI agent), Aloud, Outloud, Thinkaloud (thinkaloud.dev: system design interviews), Planaloud (planaloud.com: a read-aloud product), Saywhen, Saydraft (**saydraft.com: voice contracts**), Saydown (**saydown.com: Mac voice sticky notes, 2026**), Sayplan (**SayPlan: an iPhone AI voice planner, and a CoRL 2023 paper**); **Hashout**, **Plansay** (shortlisted) |
| Factory, build, ship | Foundry, Shipwright, Slipway (for sale), Kiln, Millwright, Lathe, Foreman (foreman.so: "AI operator for local businesses"), Gaffer, Keel, Keelson (**keelson.dev: "Turn Claude Code a…"**), Drydock, Kickoff, Trestle; **Talkship** (shortlisted) |
| Short invented words | Plano, Spekk, Talo, Kivo, Brio, Orra, Dicta, Voco, Voxa (voxa.dev: "Ship fast"), Saywright, Saydo, Parlo (a language app), Specsay, Voicespec, Hashit |

Two patterns show up:

- **The AI-agent wave has taken the friendly names.** Otto, Archie, Penn,
  Bosun, Nell, Mason, Foreman, Keelson, and Specship each have a 2025–26 AI
  product. A persona name will meet one of these sooner or later.
- **Coined compounds still have open .dev and .app names**, but rarely a
  .com: none of the 55 has a free .com. The .com of a coined word is either
  held since the 2000s or bought by a speculator in 2025–26 (plansay.com,
  talkspec.com, saydown.com).

### 3.2 The shortlist

"Domain" is what's free (checked). "Conflict" summarizes web, GitHub, App
Store, and Trademarkia searches. Justia and USPTO's own search refused
automated requests, so the trademark column is a search, not clearance.

| Name | Meaning and fit | Said aloud | Free domain | Conflicts | Scheme |
| --- | --- | --- | --- | --- | --- |
| **Luke** (today) | A teammate. The brand, face, and voice are built on it | "Talk to Luke": one syllable, unmistakable | **luke.build**, getluke.dev, heyluke.app | **High**: getluke.app (Mac voice AI, 2026), Luke Desktop (MCP), live class 9 LUKE marks | `tryluke://` (kept) |
| **Hashout** | "Hash it out": talk a plan through until it's settled. Developers also hear *hash* (a commit). Not a person, so Luke can stay the teammate *inside* Hashout | "Hash it out with Luke", "Open in Hashout". Two syllables, spelled as said | **hashout.dev**, hashout.build, hashout.so (.com held since 2004, .app since 2025) | **High** (from the .com pass): **hashout.ai** "puts an AI answer in front of a panel of frontier models and shows you where they disagree" (2025-11). **hashitout.ai** is an AI mediator (2026-07). Two iOS "Hash It Out" debate apps (2026). The only HASHOUT mark (class 9) was cancelled in 2021. github.com/Hashout is an empty account | `hashout://` |
| **Talkship** | Talk it, ship it. The one name that holds both ends of the product (the call and the PR) | "Open in Talkship". Two syllables. Can be misheard as "talk shop" (which also fits) | **talkship.dev**, .app, .build, .so. talkship.com is **$3,495** at HugeDomains | **Low**: nothing uses the name. TALK SHIP! is a live class 38 mark (a cruise forum). github.com/talkship is an empty org | `talkship://` |
| **Nell** | A teammate, like Luke. Short, warm, uncommon | "Talk to Nell": one syllable, clear. Rhymes with "tell" | **nell.dev** (bare!), nell.build | **Medium**: a pending NELL application in classes 9/41/42 (Nell Technologies, filed 2026-03, non-final refusal), "Nell" open-source AI agent (11★), NELL (CMU's ML dataset) | `nell://` is too generic; `heynell://` |
| **Ike** | A teammate. Eisenhower, *the* planner (D-Day), and the "I" can curl into the L-face's smile (see the mock page) | "Talk to Ike": one syllable, crisp; may need spelling once | **ike.build** | **Medium–high**: live IKE marks in classes 9/42, among them Two Six Labs' AI cyber-operations *planning* software (6087123) and ikeGPS. Three Mac Eisenhower-matrix to-do apps are named Ike. Search is crowded by IPsec IKEv2 and IKEA | `ike://` is short; `heyike://` |
| **Reed** | A teammate. A reed is what a voice plays through, and "reed" sounds like *read* (your plan) | "Talk to Reed". Homophone of *read*, which is a pun, or a confusion | **reed.build** | **High**: REED AI (Reed AI Ventures, reg. 8405497, classes 9/42, 2026-08) covers AI communication software. Reed.ai is the UK recruiter's AI agent. "reed" is an exact-name Mac RSS app | `reedapp://` |
| **Penn** | A teammate who holds the pen: writes the plan down while you talk | "Talk to Penn". Homophone of *pen*, which fits | **penn.so**, penn.build, withpenn.dev, talktopenn.com | **High**: PENN.AI (Penn AI Corp., reg. 6798464, class 42) covers *real-time speech-to-text transcription of conversations*. penn.ai and heypenn.com are AI products. UPenn polices PENN | `penn://` |
| **Plait** | Plait the strands of a conversation into one plan | "Open in Plait". Rhymes with *plate*, which is the risk | **plait.dev**, plait.build | **Low–medium**: no live PLAIT mark in 9/42 and no AI or voice product. worktile/plait (a 696★ whiteboard framework) and plait.com (restaurant ops) share the name | `plait://` |
| **Plansay** | Plan by saying it | "Open in Plansay". Clear, though a little flat | **plansay.dev**, .app, .build, .so. .com was parked after a 2025-11 registration, no price | **Low**: a small Russian to-do planner repo. No marks, no app, github.com/plansay free | `plansay://` |
| **Talkspec** | Talk your spec | "Open in Talkspec". Clear, descriptive | **talkspec.dev**, .app. The .com was registered 2026-09-10 (parked) | **Low–medium**: a 1★ "talkspec" AI repo (2026-10), and the reverse "SpecTalk" was an ElevenLabs hackathon voice-to-spec tool | `talkspec://` |

Kept in the table for the record, but out after the conflict pass:
**Reed** and **Penn** (live AI marks in classes 9/42, one for conversation
transcription) and **Ike** (crowded IKE marks). Also cut: **Saydown** (saydown.com is
live: "Voice sticky notes for macOS. Don't write it down. Say it down.", plus
a second Mac dictation repo of the same name), **Sayplan** (an identically
named iPhone AI voice planner, and the paper owns github.com/sayplan), and
**Bosun**, **Specship**, **Planship**, and **Keelson** (each an existing
AI or dev product).

### 3.3 How they compare

- **Hashout was the best coined name on the first pass, until the .com
  pass found hashout.ai and hashitout.ai (§5).** It says the product's act
  (talking a plan through to settled) in an idiom every English-speaking
  developer already uses, and it's short and spelled as it sounds. It is a product name, not a person, so **Luke can stay the
  teammate**: "Hashout. Hash it out with Luke." That split keeps the voice,
  the face, and "Hi! I'm Luke." The cost is the name the product is known
  by. Its weak spots: the .com and .app are someone else's, and
  github.com/Hashout is an empty account (GitHub's name-squatting policy is
  the route, not a seller).
- **Best "says the whole product": Talkship.** It names the call and the
  ship. Its .com has a visible price ($3,495), so the whole set is
  attainable. It sounds less like a word developers already use.
- **Best persona: Nell**, for the bare .dev alone. The pending NELL
  application in classes 9 and 42 needs watching, and a persona name
  invites the same collisions Luke has.
- **Plait** is the cleanest persona-adjacent word (no live mark, plait.dev
  free), but it's heard as "plate" and has to be spelled out.
- **Plansay and Talkspec** are clear and free, but descriptive enough to
  read as a feature, not a brand.

## 4. What each path costs

### 4.1 Keep "Luke", move to a better domain

What changes in code. Every place is named once, because the host is
already a constant in a few places:

| Where | Today | Change |
| --- | --- | --- |
| `packages/features/src/mention-link.ts` (`LINK.ORIGIN`, `LINK.HOST`) | `https://tryluke.dev` | The new origin writes. **`tryluke.dev` stays a host the decoder reads forever**, the way `LEGACY` reads `luke://`, because plan documents and messages already hold `https://tryluke.dev/<ws>/plan/<id>` links and old plans are never rewritten (web-and-links "What shipped") |
| `packages/features/src/open-address.ts` | Rebuilds the address on `https://tryluke.dev` | The new origin |
| `packages/features/src/live-contract.ts` | `HOSTED_SERVICE_ORIGIN`, `HOSTED_VOICE_SERVICE_ORIGIN` (`wss://tryluke.dev`) | The new origin |
| `apps/desktop/src/main/bootstrap.ts:86`, `packages/host/src/host-kernel.ts:87` | `https://tryluke.dev/api/auth` | The new origin |
| `packages/host/src/update-service.ts`, `packages/features/src/feedback/delivery.ts`, `apps/web/src/changelog-releases.ts` | Changelog page, feedback API, site origin | The new origin |
| `apps/web/*.html` | `og:url`, `og:image` meta | The new origin |
| `apps/web/server/feedback.mjs` | `feedback@tryluke.dev` (Resend) | A verified sender on the new domain (DNS records at Resend) |
| `packages/service/src/agents/coder-host/instructions.ts` | Tells the coding agent a `tryluke.dev` link names a plan | Name both hosts |
| Tests and goldens | 36 files spell `tryluke.dev` | Mechanical, plus one test that an old `tryluke.dev` link still decodes as the same mention |
| `apps/desktop/scripts/electron-builder-config.mjs:104` | `schemes: ["tryluke"]` | **Keep.** The scheme is invisible to readers, and changing it orphans links already written in the `tryluke:` form. If it does change, register both schemes and decode both |

Outside the repository (Dean, or whoever holds the accounts): add the
domain to the Vercel project; set `BETTER_AUTH_URL`; add the new callback
URLs to the Google and GitHub OAuth apps and the Luke GitHub App (callback,
setup, and webhook URLs); and verify the domain at Resend.

**Keeping old links working:**

- **Keep tryluke.dev registered and on the same Vercel project for as long as
  a release that hard-codes it is in use.** Shipped desktop builds call
  `https://tryluke.dev/api/auth`, the hosted service, and
  `wss://tryluke.dev` directly. A redirect breaks a WebSocket and is fragile
  for auth POSTs, so **`/api/*` and the voice socket keep being served on
  both hosts**, not redirected.
- **Every page path on tryluke.dev 308s to the same path on the new host**
  (a `redirects` entry in `apps/web/vercel.json` with `has: [{ type: "host",
  value: "tryluke.dev" }]`): `/`, `/changelog`, `/privacy`, and every
  `/<workspace>/plan/<id>`. The fragment survives a redirect, so `#section`
  still lands.
- **Inside the app, nothing redirects.** The decoder reads both hosts as the
  same mention, so an old link in a plan opens the plan with no network
  round-trip.

Size: one small PR for the constants and the decoder (plus its test), one
for `vercel.json`, and an afternoon of console work. The account work, not
the code, is the long pole.

### 4.2 Rename the product

Everything in §4.1, plus:

| Surface | What's involved |
| --- | --- |
| App name | `apps/desktop/package.json` `productName`, so the `.app`, the DMG, the menu bar, and **the state directory and Keychain entry** (`bootstrap.ts` derives both from the app name through `resolveAppName`). Without a one-time migration of `~/Library/Application Support/Luke` and the Keychain item, every user is signed out and loses local state on update |
| Bundle id | `dev.reviewstage.luke` (`electron-builder-config.mjs:57`). **Leave it.** Changing a bundle id makes macOS treat the update as a different app: notarization, microphone permission, and Login Items all start over. Users never see it |
| Auto-update | The feed is `github.com/ReviewStage/luke/releases`. Renaming the repository redirects on GitHub, but the update manifest and asset names (`Luke.dmg`, `Luke-*.zip`) need one release that ships under both names |
| Code names | `@luke/*` (3,901 references) and `LUKE_*` env vars. **Leave them.** Internal names cost nothing to keep and a lot to churn |
| User-facing copy | ~1,200 capital-`Luke` strings in non-test TypeScript, plus the web pages, CHANGELOG, README, PRIVACY, and the "Open in Luke" page. Many are the *persona* ("Luke is writing…"), which stays if Luke stays the teammate |
| Brand | The L-face, the face-first wordmark, the icon, the DMG background, the OG card, and the motion table, all generated by `packages/brand/scripts/generate-brand-assets.mjs`. A new initial means a new face glyph (the mock page shows one per candidate), redone motion, and new screenshots |
| Voice persona | `packages/live/src/instructions.ts` ("You are Luke, a senior engineer…"), the coder's "You are Luke's coding agent", and the onboarding's "Hi! I'm Luke." **Only if the persona changes too** |
| GitHub App | Its name and slug (`github.com/apps/luke`) show on every PR the agent opens ("luke[bot]"). A rename changes the slug, so existing installs need checking |
| Elsewhere | The website, the scheme (keep `tryluke:` for old links), OAuth app names on the Google and GitHub consent screens, and the Stage/ReviewStage pages |

**Product rename, Luke stays the persona** (for example Hashout): the app
name, the domain, the brand mark, and the GitHub App change. The voice,
the face, onboarding, and the "Luke is…" copy stay. That's about a
week of work plus a new mark.

**Full rename** (persona too, for example Nell): all of the above, plus the
voice prompt, the onboarding, every persona string, and a new face.
That's two or more weeks, and it throws away the recognition "Luke" has so
far.

## 5. The .com pass

Checked 2026-10-15, the same way as above: Verisign RDAP, `dig`, then the
page, and for a listing, the marketplace's own page. Afternic showed its
buy-now prices; HugeDomains showed some and put others behind a captcha;
Atom and GoDaddy's for-sale pages refused automated reads. Nothing was
bought, no offer was made, and no seller was contacted. "Free" means the
registry has no record; the standard price is about $11 a year.

### 5.1 Luke on .com

| .com | Status | Price | Note |
| --- | --- | --- | --- |
| luke.com | Held since 1995 (Network Solutions), blank page | Not listed | |
| getluke.com | Held since 2007, a personal site (Luke Simpson) | Not listed | |
| **tryluke.com** | Held 2026-08-07 (Spaceship) | Not listed | **"Luke - LinkedIn growth done right"**, from "Luke AI" (founded 2025, $399–599/month, AI drafts plus human writers) |
| useluke.com | Held 2026-01-29, the same "Luke" LinkedIn service | Not listed | |
| withluke.com / meetluke.com | Held. A photographer, and a redirect to a personal site | Not listed | |
| heyluke.com / askluke.com / hiluke.com | Held since 2001, 2004, and 2007 | Not listed | askluke.com is "Ask Luke Challenge" |
| lukehq.com / lukeagent.com | Held 2024 and 2026, parked at Namecheap | No price shown | |
| lukeapp.com / lukecode.com / lukedev.com / lukelabs.com / lukeworks.com | Held since 2018, 2012, 2016, 2014, and 2002 | Not listed | |
| **lukeai.com** | Held, at Afternic | **$3,279** | Now also the name of the LinkedIn company ("Luke AI") |
| **callluke.com** | Held, at Afternic | **$4,111** | |
| talktoluke.com | Held. A UK therapist | Not listed | |
| lukeships.com / thelukeapp.com / lukestage.com / lukethebuilder.com | Held. A personal blog, 2026, Wix, and parked | Not listed | |
| askluke.ai / heyluke.ai | Held 2025 and 2026 | Not listed | |
| **lukeplans.com** | **Free** | ~$11/yr | `lukeplans.com/acme/plan/…` reads as a sentence |
| **lukebuild.com** | **Free** | ~$11/yr | The .com of luke.build |
| planwithluke.com, lukeplan.com, lukeplanner.com, lukeplanning.com, lukeship.com, lukevoice.com, lukeagents.com, lukeforteams.com, openluke.com, lukesays.com, saidluke.com, pingluke.com, stageluke.com, lukebystage.com | **Free** | ~$11/yr | |

The free Luke .coms are all compounds, and each one still leaves three
other "Luke" AI products beside it (getluke.app, Luke AI at tryluke.com,
and Luke Desktop).

### 5.2 The shortlist names on .com

| .com | Status | Price | Free variants |
| --- | --- | --- | --- |
| hashout.com | Held since 2004 (Network Solutions), no content, transfer-locked | Not listed | gethashout.com, usehashout.com, tryhashout.com, hashouthq.com, hashoutapp.com, hashoutai.com |
| hashitout.com | Held since 2011, at Afternic | No buy-now listing | hashitout.ai is "HashItOut", an AI mediator (2026) |
| **talkship.com** | **For sale**, HugeDomains | **$3,495** (or $145.63 a month for 24 months) | gettalkship.com, usetalkship.com, trytalkship.com, talkshiphq.com, talkshipapp.com |
| talkspec.com | Held 2026-09-10, parked at Hostinger | No price | |
| plansay.com | Held 2025-11-12, parked at Namecheap | No price | plansayapp.com |
| plait.com | Held since 2002, restaurant software | Not listed | getplait.com, useplait.com, and plaitapp.com are held too |
| nell.com | Held since 1995 | Not listed | heynell.com is "Nell" (2025); getnell.com and talktonell.com are held |
| ike.com / reed.com / penn.com | Held since 1998, 1995 (the recruiter), and 1995 | Not listed | |

### 5.3 Brainstorm for an available or affordable .com

Weighted toward non-person names, as Dean asked. The teammate stays Luke
whatever the product is called, so the product name only has to name the
product. 118 .coms were checked:

- **Unregistered, low conflict:** planspoke, shipaloud, spokespec,
  talktoship, saytoship, talkandship, specaloud, sayloft, saidplan,
  vocaplan, dictaplan, and planbyvoice (each with .dev and .app free too,
  where checked).
- **Listed under ~$5k:**
  - voiceship.com, **$1,795** at HugeDomains
  - saykit.com, $2,795 at HugeDomains
  - sayspec.com, $3,995 at Afternic
  - planvox.com, $4,988 at Afternic
  - callluke.com, $4,111 at Afternic
  - lukeai.com, $3,279 at Afternic
  - talkship.com, $3,495 at HugeDomains
- **Listed over $5k:**
  - talkcraft.com, $10,195
  - talkforge.com, $12,795
  - voicebuild.com, $7,500
  - saidanddone.com, $8,888
  - talkthru.com, $14,999
  - voicedraft.com, $14,995
  - saidso.com, $27,995
- **Listed with a hidden price:** shipspec, hashroom, sayspark, talkhash,
  and planlet at HugeDomains; voxly, saycraft, shipsmith, talklark,
  speakbuild, and spectalk at Atom or Squadhelp; sayva at Sedo; specora at
  Dynadot.
- **Taken by a product, or by a speculator in 2025–26:**
  - **tellship.com: "Tellship — describe it, we ship it"** (2026)
  - saytobuild.com and buildaloud.com (2026)
  - speakspec.com, spokenplan.com, speakship.com, talkwright.com, and
    talkfoundry.com (2026)
  - planlark.com ("Planlark", 2026)
  - planforge.com (project management)
  - groundplan.com (estimating)
  - talkbuild.com and saybuild.com (construction)

Conflict pass on the finalists (web, GitHub, App Store, Trademarkia; a
search, not clearance):

| Name | Conflict | What turned up |
| --- | --- | --- |
| VoiceShip | Low | Nothing uses it. VoyShip (a Cairo parcel startup) is near. No mark, no GitHub user, no app |
| Planspoke | Low | Nothing at all. Spoke (route planning) is the nearest |
| Shipaloud | Low | Nothing |
| Talktoship | Low | Nothing. "ShipTalk" is an AI/DevOps podcast |
| Spokespec | Low | Nothing |
| Saytoship | Low | Nothing. "SaySo - OS" is a small prompt tool |
| Planvox | Low–medium | No product, but github.com/planvox is a held (empty) org and VOX is crowded in class 9 (VOX by AudAi for AI vocal software, Vox Media) |
| SayKit | Medium | `saykit` on npm is a live i18n library for React (saykit.js.org). Conversant Labs' SayKit was an iOS voice SDK (2016, defunct). github.com/SayKit is held |
| **Sayspec** | **High** | **SaySpec (sayspec.app) is a macOS Electron app: narrate a QA walkthrough by voice, and the user's Claude Code or Codex writes the tests and opens a PR.** It started shipping in 2026-09. A second "sayspec" is a Playwright plain-language testing tool. Worth knowing as a competitor regardless |
| Hashout | High | See above |

### 5.4 The ten best .com options

| # | .com | Status | Price | Conflict | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | **talkship.com** | For sale (HugeDomains) | $3,495 | Low | A bare .com; the name holds the call and the PR; .dev, .app, .build, and .so free |
| 2 | **voiceship.com** | For sale (HugeDomains) | $1,795 | Low | The cheapest bare .com that fits; .dev and .app free; more literal than Talkship |
| 3 | **planspoke.com** | Unregistered | ~$11/yr | Low | Plan + spoken + *bespoke*; .com, .dev, and .app all free |
| 4 | lukeplans.com | Unregistered | ~$11/yr | High (the Luke namesakes) | Keeps the name; reads as a sentence in a link |
| 5 | lukebuild.com | Unregistered | ~$11/yr | High | The .com twin of luke.build |
| 6 | shipaloud.com | Unregistered | ~$11/yr | Low | Voice and ship; a little odd as a noun |
| 7 | spokespec.com | Unregistered | ~$11/yr | Low | "Spoken spec"; clear but descriptive |
| 8 | talktoship.com | Unregistered | ~$11/yr | Low | Reads as the tagline ("talk to ship") more than as a name |
| 9 | planvox.com | For sale (Afternic) | $4,988 | Low–medium | Short; "vox" is crowded and the GitHub org is held |
| 10 | saytoship.com | Unregistered | ~$11/yr | Low | Like talktoship, a tagline |

Out of the ten: saykit.com ($2,795, medium), sayspec.com ($3,995, high),
lukeai.com ($3,279) and callluke.com ($4,111) (Luke, high), and
hashout.com (held, not listed; high).

## 6. Recommendation

1. **Now: keep Luke, move to `luke.build`.** It's the only short, free,
   on-brand `luke.*`, its link reads well, and the move is small and
   reversible: tryluke.dev keeps serving APIs and redirects pages. Keep
   `tryluke://`. If ".build" feels too cute, `heyluke.app` is the
   fallback, in voice and free. If a .com home is wanted too, lukeplans.com
   is free (§5.1). If the rename in 2 is decided within weeks, skip this
   step and move links once, straight to the new name's domain: every move
   leaves one more host the decoder reads forever.
2. **Before a public launch: rename the product to Talkship, and keep Luke
   as the teammate inside it.** Three other "Luke" AI products now stand
   beside us: getluke.app (a Mac voice AI), Luke AI at tryluke.com, and
   Luke Desktop. A collision like that only grows, and renaming after
   launch costs much more than renaming before.
   - **The case for Talkship:** it has a bare .com at a visible $3,495, its
     .dev, .app, .build, and .so are free, nothing else uses the name, and
     it names both ends of the product.
   - **Luke stays as the teammate** ("Talk it through with Luke, ship it
     with Talkship"), which keeps the face, the voice, and "Hi! I'm Luke."
     This is the product-only rename in §4.2: about a week plus a new mark.
   - **Runners-up:** **VoiceShip** ($1,795, low conflict, more literal), or
     **Planspoke** if the .com must be unregistered (low conflict, all
     three TLDs free).
   - **Hashout is out:** two AI products already use the name (§5.2).
3. **Not recommended:** buying luke.ai, luke.team, lukeai.com, or
   callluke.com (money for a short link that doesn't solve the namesake), a
   fresh persona name (the AI wave has taken them), or changing the bundle
   id or `@luke/*` code names under any path.

Before acting on 2, do a real trademark clearance (counsel, or a USPTO
search by hand) for the chosen name in classes 9 and 42, and check the
registry price of the chosen domain at a registrar. Neither was possible
from here.

## Sources

Domain status comes from registry RDAP (`pubapi.registry.google/rdap` for
.dev, .app, and .new; Verisign for .com; the IANA bootstrap file for the
rest) and WHOIS, read 2026-10-15. Prices come from Porkbun's public pricing
API, [Afternic: luke.team](https://www.afternic.com/domain/luke.team),
[Afternic: lukeai.com](https://www.afternic.com/domain/lukeai.com), and
[HugeDomains: talkship.com](https://www.hugedomains.com/domain_profile.cfm?d=talkship.com).
Conflicts come from [getluke.app](https://www.getluke.app),
[Luke Desktop](https://github.com/DrJonBrock/luke-desktop),
[studio-ousia/luke](https://github.com/studio-ousia/luke),
[Trademarkia: luke](https://www.trademarkia.com/search/trademarks?q=luke),
[Trademarkia: hashout](https://www.trademarkia.com/search/trademarks?q=hashout),
[Trademarkia: talkship](https://www.trademarkia.com/search/trademarks?q=talkship),
[Trademarkia: NELL 79449038](https://www.trademarkia.com/nell-79449038),
[saydown.com](https://saydown.com),
[SayPlan on the App Store](https://apps.apple.com/us/app/sayplan/id6770088002),
[SayPlan (CoRL 2023)](https://proceedings.mlr.press/v229/rana23a.html),
[SpecTalk (ElevenLabs hackathon)](https://hacks.elevenlabs.io/submissions/cf5d5ce4-08be-426b-902a-9cd1da1b38c5),
[Nell agent](https://github.com/iabdulwasey/Nell),
[Trademarkia: IKE 6087123](https://www.trademarkia.com/ike-88595559),
[Trademarkia: REED AI](https://www.trademarkia.com/reed-ai-99116965),
[Penn AI Corp. marks](https://gleanmark.com/owner/pennaicorp),
[worktile/plait](https://github.com/worktile/plait), and
[planship.io](https://planship.io),
[HugeDomains: voiceship.com](https://www.hugedomains.com/domain_profile.cfm?d=voiceship.com),
[HugeDomains: saykit.com](https://www.hugedomains.com/domain_profile.cfm?d=saykit.com),
[Afternic: callluke.com](https://www.afternic.com/domain/callluke.com),
[Afternic: sayspec.com](https://www.afternic.com/domain/sayspec.com),
[Afternic: planvox.com](https://www.afternic.com/domain/planvox.com),
[tryluke.com (Luke AI)](https://www.tryluke.com),
[hashitout.ai](https://hashitout.ai),
[SaySpec](https://sayspec.app), and
[saykit on npm](https://saykit.js.org). The mock page with each shortlisted
name in a title bar, link, and icon tile is served through `conductor
preview` from a copy outside the repository.
