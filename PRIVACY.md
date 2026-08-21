# Privacy

Last updated: 20 August 2026

Luke watches coding-agent sessions on your Mac. This describes what stays on
your machine, what leaves it, and what you can turn off.

## What stays on your Mac

Luke reads the session files your coding agents already write, on disk, in
read-only mode. Titles, status, repository, branch, model, current tool, errors,
and the recap a provider wrote are held in memory to draw the panel. Message
history, file contents, and command output are not read during observation, and
nothing observed is written to disk.

Your settings, provider API keys, and calendar grants stay on your Mac. Keys and
grants are encrypted with Electron `safeStorage`, backed by the macOS login
Keychain, and never reach the app's window process.

## Your Luke account

Signing in with Google or GitHub gives Luke your name, email address, and which
provider you used. That is all the account holds, beyond the records needed to
keep you signed in and a daily count of voice and review usage.

## What leaves your Mac

- **OpenAI**, for voice and the attention review. A spoken turn sends its audio;
  a typed turn sends your words. Both also send bounded fields about your
  sessions: title, status, repository or branch, current tool, error, and recap.
  Never message history, file contents, or command output. Requests use
  `store: false`. Voice runs on your Luke account's allowance or on your own
  OpenAI key.
- **Coding agent providers you connect** (Conductor, Cursor, Devin, GitHub
  Copilot, Jules) and **Linear**, under a key or grant you supply. Luke reads
  your sessions or issues. It writes only when you ask for a specific act, such
  as sending a message or moving an issue, and only what that act carries.
- **Google Calendar**, if you connect it. Luke requests availability and your
  calendar list, and Google returns busy intervals only. Event titles and
  attendees are never accessible to Luke.
- **Luke's own service**, for your account, the usage allowance, product
  analytics, and anything you type into the feedback form.
- **GitHub**, for update checks. These are unauthenticated and carry nothing
  about you.

Connecting nothing means Luke sends nothing to any provider. Reading local
sessions requires no network at all.

## Usage data

Luke counts how his own features are used, and **this is on by default**. The
switch is **Share usage data**, on the front page of Luke's Settings tab.

The counts are event names and values from a list fixed in the build, forwarded
to PostHog through Luke's own service. Nothing you type or say, and nothing from
a session, can travel in one: no titles, branches, paths, recaps, prompts, or
error text. The desktop sends no identity; the service attaches your account
name and email to the analytics record.

The website, tryluke.dev, counts page views and sign-in steps through PostHog
directly, which means PostHog sees your network address there as it would for
any third-party script.

## Your choices

Turn off **Share usage data** to stop analytics. Disconnect any provider,
tracker, or calendar to stop its reads. Delete your OpenAI key to stop voice.
Luke never opens the microphone until you start a turn.

## Deleting your account

Delete your account from the Account section at the foot of Luke's Settings tab.
That erases your account record, sign-in records, and usage counts, and asks
PostHog to erase your analytics record. It does not touch your Google or GitHub
identity, and anything stored only on your Mac stays until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Calendar availability is used only to
hold Luke's spoken announcements while you are in a meeting. It is never
transferred, sold, or used for advertising, and no human reads it.

## Contact

Questions about this policy: **founders@stagereview.app**
