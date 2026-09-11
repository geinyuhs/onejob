# one job

## Credential masking isolation — 2026-09-10

The browser adapter retains keyed fingerprints instead of a plaintext credential
cache. Records are separated by browser connection, job and login origin. Only
the active job's records are used for text and image masking; checking its other
origins also catches reflected credentials after redirects. This never authorizes
credential use on another origin. Fingerprints survive transport recovery and
clear on shutdown. Matching stays local; neither fingerprints nor credential
values are passed to page scripts. JavaScript does not guarantee heap erasure.

## Release audit corrections — 2026-09-10

Continue becomes available again when a research run ends. Known credential
redactions survive browser transport recovery for the lifetime of the app.
For model-facing screenshots, matching occurs in the local Aside executor; raw
credentials are never sent into webpage JavaScript to find text to hide. Only
matching node positions enter the page. Fields and frames remain masked, with
styles restored after capture. Canvas/image secrets and arbitrary page changes
are still outside this text-based masking guarantee.

## Resuming saved research — 2026-09-10

Each research start compares the saved plan with existing findings. Incomplete
answers get a coverage continuation even without a new tool error; fresh evidence
allows further turns, duplicate reads do not. Old ambiguous app-generated browser
blocks receive job-local fresh-review annotations, including older records outside
the recent action list. The original records and research notes are preserved.
The agent receives the correction alongside its saved history. Current refusals,
user declines, uncertain writes and account-action limits are not cleared. No
annotation executes an action or bypasses review, and restarting never resumes work.

## Icon-only controls and research gaps — 2026-09-10

Icon-only controls use their child and ancestor context for independent navigation
review, even when the clickable wrapper has no label. Exact references and live
page checks remain. Unresolved targets and unavailable review report that nothing
was dispatched; they are not user declines. A blocked route prompts the agent to
continue independent unfinished research while new evidence arrives. Actual
refusals and uncertain actions cannot replay. Saved jobs stay paused on restart.

## Long-running research — 2026-09-10

Hermes owns model request and stalled-stream timeouts. The app watches the worker
connection separately: health pulses keep a quiet model call alive, but do not
claim research progress. Actual runtime activity is relayed without text or
provider payloads. Tool-approval waits do not consume the worker timeout. Stop,
job isolation, the existing durable action journal and explicit resume remain.
Hermes's native compaction now summarizes through the same pinned Astra client,
without auxiliary routing or fallback providers. Failed summaries preserve history.
Whole turns are no longer discarded at a fixed character limit. Exact source search
covers the whole job; saved documents have restart-safe readback. Large tool results
use lossless JSON paging. Review phases inherit thinking effort and provider liveness.
All ChatGPT phases pin Astra; execution uses the provider's default effort unless
the user selects one. Research supports independently checked view-only dropdowns,
hover, scrolling and search input. Unrelated page updates do not invalidate a verified
navigation target. Continuations follow new evidence, not a fixed one-retry allowance.

## Editable research plan — 2026-09-10

Click the problem summary or research text to edit it in place. Save edits keeps
the plan in review; Save & continue saves first, then starts research. Cancel
restores the saved text. Failed saves retain the draft without starting a run.
Saved sections preserve paragraph breaks and survive restart. Edits are job-local,
reject stale versions and running jobs, and retain the original plan's evidence
link so removed context cannot be restored by editing. Research-only tool limits
remain unchanged.

## Research-only workflow — 2026-09-10

The plan now covers context gathering only. Continue starts connected research
through Hermes: discover the relevant accounts/entities, understand their rules
and current state, and gather relevant schedules with sources and explicit gaps.
The app blocks account changes, messages, non-navigation controls, API/MCP
operations and scheduling in this phase, even with Auto on. Existing credential
fills retain their separate review and privacy checks.

Completed research shows **Scheduled actions** as an empty section. No scheduled
job, monitoring or action is created. Older plans/results are kept as history;
new turns follow the research-only boundary. This supersedes the earlier general
execution permissions below. The internal execute phase name is retained for
compatibility, not permission to change accounts.

### ai harness for hyper-focusing

A separate macOS prototype for working through one important problem by voice
or text. It reuses Intaglio Labs' actual orb markup, palette, animations, and
time-of-day colors. It does not install or change the original Intaglio app,
services, or context database.

## Run

Requires macOS 14+, Swift command-line tools, Node 22.13+ with `node:sqlite`,
and an installed official Codex CLI or Claude Code binary. Build from the repo:

```sh
npm ci --prefix ui/server/focus --ignore-scripts --no-audit --no-fund
bash widget/focus/build.sh /tmp/onejob-build/onejob.app
open /tmp/onejob-build/onejob.app
```

This is an ad-hoc signed development build, not a notarized release. Provide a
standalone Node executable using `ONEJOB_NODE=/path/to/node` when the default
Node is dynamically linked (for example, Homebrew). Keep build output outside
cloud-synced folders, whose Finder attributes can break code signing. A release
still needs notarization. Include Node's license alongside any bundled runtime.

## What works

- One active problem, an editable brief, and a persistent local SQLite store.
- A Desktop/onejob folder created automatically at launch. After a problem is
  described, its folder uses the problem title, with a number for duplicate names.
  Existing ID-named folders migrate without losing their files or index links.
  Empty folders for unnamed drafts are removed. A local deletion of a job's DB
  rows leaves its workspace ownership record for cleanup on the next refresh:
  files move into `deleted-job-folders` beside the local database for recovery.
  Archives keep their named folders; manually selected folders are never moved.
  Keep the ownership table during job resets; wiping the entire database also
  erases that record and requires separately moving the known job folders.
  Open the current folder from Context and drop
  notes there. No folder picker or connection setup is required. Existing
  selected folders remain available under Browse context. Changes refresh every
  30 seconds while the app is running,
  and immediately before search or Send.
- Hybrid retrieval: SQLite FTS5 ranked text search plus macOS NaturalLanguage
  sentence embeddings. The embedding helper is denied network access. If its
  English model is unavailable, search falls back to keywords locally.
- Changed or removed files retire old excerpts and derived memories. Replies
  that may repeat old evidence stay visible as history but are excluded from
  future model context. Continuing a plan whose source reply was retired clears
  that plan and its execution result and asks for fresh research before another
  AI call. Disconnect removes the folder index, never source files.
- Proposed memories with exact source quotes; Keep and Forget controls.
  A matching quote establishes provenance, not factual truth.
- On-device macOS speech recognition when supported for the current language.
  Tap the orb to start/stop; review the transcript before sending. No audio files
  are saved. macOS voices can read replies aloud. Text remains available.
- Explicit Send and Stop controls. Stale results cannot replace newer context.
- Archived problems remain on disk but are excluded from later retrieval.

## Account connection and privacy

### Hermes login

Auto mode never starts desktop 1Password authorization. The desktop SDK can show
its own unlock/authorization UI, so these credential operations are blocked in
Auto rather than silently turning Auto into an approval flow. Existing signed-in
Aside sessions remain usable without credential retrieval. With Auto off, the
origin-bound login tool retains app approval and 1Password authorization.

The approved migration targets Nous Research Hermes Agent `v2026.9.7` and
`gpt-6-astra`, using a fresh ChatGPT login. Continuing ChatGPT jobs now use Hermes. Setup, public research and independent
review deliberately use the existing Astra client. A fresh-login Astra request and a synthetic multi-step tool run
have been verified through the installed Hermes release. Account access must
still be verified independently on each installation.

`ui/server/focus/hermes-login.mjs` provides a developer-only login launcher for
an explicitly installed and independently verified Hermes binary. It does not
download or verify that binary, start inference, or switch the running app.
`startHermesLogin({binary, dataDirectory})` launches the upstream
`auth add openai-codex --type oauth` command in a new `hermes-chatgpt` directory
inside an existing private app data directory outside the repository. Finish
the device login in the browser; never paste credentials into chat.

The launcher strips ambient API credentials and Python injection variables.
A macOS sandbox blocks existing Codex, Claude, Hermes, and Keychain directories,
including configured credential-root overrides. Profile symlinks and permissive
directory modes are rejected. Hermes stores its own new session; onejob does not
parse or log tokens. This sandbox isolates login credentials only: it is not a
sandbox for autonomous agent execution. Native browser/account tools remain
unconnected to this preflight. There is no API billing or model fallback here.

Before switching engines, verify the complete pinned install, a successful
Astra request, onejob's tool approvals, job isolation, and Stop. Retain the
current clients until those checks pass. The login module's tests use synthetic
credentials and intentionally broken copies of its protections.

### Hermes job execution

Before an execution question reaches the user with Auto off, an isolated review
checks whether it is truly user-only. Requests for screenshots or account data
are sent back for retrieval unless the specific access handoff is supported by a
fresh page read and an exact quote. Failed clicks, old memory and the agent's own
claims are not access evidence. Changed pages invalidate earlier evidence. Review
is a model judgment with code-enforced source/quote checks, not a guarantee about
untrusted webpages. One rejected handoff gets another work turn; repeated unsupported
handoffs become blocked results rather than requests for the user to do research.
Older unchecked questions become paused jobs on restart, preserving notes and drafts.
They do not automatically resume. Auto mode remains question-free.

`HermesClient` in `ui/server/focus/hermes-client.mjs` is the continuing-job
engine selected by AgentEngine for ChatGPT execution and work. It embeds Hermes's `AIAgent` through
`hermes-worker.py`; Hermes runs the conversation and chooses successive tool
calls. The small stdio adapter does not implement another model/tool loop.
`ProblemService` hands each call to the existing checked `ToolRuntime`, preserving
exact approval, job ownership, source saving, transient screenshots and Stop.
Only the current job context is supplied. Each answer gets a separate worker,
but execution resumes the job's private Hermes profile: built-in `MEMORY.md` /
`USER.md`, a local SQLite transcript and an immediately flushed action journal.
`job_history` calls Hermes's native history search with cross-profile selection
blocked. The current prompt restores bounded recent complete turns and the last
part of the action journal; full transcripts remain searchable without an extra
summarization model. Sources, validated findings and deliverables also remain in
the existing onejob stores and job folder. Memory is not a replacement for source
evidence, and remembered approvals never authorize new actions.

Profiles live under `hermes-chatgpt/profiles/job-<opaque hash>`. The hash binds the
job ID and its context version. Forgetting or removing evidence changes that
version, so old memory cannot silently reappear. Old private profiles are retained
on disk, not erased; the new worker cannot read them. A process-held kernel lock
prevents concurrent writers and releases on a crash. Stop never replays an action;
later explicit work receives interrupted requests as unknown outcomes, with the
current app action records taking priority. Creating the client, reopening the app
or switching jobs does not start work. This is a resumable agent, not a scheduled
background job. Clarification and approval checks use the existing isolated
Astra client; they do not load the job's Hermes memory. No cross-job memory, plugins, native shell/browser tools,
background review or fallback provider is enabled. Native compaction uses Astra.

Continuation input uses native transcript rows as delivery receipts. Previously
delivered evidence and tool results are not repeated in the next app context;
new entries and semantic edits remain visible. Current plans, settings and tool
capabilities are supplied every time. Archived compaction rows are matched locally,
not loaded back into the model. No second memory database or history cutoff is
introduced; missing receipts cause evidence to be resent.
Older cumulative app messages are also deduplicated on replay against earlier
receipts, without rewriting the originals. This prevents an old oversized input
from crowding out fresh tool observations. Unique evidence and recovery notes stay.

The launch helper requires the clean pinned commit
`2237be355906fbe6065ce1815711eee52b2d646e` and its installed Python environment.
It checks source revision/working-tree state, not the integrity of every installed
dependency. A dedicated sandbox blocks unrelated home-file contents, other app
data, dotenv overrides and writes outside the private Hermes profile except the
fresh shared auth store's exact file, lock and atomic refresh temporary files.
Hermes owns OAuth refresh at the shared login root; credentials are never copied
between profiles. Filesystem
metadata remains readable for interpreter resolution. This is not a network-host
allowlist; Hermes still owns its provider transport. Secrets are not returned to
the app or model context.

Install the pinned release under the app data directory's `hermes-runtime`.
The main entry point selects Hermes for continuing ChatGPT jobs. The public.search
tool explicitly calls the existing Astra hosted-search client with only a topical
query. Setup/research/review use that client directly; there is no failure-triggered
switch between engines. Claude remains an explicitly selected alternative.

The fork is [onejob](https://github.com/geinyuhs/onejob). The upstream reference
is [PR #41](https://github.com/intaglio-labs/intagliolabs/pull/41).
This implementation follows its official-client process boundary, not its auth
file symlink. onejob never copies, links, parses, or logs provider account tokens.
No shared proxy, account pooling, credit purchase, quota bypass, or background
inference is implemented.

**ChatGPT:** an installed, unmodified Codex App Server performs its documented
managed browser login. Its separate `codex-profile` directory lives within this
app's data directory. Signing out here affects that profile, not normal Codex.
The client owns token storage and refresh. Requests use Codex plan allowances
and provider data settings. No fallback to an ambient API key occurs.
See [official integration docs](https://learn.chatgpt.com/docs/app-server) and
[authentication docs](https://learn.chatgpt.com/docs/auth).

**Claude Code:** the button opens Terminal for `claude auth login` in the
unmodified official client. Inference invokes that same installed client using
its native credentials. The app never implements Claude.ai OAuth or handles a
Claude session token. Claude Code's own sign-in and billing terms apply.
Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)
distinguishes offering Claude.ai login in third-party apps (not permitted) from
running unmodified Claude Code with end-user authentication under applicable
commercial terms. The latter is the implementation here. Distribution requires
the product owner to satisfy those terms; this prototype is not evidence of an
Anthropic partnership or approval. No authentication method in the binary is
modified or removed. The app's inference process strips ambient secret variables
to avoid silently charging a different API account; users can configure their
chosen account directly in the official client.

**What leaves:** on Send, the selected client receives the active problem brief,
recent conversation, and relevant notes, selected-folder excerpts, and tool results. The problem screen omits the sharing footer; this section documents
the data boundary. The provider controls its retention and training policies;
local storage and ephemeral client sessions do not promise zero cloud retention.
The app does not import the original Intaglio corpus or other conversations.
Mail, calendar and websites can be accessed through connections you configure
and the operation policy below. Existing personal browser tabs are not attached
automatically. It never searches the whole computer. There is no hosted memory
service, external embedding API, or analytics SDK in this target. Desktop files follow your existing macOS/iCloud sync settings. See `ops/EGRESS.json` for
the provider, browser, and configured-service networking boundaries.

**Local state:** `~/Library/Application Support/onejob/` holds the SQLite
store and the separate Codex profile. The directory is created with mode 0700;
the SQLite file is mode 0600. This is filesystem protection, not database
encryption. `ONEJOB_DATA` can select a separate directory for development; its automatic
workspace stays inside that directory rather than the real Desktop.
Forget excludes memory from future retrieval; archive keeps notes on disk.
Neither is a claim of erasure from provider systems or secure disk wiping.
Folder paths stay in the local database; excerpt titles include folder and file
names and may go to the selected provider with the relevant text.

## Tools and connections

onejob owns the work loop. Each model response either requests one catalog tool
or gives a final answer. It can search problem memory, save Markdown/text files,
call a configured JSON API or MCP server, and open/read/click/fill/press in fresh
Aside tabs. Actual results return to the selected frontier client. The live app loop
continues until a result, real input need, Stop, or failure; there is no twelve-step
permission prompt. Each tool keeps its own connection and cancellation checks. History and results stay in the local database;
saved files live under its `artifacts/` directory. Open them from Tools.

Both provider adapters disable customizations and native tools except public
search during research and explicitly started plan execution: Codex hosted live web search, or Claude Code WebSearch.
Claude search returns snippets, not full-page reads; WebFetch remains disabled.
Research uses no personal browser cookies and the app loop permits only local
memory search. Account tools remain unavailable until after the plan. Codex
uses an ephemeral thread and read-only sandbox. The shared onejob loop interprets
JSON tool requests and enforces reviews; this is not native provider function
calling. There is no background worker or arbitrary shell/JavaScript tool.

The default **Tools** screen detects Aside and local profile IDs. Enable one
profile to reuse websites already signed in there. The agent prefers browser
context over asking for a separate connector for each site. Chrome/Safari
sessions are not imported. onejob does not control the entire desktop. Users
complete normal password-manager autofill, unlock, login, and MFA prompts in Aside;
onejob never asks the model to retrieve those secrets. The browser permission is
remembered. Opening and reading task-related pages need no further review;
browser controls and API/MCP calls retain exact review.

Aside also appears beside ChatGPT and Claude on the first connection screen.
Its button opens the same browser setup form, with the existing profile/privacy
consent. Its checkmark reflects a saved connection, not just an installed app.
Aside is a browser connection, not a selectable reasoning provider; it does not
replace the AI connection or become a requirement for public research.
Both the first-screen tile and a task's Connections button open a small Aside
dialog, not the advanced working-notes drawer. Setup help is collapsed. Connect
stays disabled until a profile is available. The user grants browser access by
clicking Connect Aside. No analytics or sync checkbox is required. Connecting
shows a busy state and blocks duplicate requests. Not now leaves access unchanged.

**Advanced → direct connections** contains optional Notion and Linear sign-in
cards. onejob uses the official MCP SDK for dynamic client registration, PKCE,
a single-use state-bound loopback callback, and token refresh. Users authorize
the workspace/account in the service's own browser flow. There is no shared
OAuth broker. Metadata, token exchange, and registration stay on the preset's
origin; unexpected recipients and HTTP redirects are rejected. Tokens, refresh
tokens and client registration details live in non-synchronizing macOS Keychain
items scoped to this onejob install. If Keychain is unavailable, there is no
plaintext fallback. Each refresh is shared across concurrent requests to avoid
rotating the same token twice. Expired authorization prompts a reconnect; a tool
operation is never automatically replayed after an authentication error.

Disconnect deletes this app's local credential and connection. It does not revoke
the service-side grant; users can revoke that in the service's account settings.
Reconnecting replaces the local connection after successful authorization. These
flows were tested with the real SDK against synthetic OAuth responses and local
callbacks, not by granting access to a real personal workspace.

Inside **Advanced → Custom API or MCP**:

Action approvals appear inline in the main app, with a short question, destination,
Yes / No. No reveals a required two-line directions field. By user request, the
full JSON request and nearby page snapshot are visible again; the abbreviated
selected-item card did not provide enough context. Details are rendered as inert
text, including exact outgoing text/data. There is no Details dropdown or repeated
results-sharing reminder. Page opens and reads run directly under the connected
profile's access grant. Auto mode is unchanged by this presentation change.
Progress names the current task, actual tool destination, or available public-search
query. It is driven by real events, not a timer or simulated progress.
Waiting questions show only the question and answer controls, not the supporting
reply or a Connections shortcut. Confirmation questions use Yes / No with directions
under No; information questions keep free text. A Yes answer to a question resumes
reasoning but never substitutes for an external action's exact approval.

- **Aside:** install its CLI through Developer settings and open the desired profile.
  The main setup detects profile IDs; a choice is needed only when several exist.
  Clicking Connect Aside grants browser access; no settings checkbox is required. onejob uses
  a newly connected browser to resume a paused, accepted plan automatically,
  including an older waiting job when reopened. It records which connections
  were available for each answer; unchanged connections do not trigger retries.
  Failed or interrupted runs still require resume. onejob uses
  browser controls through `aside mcp`, not an Aside AI conversation. Aside and
  visited sites still control their own traffic, cookies, subresources, redirects,
  and retention. onejob does not change or verify Aside’s analytics or sync settings. Normal
  browser login works. Website-login connections now bind username/password
  references to an exact HTTPS origin; browser.login fills a verified field without
  exposing the value to the model or submitting the form.
- **API:** provide an HTTPS base URL. JSON requests stay on that origin, and
  redirects are rejected. Optional authentication is a bearer token supplied by
  1Password. This does not implement every API's authentication scheme.
- **MCP:** provide a Streamable HTTP endpoint hosted by the service itself or by
  you. HTTPS is required except loopback HTTP. Discovery and calls both require
  review. Only tools discovered in this app session can be called. The server's
  operator receives requests and may forward them elsewhere; a first-party or
  self-controlled server is a trust choice, not something onejob can verify.

For custom bearer-token API/MCP connections, enable SDK integration in 1Password's
Developer settings. Enter the account name and an `op://vault/item/field`
reference, never the credential itself. The official SDK requests desktop
approval and resolves just that reference when an approved operation runs.
onejob injects it as a bearer header. The configured reference and account stay
out of the model catalog; raw credentials are not persisted by onejob. Known
credential values and common secret fields are redacted from API/MCP results.
This is not a guarantee of detecting every secret an arbitrary service returns.

Browser open/read operations run without another permission question. Verified
routine navigation also proceeds with Auto mode off after an isolated check by
the selected AI. Opening a settings panel is navigation, not saving settings.
Exact link/tab/button/menuitem/generic targets reach review regardless of their
wording. There is no label keyword veto; candidates are never permission by themselves.
the reviewer has no tools or search. Malformed/failed/uncertain checks require
manual review with Auto off and become blocked steps with Auto on. Research blocks non-navigation decisions in either mode. The reviewer receives the current task title, the complete scrubbed saved snapshot, and focused target context
through the existing selected provider. Setting, job and page are rechecked before
dispatch, including a live snapshot check. Enabling Auto mode can release an
eligible pending navigation or close an ineligible step as blocked; changing the toggle invalidates an in-flight check.
With Auto off, sending and editing still require review. With Auto on, independently
checked, explicitly scoped reversible browser steps and low-impact messages can
proceed without questions. Security, irreversible or financial actions and all API/MCP operations
that lack approval are recorded as blocked in Auto mode, without a dialog. The agent
continues independent work and reports partial results. A needs-input answer gets
a continuation to use safe defaults or report a blocker. Further continuations
require new observations; duplicate reads do not count. Blocked steps stay recorded,
but an alternative read-only route can satisfy the research plan without them.
With Auto off, the existing manual reviews remain. The
classifier is a heuristic, not a guarantee against misleading webpage content.
Approve deliberately:
onejob does not prove what a remote API, MCP tool, or webpage will do. Stop cannot
undo an already dispatched operation. Failed or interrupted writes are marked
uncertain, and an identical declined/uncertain request cannot automatically retry
within that run. Blocked requests cannot be replayed either. Inspect the service before trying again. Failed page reads can
retry without approval. The model must request tools directly, not ask permission
to request permission, and reuse successful results. Navigation must not submit
changes or transfer private data; this is model policy, not a guarantee that an
arbitrary website has no GET side effects. No model-supplied read-only label can
exempt a browser control or an API/MCP operation from review.

Reads follow the current task tab after navigation. A failed open/read reconnects
and opens its last known URL once. Recovery never repeats a click, fill, or key
press. Stop or a changed job prevents another recovery attempt. If reconnection
also fails, work pauses with an app error instead of asking the user to open the
browser or check their login. Login/MFA questions must be grounded in a successfully
read page showing that requirement, not inferred from a tool failure. Recovery
uses a fresh task tab; other task page handles from the old connection expire.

No Docker, Nango, Composio, or hosted memory broker is required. Dependencies are
the official MCP SDK (protocol/transport support) and 1Password SDK (desktop
credential authorization). Automatic OAuth setup is currently limited to the Notion and Linear presets.
Other service-specific OAuth flows, non-bearer custom authentication, and
persistent task-tab handles across app restarts are not implemented.

Free scrolling uses fixed Aside viewport/container functions, needs no approval,
and returns a fresh snapshot. Callers supply direction and distance, never code.
Document saves and API/MCP responses no longer fail at the former character caps;
large results are stored with job-owned lossless paging. Native transport/model
limits and cancellation still apply.

If Hermes finishes with prose instead of the app JSON envelope, the answer is
retained. A separate tool-free Astra pass extracts status/question using Codex's
native outputSchema, with the selected effort and search disabled. It cannot
continue research, execute actions, or invent a question. If formatting is
unavailable, completion stays unconfirmed; the original answer is not discarded.

## Limits

Folder import reuses the existing local file reader. It supports Markdown,
plain text, TeX, CSV, and TSV; skips hidden/known credential paths, links, binary
files, and cloud placeholders; and does not trigger cloud downloads. It reads
files up to 256 KiB, retains at most 20,000 characters per file, and splits them
into 5,000-character excerpts. A scan exceeding 200 visited files blocks search
and Send until some files are moved out of that folder.

Meaning search currently uses English and the first 2,000 characters of each
excerpt. It ranks all eligible entries for the current job in bounded batches,
then merges by native semantic distance. Retrieval quality is not
benchmarked. Other languages retain keyword search. No mail/calendar connectors,
cross-problem search, unattended scheduling, or true
realtime speech-to-speech is implemented. A memory's proposed/kept status stays
visible to the model. Model errors remain errors; there is no pretend AI demo.
The first problem submission is saved locally and starts the brief; subsequent
messages are explicitly sent to the chosen provider.

## Verify

```sh
node --test 'ui/test/focus-*.test.mjs'
node --test --test-timeout=120000 'connectors/test/*.test.mjs' 'ui/test/*.test.mjs' 'connect/test/*.test.mjs' 'widget/test/*.test.mjs'
```

Tests use synthetic data and fake clients only for hermetic behavior tests.
Network tests use synthetic loopback listeners, including real MCP protocol
discovery and execution. The embedding test deliberately
removes the helper sandbox to prove its negative control works. Mutation tests
break protections in temporary copies and require the relevant
negative tests to fail. No credentials or personal problem content belongs in
this public repository.

### Focused onboarding and desktop jobs (0.4)

Create a job from the onejob menu-bar dropdown or File → New onejob. A native
New onejob service is also registered for macOS Services menus (including Finder;
macOS may require enabling the service in Keyboard settings). Each unarchived job
has a dedicated left-edge orb; overflow forms another column. Closing the main
window leaves these available. Quit from the menu to exit.

The shared action prompt explicitly requires approval for every 1Password
credential use, irreversible action, and external message or submission when
Auto mode is off. Page reads and public searches are not external contact in
this rule. The runtime allows verified routine navigation in either mode and
retains its stricter review of consequential or unclear browser interactions and
API/MCP requests. Credential-backed approvals name 1Password before retrieving
the credential; the same review covers the exact request, without a second
permission question. Auto mode permits clearly scoped reversible browser work.
Actions needing approval or interactive 1Password access become blocked steps,
without a dialog. It does not grant new task scope or bypass the password
manager's own authorization. Already signed-in browser sessions still work.

Onboarding shows connect, problem, prior attempts, clarifying questions, research, and plan in the existing window.
The problem's Continue button saves the draft and asks “What have you tried so far?”
This second intake step is optional. Continue accepts a blank answer, and Back
preserves both drafts. Prior attempts are saved in the job's editable brief and
included in research context. The third intake step asks only what is missing, before any research.
Astra (`gpt-6-astra`, with the selected Codex thinking mode) receives only the problem and prior attempts
through the app's existing ChatGPT connection. It generates one batch of zero to
three questions, shown one at a time with optional choices. The setup prompt
assumes ongoing help unless the user explicitly asks otherwise. Setup records
helpMode and a quoted explicit scope in job_settings; later phases consume those
settings without asking again. These settings never cross job boundaries. Existing
jobs without settings keep their original conversation; saved answers are not rewritten. The default does
not create schedules, enable notifications, or authorize external changes.
Clicking a choice toggles it. Multiple choices can be selected, and every question
has a blank custom-answer field that also supports speaking. Continue saves the
selected choices and custom text together. Both persist as drafts per question.
The question count shares the top-left row with Back. The composer offers the
microphone and Continue; Not sure and Pick for me have been removed.
Recommended choices are labeled when the model supplies a valid recommendation;
older saved questions need not have one. Previously AI-picked answers remain
saved as assumptions with a reason, not user statements, and the plan must
distinguish those assumptions.
Questions, answers,
and unfinished answer drafts persist per job. Returning to unchanged intake reuses
the same batch; changing the intake replaces the batch. Research includes the
answers and preserves unknown answers (including skips in older saved jobs). It
cannot start through either the research or chat route until questions are completed.
The final submitted answer, or a zero-question intake,
automatically enters public-web research without browser setup. The selected AI
provider handles web queries and results under its policies. The prompt asks for
short topical searches without private details; this is not a redaction guarantee.
If search is unavailable, the plan must explain the missing evidence. Optional
signed-in browser access stays in Tools with consent and the operation policy above.
The research screen shows one short status line driven by actual context,
model-call, tool-execution and approval events. It does not rotate made-up
progress. Stopped, failed or restored runs wait for Resume research; opening or
switching a job never starts another research call by itself.

Continue on the plan starts an execution run through the selected provider
and the existing reviewed tool loop. Live status becomes the header; the final
screen shows the result, not the previous chat. A missing input becomes one
specific question with a text/voice answer, or Yes / No for confirmations.
The model must explicitly distinguish completed work from work needing input.
Results are saved per job. Stopped, failed and interrupted runs require an explicit
continue. Prior action history is included on resume; uncertain writes must not
be retried automatically. Browser open/read failures can retry directly.
Opening a legacy job with an already-accepted plan starts its pending execution
without another Continue screen. Unapproved plans, completed work, missing-input
questions and interrupted runs do not auto-start.

Live run events stay visible as a short status line, including inside permission
prompts. Background folder refresh notices do not replace an active step.
Permissions offer Yes, No, or written directions. Yes approves the exact pending
action; Auto mode can also release a checked routine navigation. Written directions decline that action and enter this job's
conversation so the next model step can adapt; any new write needs a new review.
The destination stays visible; actions that send or change data show the exact
request inline. There is no Details dropdown.

The question step does not silently switch providers or substitute a smaller
model. Claude-selected users can choose ChatGPT in the app settings;
The thinking-mode selector reads Astra's supported choices from Codex model/list
and sends a selected effort to turn/start. Codex default omits the effort override;
an explicit mode also pins Astra during research/work. Unsupported modes fail rather
than silently falling back. Claude keeps its own client settings. All reasoning
prompts share the plain-language rules in `ai-policy.mjs`. Transcription remains
verbatim. The Codex integration uses a named, network-disabled permissions profile
that reads only its empty workspace and the platform's minimal runtime paths;
all native tools except hosted web search during research and plan execution remain disabled.
This protocol was checked with Codex CLI
0.153.1. Older clients may need an update; the app does not loosen permissions to
make an older connection work.
Notes and advanced connections remain in a drawer. Plans and drafts persist per
job; selected jobs are independent of parked jobs and archives. Interrupted
research returns to the saved draft after restart and does not restart itself.

Optional cloud dictation uses OpenAI’s current recommended `gpt-transcribe` model.
An OpenAI API key can be imported through a native file picker from a regular,
owned 0600 file into this app’s existing Keychain namespace. API billing is separate
from ChatGPT/Codex sign-in. The app never reads their credentials for transcription.
Audio is recorded to a private temporary m4a file, read after Finish, deleted locally,
and sent directly to OpenAI without the job’s other context. Capture is capped at
20 minutes; the API request accepts at most 25 MB and the UI accepts 16,000 text
characters. An interrupted process can leave a temporary recording in the app’s
recordings directory. A failed transcription currently requires recording again.
Without a dictation key, the prior macOS on-device recognizer is used (including
its 60-second capture limit). These are transcription tools, not local reasoning
models. OpenAI provider documentation: https://developers.openai.com/api/docs/guides/speech-to-text

Cloud dictation is implemented but requires live API credentials for an actual
accuracy/billing test; automated tests use synthetic audio and mocked responses.

### Account detection (0.5)

The model screen reads ChatGPT and Claude Code sign-in status independently through
their official clients. It checks on opening, after a sign-in notification, when the
app regains focus, and every 2.5 seconds while this step remains open. Concurrent
checks share a request. This checks account status only; it does not run inference
or inspect credential files. Only readiness flags reach the UI.

Connected logos show a checkmark. Clicking an unconnected logo opens that client's
existing sign-in flow; the other account remains connected. Clicking a connected
logo selects it. Once either account is ready, Continue rechecks status and advances
with the selected connected account (or the available one). Sign-in completion does
not automatically advance, so both accounts can be added on the same screen.
## Browser approval preview

Browser approval screens include a fresh screenshot above the full action details.
The image shows only the current task tab's viewport. It clears after review.
onejob keeps approval images out of saved history and AI requests; Aside retains its
own session-handling policies. If capture fails, action details remain available.
Separately, browser.view sends a masked task-tab viewport directly to Astra through
Hermes's native image input. Form fields, embedded frames and known credential text
are hidden temporarily and restored afterward. This is not a detector for arbitrary
secrets drawn in images or canvas. Pixels are not app sources or action-log content;
Hermes may retain them in the private job transcript. No unrestricted browser code
or coordinate clicking is exposed.

## Instructions, workflow, and safeguards

- Agent instructions: shared communication/evidence rules; separate setup, research,
  and execution instructions. Only setup owns ongoing-help defaults and the
  zero-to-three-question limit. Later phases read the saved job settings.
- Workflow: Onboarding and ProblemService own setup → research → plan → execution.
  Continue accepts the plan. An agent returns its result; it does not invent a
  second plan-permission question. Paused work stays paused after restart.
- Code safeguards: job-scoped storage/retrieval, exact-action reviews before
  credential resolution/dispatch, current-job and page checks, declined/uncertain
  write handling, and Stop remain in the store and executor. Prompts explain the
  tool contract; they are not the enforcement mechanism.

Codex reasoning effort controls thinking depth, not a time or spending budget.
The live Codex client now uses a three-minute *inactivity* timeout, refreshed by
same-thread events, rather than a three-minute total response deadline. RPC and
individual tool timeouts remain separate. Active work can use more allowance;
there is no fixed model-call or spending cap in this loop. Hermes likewise uses
its native iteration default and the selected thinking effort, with an inactivity
timer refreshed by progress; approval waits do not time out the model. Claude keeps
its existing client limits.

Authentication instructions prefer configured 1Password credentials and existing
sessions. In Tools, add a Website login with its exact HTTPS origin, 1Password
account, and username/password references. browser.login validates the live input
and form origin before retrieval and before fill. The value travels through a
private temporary file read by Aside, never model arguments, and is removed even
on failure. Fill returns only completion metadata; later snapshots scrub known
values. Aside and the website still control their own storage/logging. User-only unlock, passkey, CAPTCHA, and unsupported
MFA challenges may still require a specific handoff. No secret enters chat.
