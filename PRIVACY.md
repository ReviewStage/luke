# Privacy

Last updated: 4 November 2026

Vespin is an inbox for all your coding agents, made up of a Mac app, a web
app at vespin.dev, and the hosted service behind them. This policy explains
what we collect, how we use it, who we share it with, and how to turn it off.

## In short

- **What Vespin stores.** On your Mac: the window's layout, messages you
  have not sent yet, and an encrypted copy of your workspaces' lists. On our
  service: your account, your workspaces, your tasks and their plans, and your
  agents' transcripts. Transcripts and plans are stored as written, not
  end-to-end encrypted, and our operators can read them.
- **Where agents run.** Agents run in sandboxes on our service, not on your
  Mac. If you choose to run an agent on This Mac or on a host of your own, it
  runs directly on that machine with full access to whatever that account can
  reach.
- **Models run on your keys.** Agents use Anthropic or OpenAI, and dictation
  uses OpenAI, always on the API key or subscription you saved, never ours.
- **Who else gets data.** GitHub for your repositories. Vercel runs our
  service and the sandboxes, and Neon hosts our database. PostHog gets usage
  counts and screen recordings with every word masked. Sentry gets crash,
  error, and performance reports. Any integration you connect gets what your
  agents send it.
- **Commands on your Mac.** If you allow it, agents can run shell commands on
  your Mac, and what those commands print leaves your Mac unredacted.
- **Off switches.** Turn off "Share usage data", set "Let agents run commands
  on this Mac" to Never, disconnect any integration, or delete your account.
  See [Your choices](#your-choices).
- **We do not sell your information or use it for advertising.**

## What we collect

**Your account.** When you sign in with Google or GitHub, we receive your
name, email address, profile picture address, and which provider you used.
We also keep the records that keep you signed in (each with the network
address and the browser or app it came from) and a daily count of your
dictation use. Signing in with GitHub, or linking GitHub later, authorizes
the Vespin GitHub App. Its token reaches only repositories where the App is
installed and that you can already see. We keep that token encrypted on our
service and never send it to your Mac or a browser.

**Workspaces.** Every account gets a first workspace, and you can create or
join others. Members of a workspace see each other's names, email addresses,
and roles. Workspace owners and admins can invite people by email (we keep
the address, role, and inviter), upload a workspace photo, and connect a
GitHub App installation, whose GitHub ids, login, and status we keep. A
workspace you own stays when you delete your account; only your membership is
removed.

**Tasks, plans, and comments.** A task belongs to a workspace, and every
member of that workspace can read, change, and delete it, and message, rename,
and stop its agents. We store the task's name, its plan (a Markdown document
written by you, other members, and agents), the plan's full revision history
with who wrote each revision, comments on the plan, and pictures or short
videos added to it. Deleting a task deletes it at once with its history,
pages, inbox items, and pictures; its agents' transcripts are removed seven
days later. Comments and plan text you wrote on a task that stays are kept
after you delete your account, without your name.

**Conversations with agents.** For each turn an agent runs, we store your
message, the agent's reply, its reasoning summaries, each tool call with its
input and output, the model and effort used, token counts, and timing. This
includes anything a tool returned, such as a file from your repository, a
command's output, a web page, or an integration's answer. Files and images
you attach to a message are stored with the transcript. Pictures and short
videos an agent shows you, or takes of its browser, are stored alongside it.
Transcripts are stored as written and our operators can read them. They are
kept until you delete the task (then removed after seven days) or your
account (removed at once).

**Inbox items and pages.** When an agent needs a decision or asks you to do
something, it posts an inbox item with a title, context, links, and any
pictures it took. Your answer and any messages or files you add are stored
with the item under your name, visible to every member of the workspace.
Agents can also make pages (self-contained HTML documents, such as charts or
mockups). Pages are stored with the task, open only inside Vespin to people
who can open the task, and run sealed off from the rest of the app; the only
outside address they may load from is cdnjs.cloudflare.com, which sees your
network address.

**Workspace memory.** If the Memory experiment is on, agents may save short
facts about how your team works so later agents can recall them. Memories
belong to the workspace, are visible to every member in Settings › Memory with
the name of the member they came from, and can be forgotten there. Agents
refuse to save anything that looks like a key, token, or password.

**Where agents run.** By default each agent runs in its own Vercel Sandbox,
an isolated machine on Vercel's infrastructure, with the task's repository
checked out. The checkout, the agent's session files, and its browser profile
stay on the sandbox's disk between turns and in a snapshot Vercel keeps for
up to thirty days after its last use. They are deleted when the agent's
transcript is removed or you delete your account. The GitHub tokens, model
tokens, and API keys an agent uses never enter the sandbox: they are added at
the sandbox's network firewall, and we keep the firewall's entries encrypted
only while the sandbox runs.

**Agents on your own machines.** If you turn on Bring your own host, an agent
can run on This Mac or on a Linux machine or Mac you add as a host. It runs
directly on that machine, as your user (or the user the host program runs as),
with full access to everything that account can reach, including your files
and network. Its model token or key, and a short-lived GitHub token, are
readable by any command it runs. Its work stays on that machine and is not
copied to us, though its transcript is stored like any other. To tell your
machines apart, each sends us a keyed hash of its hardware or machine id (never
the id itself) and, for a Mac, its model name. Pairing a host with a code
briefly records the name, system, and network address it gives, so you can
check it before approving.

**Commands agents run on your Mac.** While Vespin is open and signed in, and
Settings › This Mac › "Let agents run commands on this Mac" is not Never,
agents can run shell commands on your Mac. The default is to ask you each
time; you can also choose Always allow or Never. A command runs in your login
shell, from your home folder, as your macOS user, so it can reach everything
you can. The command, its exit code, and up to 20,000 characters each of its
output and errors are returned to the agent, stored in its transcript, shown
on every Mac signed in as you, and sent to the agent's model provider.
**Nothing is redacted**: if a command prints a password, token, key, or file
contents, that goes too. Commands and their answers wait in our database only
until the agent has read them.

**Credentials you give us.** If you save an Anthropic or OpenAI API key, a
GitHub personal access token, or sign in with your ChatGPT plan, your Mac sends
it to our service once over HTTPS. We store it encrypted with AES-256-GCM
under a per-credential key that is itself encrypted with a server-only secret
held outside the database, so a copy of the database alone cannot read it. We
keep a short hint (such as `sk-ant-…abcd`) and whether the provider accepts it.
We never send a saved credential back to your Mac, log it, or include it in
analytics, crash reports, or screen recordings. Removing it in Settings, or
deleting your account, deletes it.

**Your repositories.** Our service reads from GitHub, through your workspace's
GitHub App installation, what the app needs to show you: files you open,
skills in the repository, pull requests (description, comments, reviews,
checks, and changed files), and linked issues. We do not keep copies of these,
except that we keep a pull request's number, title, state, and checks with the
agent that opened it. GitHub notifies us when an agent's pull request is
reviewed, commented on, or fails a check, and we pass the review or comment
to the agent as a message. If you press Generate chapters on a pull request,
its title, description, commit messages, and patches are sent to a model on
your own key, and the resulting chapters are stored with the workspace.

**Integrations.** You can connect Linear, Notion, Sentry, Slack, Gmail, Google
Calendar, Google Drive, Granola, Mercury, Neon, PostHog, Stripe, Supabase,
Vercel, Y Combinator, and Executor, where they are offered to you. Each is
signed in through Vercel Connect, which stores the service's token for your
account, encrypted. Our service fetches the token only when an agent uses the
integration and sends it only to that service. We keep the connection's state
and a display name for the account. While connected, your agents can read and
change whatever your grant at that service allows, without asking you first.
Everything the service answers, which can include other people's messages or a
credential the service hands out, goes to the agent's model and is stored in
its transcript. If you signed in with GitHub, agents can use GitHub the same
way through GitHub's MCP server. You can switch an integration off for one
agent, or disconnect it for all of them. Disconnecting asks Vercel Connect to
revoke the grant; what agents already did at that service stays there.

**Vespin's Slack bot.** A workspace owner or admin can connect Vespin's Slack
bot so Vespin can message members in Slack. To find you there, we use your
connected Slack account or send Slack your email address, and keep your Slack
user id. Messages the bot sends you, and the final message of an agent you
started from Slack, go to Slack and are kept under Slack's policy. When you
mention @Vespin or message the bot, your message and the earlier messages in
that Slack thread (which others may have written) are handed to the agent.

**Apps you connect as MCP clients.** Apps such as Claude Code, Codex,
ChatGPT, or Cursor can connect to our MCP server and act as you once you allow
them on a consent page. We keep a record of the app, your consent, and hashed
access and refresh tokens. The app receives what our tools answer and keeps it
under its maker's policy. You can see and revoke connected apps in
Settings › Integrations.

**Browser tabs.** Agents can drive a Chromium browser in their sandbox, which
you can watch and take over. Each page's address, title, screenshot, and text
snapshot go to the model and are stored with the transcript. The browser's
cookies and logins, including any you type in, stay on the sandbox's disk and
in its snapshot. Agents can record the browser as a short video, stored like a
screenshot.

**Usage data.** The Mac app and the web app send counts of which features you
use, chosen from a fixed list of event names and values, under your account's
name and email. They never include anything you type or say, titles, branches,
file paths, prompts, or error text. Our service also counts work done through
it (such as tasks created, agents started, pull requests opened, and
integrations connected) in the same way. Counts are grouped by workspace, and
PostHog keeps each workspace's name and creation date. You can turn off the
app's counts with "Share usage data"; this does not stop the service's counts.

**Screen recordings.** While you are signed in, released builds of the Mac app
and the web app record the layout of Vespin's own window (never your screen or
other apps) and send it to PostHog. Before a recording leaves your device,
every word, label, and link address is replaced with blocks of the same
length. As a second safeguard, the parts that hold the most of your words are
left out entirely, including the feedback form, plan editing, File tabs,
pages, version history, Inbox items, agent and Terminal tabs, Browser tabs,
the API keys page, and hover previews. Canvas recording is off, and clicks are
not reported. Each recording is filed under your account's name and email so
we can find the recordings of someone who reports a problem, and carries the
app version, your operating system, browser, language, time zone, and screen
size. There is no switch for recordings; nothing is recorded before you sign
in, and deleting your account erases them and stops recording until you next
open Vespin or sign in.

**Crash, error, and performance reports.** The Mac app, the web app, and our
service send Sentry reports of crashes and errors, the errors Vespin shows
you, and performance traces for a sample of launches and page loads. They use
Sentry's default data collection, so reports can include error messages,
stack traces, request addresses and headers, device details, and your network
address. Sentry replaces values whose names look like credentials, and Vespin
removes query parameter values and token-shaped parts of addresses. Reports
name your account by its id only. Our service does not send Sentry what was
sent to or returned by a model, though an error's own words can quote what an
agent was working on. Sentry gives us no way to erase one account's reports,
so they are kept until Sentry's retention ends, even after you delete your
account.

**Feedback.** If you send feedback, we receive your words, any screenshots you
attach, and, unless you untick it, your name and email. We read it by email,
and the words, name, and email are also recorded in PostHog and posted to our
team's Slack.

**On your Mac.** Vespin keeps its window layout (open and pinned tabs, which
Inbox items you have seen) and the drafts of messages you have not sent. While
you are signed in, it also keeps a copy of your workspaces' lists (tasks,
agents, sidebar sections, members, invitations, and automations) and changes
you made offline, in one file, `entities.sealed`, encrypted under a key in the
macOS Keychain and deleted when you sign out. Transcripts and pictures you open
are held in memory only, never on disk. None of this is sent anywhere except
the offline changes, which are sent to our service once it can be reached.

**Earlier versions.** Earlier versions of Vespin kept a local database and
workspace files on your Mac; this version removes the database on launch and
reads none of the rest. On 13 October 2026 we deleted what those versions
stored on our service, apart from their conversations, which are deleted with
your account.

## How we use it

We use what we collect to run Vespin: to sign you in, store your work, run
your agents, show your teammates what you share with them, and send the
emails and Slack messages you or your workspace asked for. We use usage
counts, screen recordings, and error reports to understand how Vespin is used
and to find and fix problems.

Our operators can read what our service stores, including transcripts and
plans. Vespin's maintainers also have an admin page showing each account's
name, email, sign-in method, activity counts, workspaces and their members,
agents' status and models, which providers and integrations are connected and
working, and usage at list prices. It never shows a task's title, plan,
prompt, message, pull request title, key, or an error's own words.

We do not sell your information or use it for advertising.

## Who we send it to

- **Anthropic and OpenAI**, to run your agents, web search, dictation, titles,
  and pull request chapters, always on your own key or subscription. Each call
  carries what the model needs, such as the plan, the conversation, attached
  files, and what the agent read. They keep requests under their own retention
  policies.
- **GitHub**, through the Vespin GitHub App, to check out repositories, push
  branches, and open pull requests. If you started the agent and linked
  GitHub, commits and pull requests are made as you; otherwise as the App. Your
  Mac also asks GitHub directly for updates and for avatars, so GitHub sees
  your network address.
- **Vercel**, which runs our service, the agents' sandboxes, and Vercel
  Connect, which holds your integration tokens.
- **Neon**, which hosts our database.
- **PostHog**, for usage counts, screen recordings, and feedback.
- **Sentry**, for crash, error, and performance reports.
- **Resend**, to email workspace invitations (the invited address, the
  workspace's name, the inviter's name, and the link) and to deliver feedback
  to us.
- **Slack**, for Vespin's Slack bot, if your workspace connects it, and for
  feedback posted to our team's channel.
- **skills.sh**, Vercel's skills directory, for security ratings when you add
  skills from a public repository. Only the repository and skill names are
  sent.
- **Integrations and MCP clients you connect**, which receive what your agents
  send them, or what our tools answer, and keep it under their own policies.
- **Google or GitHub**, asked directly by your device for your own profile
  picture.

## Our website

vespin.dev uses PostHog to count page views, clicks (by what was clicked and
where, never the words on it), and sign-in steps, and to record the pages,
except the sign-in pages. Recordings mask what you type into fields. Before
anything leaves your browser, the site removes sign-in codes, tokens, and
similar values from every address. It collects nothing else, regardless of our
PostHog project's settings: no errors, console output, network requests,
timings, heatmaps, surveys, chat widgets, or feature flags. When you finish
signing in, the site links your visits to your account's id, name, and email.

Your browser sends this data to a path on vespin.dev, which passes it on to
PostHog without the site's cookies. PostHog is handed your network address and
user agent; our project is set to discard IP addresses.

Vespin in a browser (vespin.dev/app) records and reports as the Mac app does,
under "Screen recordings" and "Crash, error, and performance reports" above.
It sends Sentry reports directly from your browser, so Sentry sees your
network address. Link previews of Vespin links in Slack, iMessage, and
elsewhere show only Vespin's name and logo.

## Storage

- **On your Mac:** your settings and sign-in tokens, encrypted under a key in
  the macOS Keychain, the window layout, unsent drafts, and the encrypted copy
  of your workspaces' lists while you are signed in.
- **In your browser:** Vespin in a browser keeps your settings in the site's
  storage and is signed in by the site's session cookie.
- **On our service:** your account, workspaces, tasks, plans, and transcripts
  in our database, hosted by Neon. Saved credentials are encrypted; other
  content is not.
- **In sandboxes:** agents' checkouts, session files, and browser profiles,
  in Vercel Sandboxes and snapshots kept up to thirty days after last use.
- **With processors:** usage counts and recordings at PostHog; crash, error,
  and performance reports at Sentry, under their retention.

Deleted tasks' transcripts are removed seven days after deletion. Unless this
policy says otherwise, everything else we keep stays until you delete it, the
task or workspace it belongs to, or your account.

## Your choices

- **Usage data.** Turn off Settings › Account › "Share usage data" to stop the
  app sending usage counts. It is set per Mac and per browser, is on by default
  in the Vespin you download, and is off in a build you make from source. It
  does not stop the counts our service makes of work done through it.
- **Commands on your Mac.** Set Settings › This Mac › "Let agents run commands
  on this Mac" to Never. It is set per Mac; signing out also stops it.
- **Integrations.** Switch an integration off for one agent in its message
  box's MCP menu, or disconnect it in Settings › Integrations.
- **Microphone.** Vespin listens only while you are dictating into a message
  box, which shows a moving waveform while it records.
- **GitHub.** Revoke the Vespin GitHub App in GitHub's settings under
  Applications.
- **Delete your account** in Settings › Account. This erases at once your
  account and everything our service keeps under it: your tasks, plans,
  transcripts, inbox items, saved credentials, preferences, and integration
  records. Workspaces you own, and memories and comments you left in them,
  stay with the workspace without your name. We also ask PostHog to erase your
  usage data and recordings, ask Vercel Connect to revoke your integration
  grants, and delete your agents' sandboxes. If PostHog or Vercel Connect
  cannot be reached, your account is deleted anyway and what they hold stays
  until you remove it there. Reports already sent to Sentry stay until
  Sentry's retention ends. Deleting your account does not affect your Google,
  GitHub, or other connected accounts.

## Google user data

Vespin's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name, email address, and profile picture, only to
identify your account. What Gmail, Google Calendar, and Google Drive answer an
agent, where you connect them, is used only for the work you or your
automations ask that agent to do: it goes to the model that agent runs on and
into the agent's transcript, which is kept as every transcript is. Agents can
read and label mail and write drafts but never send mail. None of it is
transferred or sold, used for advertising, or used to train or improve any AI
or machine-learning model, ours or anyone's, and no person at Vespin reads it
unless you ask us to, for security, or where the law requires it.

## Contact

Email founders@stagereview.app with any questions about this policy.
