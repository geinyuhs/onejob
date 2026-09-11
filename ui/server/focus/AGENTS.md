## Incremental continuation context — 2026-09-10
Persistent Hermes workers use the job's native saved messages as delivery receipts.
New/changed evidence, recent entries, tool results and action rows enter the next
context; previously delivered copies do not. Compaction-archived rows are inspected
locally for matching only, never restored into model history. Current problem,
plan, settings, capabilities and continuation directions are always supplied.
Semantic source edits and new user-entry IDs remain visible. Missing receipts
resend evidence rather than drop it. Native history, memory and the recovery
journal remain saved; no new memory store, length cutoff or automatic resume.
On replay, older app-generated cumulative context messages are deduplicated only
against earlier native rows. Unique evidence, settings and recovery notes survive.
Original rows remain saved and searchable. The old wire-cache copy is omitted
only from changed replay messages, so it cannot silently resend the bulky input.
Native summary messages and tool observations are not rewritten.

## Credential masking isolation — 2026-09-10
Browser masking no longer retains a connection-wide plaintext secret set. The
approved login value is used for its origin-checked fill; retained masks are
keyed HMAC fingerprints grouped by browser connection, job and login origin.
Only the current job's records reach matching inside the app. All that job's origins are
checked to catch reflected values after redirects, never to authorize a fill.
Transport recovery preserves those fingerprints; shutdown clears them. Temporary
transfers remain private and removed in finally. Aside returns page text through
a private file for matching; only node positions go back. No fingerprint leaves
the app or enters page JavaScript. This is not secure heap erasure, a vault, or a detector
for secrets in canvas/images. It supersedes the plaintext redaction-set wording.

## Release audit corrections — 2026-09-10
Results Continue follows busy/voice state after a run; it must not remain disabled
until restart. Browser recovery preserves the current connection's in-memory
credential redaction set across transport replacement and clears it on shutdown.
Image masking matches known credentials against page text in the local Aside
executor. Only matching node positions enter page JavaScript, never credential
values. Existing field/frame masking and style restoration remain. This does not
promise detection of secrets drawn in images/canvas or arbitrary changing pages.

## Resumed research reconciliation — 2026-09-10
Research continuation now checks unfinished coverage even when this run had no
tool errors. It continues while new observations arrive and stops without false
completion when they do not. The same research agent owns this check; no new model
or independent execution loop is introduced. Formatting failures still cannot
restart execution. Every research start receives a plan-coverage instruction.
ToolRuntime annotates exact old generic research-gate browser blocks from the
active job as requiring fresh review. This scans beyond the recent action list.
Original audit rows, notes and Hermes memory remain untouched. The current system
instruction explains the correction so stale remembered restrictions do not act
as current authority. No current review refusal, user decline, uncertain write,
credential action, API block or other job is reconciled. These annotations are
not permission: fresh page evidence and the normal independent review still apply.
Nothing resumes during construction, launch or installation.

## Icon-only navigation and independent research — 2026-09-10
An exact reference with no label can reach navigation review. Supply the target's
children and ancestors as evidence; do not infer permission from an icon name.
The independent review and live-target check still precede dispatch. Missing
targets, unavailable/malformed review and changed evidence are not-performed
diagnostics, not user declines or proof of a forbidden change. An actual review
refusal stays blocked and cannot replay. A blocked research result now continues
independent unfinished work after phase/review blocks too, while new evidence
arrives. No-progress, Stop and uncertain-write boundaries still apply. No saved
job resumes on launch or installation.

## Capability follow-through — 2026-09-10
The user removed browser label keyword vetoes. Exact controls now reach independent
effect review with the complete scrubbed snapshot plus focused target context.
That model review is a heuristic, not a deterministic guarantee; research still
dispatches only navigation decisions. Credential binding, job isolation, live
target checks, Stop, and no replay of uncertain writes remain enforced by code.
browser.scroll can move the viewport or an element container in any direction.
Only fixed scrolling functions execute; callers cannot supply JavaScript. Scrolling
needs no approval and returns a fresh snapshot. Element-only scrolling still works.
Hermes final prose is preserved and gets a separate tool-free Astra metadata pass
using native outputSchema, the same effort, and no search. This never retries job
execution. Failed formatting retains the answer with unconfirmed completion, never
manufactures success. Native worker protocol failures still remain errors.
Local semantic retrieval considers all job entries in bounded ranking batches.
Document saves and API/MCP results no longer reject at the old character caps;
saved results use the existing job-owned lossless paging. Native provider and
transport limits still apply. Nothing automatically resumes a saved job.
This supersedes earlier keyword-filter and bounded-document descriptions below.

## Capability audit fixes — 2026-09-10
Hermes's native context compactor now owns history reduction; do not discard whole
turns at a character cutoff. Its summary adapter uses the same pinned Astra client,
never the generic auxiliary fallback router. Failed summaries preserve context.
All ChatGPT phases pin Astra and forward the selected effort; execution resolves
the default from Codex's model catalog. Review uses provider liveness, not a 20s cap.
Exact source search covers the whole job. Saved documents are indexed and readable
by job-owned artifact ID after restart; large tool results have lossless JSON paging.
Browser select/hover/scroll/fill/press can run during research only when independent
review verifies a view-only effect. Navigation checks preserve target, ancestors,
children and headings; unrelated feed changes no longer invalidate navigation.
Consequential actions retain full snapshot checks. Raw browser code stays disabled.
browser.view sends a masked task-tab viewport to the main Astra model via Hermes's
native image envelope. Inputs, embedded frames and known credential text are hidden;
arbitrary secrets drawn into canvas/images cannot be identified by this text-based
mask. Pixels stay out of app sources/action logs; Hermes may persist them in its
private job transcript. Approval screenshots remain separate and UI-only.
Recovery/handoff continuations can repeat while genuinely new observations arrive.
Duplicate reads/IDs do not count as progress. A blocked route stays recorded but
does not force failure after another route satisfies the research plan. Research
completion remains a model judgment of sourced coverage, not a guarantee.
No job resumes automatically. This update supersedes earlier descriptions below.

## Full Aside page reading — 2026-09-10
Keep Aside behind the existing app tools; unrestricted native MCP is not enabled.
Capture noninteractive page text too. Retrieve the full snapshot in bounded local
transport chunks, scrub known credentials before model paging, and expose stable
snapshotId/nextOffset cursors. A fresh read invalidates older cursors; continuations
remain job-owned and cancellable. Paged results must retain valid JSON in sources.
Navigation checks compare the full live snapshot with its native saved copy, not
only the currently visible chunk. View/open trade-detail links may reach the
independent navigation reviewer; accepting/submitting trades remains blocked in
research, including Auto. This is a navigation heuristic, not proof that an
arbitrary website has no side effects. No job resumes automatically.

## Long-running worker health — 2026-09-10
The host's three-minute timer now detects a missing worker connection, not a quiet
model. A worker health pulse carries no progress claim; changed Hermes activity
generations separately report runtime activity without descriptions or payloads.
Hermes retains its native provider request/stall limits. Pending tool approvals
suspend the host timer even when progress arrives. Stop still cancels the worker
and discards late tool results. Health threads stop when the conversation exits;
they never resume jobs or execute tools. The existing per-job transcript/action
journal remains the recovery checkpoint. Summary compression stays disabled:
upstream auxiliary fallback routing has not been restricted to the pinned model.

## Research-only plan and empty scheduled-actions step — 2026-09-10
By user request, plans describe research only. Continue runs connected context
gathering through the existing Hermes loop (the internal execute phase name is
retained for compatibility). ProblemService sets researchOnly for execute/work;
it filters the catalog and passes the boundary separately to ToolRuntime.
Research permits public search, memory, local documents, browser open/read,
independently verified navigation and the existing approved credential fill.
Account changes, non-navigation controls, API/MCP operations, messages and
scheduled actions cannot dispatch in this phase, including with Auto on.
The explicit later Scheduled actions step is not implemented. Completed research
stores an empty scheduledActions array and shows a blank section in results.
Older results remain historical; no migration claims their research is complete.
New research must inventory the relevant entities, rules, current state and
schedules with sources and gaps. For fantasy football that includes every team,
each league's rules, full rosters/player context and the NFL season schedule.
This supersedes earlier plan execution/account-action permissions below, not
credential privacy, browser ownership, Stop or the no-replay rule.

## Browser action recovery — 2026-09-10
Browser failures now distinguish preflight (nothing dispatched), action (outcome
uncertain), and post-action snapshot (action finished). Failed click/fill/press
attempts inspect the current job-owned tab without repeating the action. Only
preflight failures may be selected and reviewed again; uncertain actions keep
their no-replay boundary. Known failure categories are returned and saved, never
raw browser exception text. Stop and job changes cancel inspection too.
After a recovered failure, an execution that would finish blocked gets one
continuation to use the refreshed view or another safe read-only route. This is
bounded; unresolved work stays incomplete. Incomplete results have an explicit
Continue button for the saved plan; completed results cannot replay through it.
No restart resumes a job automatically.
This supersedes treating every failed browser action as an uncertain write below.

## Evidence-backed execution handoffs — 2026-09-10
With Auto off, each execution needs_input result now passes an isolated inputReview
through the selected provider (pinned Astra for ChatGPT, no native tools/search or
Hermes job history). Genuine preferences can ask; data-gathering requests must
instead continue. An access handoff must cite an exact meaningful quote from this
run's successful browser open/read. Failed clicks and agent summaries are not proof.
Later page reads replace older evidence; browser changes invalidate it. Classification
is still a model judgment, not proof that arbitrary page content is truthful.
Rejected, malformed or unavailable review gets one continuation to use safe reads;
a repeated unverified handoff becomes a blocked result rather than a user question.
Stop, current-job checks, declines and external-action approvals still apply.
Older unchecked needs_input screens are moved to executionPaused on restart;
their result, draft and notes remain stored. Nothing auto-runs. A fresh Continue
uses the existing plan and checks before asking. Auto keeps its no-question path.

## No-question Auto mode — 2026-09-09
Auto mode never opens an app approval dialog. A step the existing authorization
checks cannot allow is recorded as blocked, not declined or completed, and returned
to the agent so independent work can continue. Blocked attempts cannot be replayed
within that run. Enabling Auto while a review is open either completes the checked
step or closes it as blocked; No and Stop still win. Auto does not broaden authority.
Execution supplies the current Auto setting to the agent. A needs_input answer
gets one continuation to choose safe defaults or finish independent work; a repeated
question becomes a blocked result, not an input screen or a false success.
Desktop 1Password SDK calls can themselves display authorization prompts. Auto
therefore does not initiate those calls; interactive credentials are blocked.
Auto off retains credential approvals and the SDK's own authorization.
This supersedes the earlier Auto wording below.

## Active job engine, login and Auto mode — 2026-09-09
The user explicitly approved completing all three. AgentEngine now routes continuing
ChatGPT jobs (execute/work) to pinned Hermes/Astra with per-job memory. Setup,
public research and independent review deliberately remain on the existing Astra
client; public.search is its explicit lookup tool for Hermes, never a silent
fallback agent. Claude remains an explicit alternative. No job starts on launch.
The separate Hermes sign-in and clean installed runtime must be verified before
activation. Hermes follows its native iteration limit, not the old 12-step cap;
selected thinking effort is forwarded and progress refreshes an inactivity timer.
Approval wait time is not counted as model inactivity. Stop kills the worker.

browser.login fills only a configured username/password reference on an exact
HTTPS origin. The executor checks the live input and form origin before retrieving
the secret and again before filling. Auto off asks before each retrieval. Auto on
permits configured sign-in fields; 1Password retains its own unlock/authorization.
Values cross to Aside via a private transient file, not model/tool arguments.
No snapshot is returned from a fill, later text is scrubbed for known values, and
temporary files are deleted in finally. Aside/destination retain their own data
handling policies; this is not a promise about their internal logs. New passwords,
CAPTCHA, passkeys and unsupported MFA remain user-only. No automated submission
is hidden in the login tool.

Auto on can additionally allow independently reviewed, clearly scoped reversible
browser steps and low-impact messages/submissions authorized by user-authored
requests. Auto off still asks for these. Security, permanent deletion, financial
commitments and uncertainty retain review. API/MCP requests still retain their
existing stricter gate. Changed pages, Stop, and No win in both modes. This
supersedes earlier preview and navigation-only wording below.

## Layered behavior update — 2026-09-09

Setup alone defaults ongoing help and records helpMode plus any explicitly quoted
scope in job_settings. Later phases consume saved settings without asking again;
legacy jobs keep their existing context. Setup is still limited to three questions.
Onboarding/ProblemService own plan acceptance and phase transitions, not a generic
system-prompt request for plan permission. Storage and ToolRuntime continue to
enforce job isolation, action review and credential-before-dispatch boundaries.
Codex thinking choices come from model/list and use turn/start effort; default
omits an override. Active Codex events refresh an inactivity timeout. The live
app loop no longer stops after twelve tool steps. Stop remains available. The
unactivated Hermes preview is not switched or retuned by this change.
Authentication is 1Password-first when a configured tool supports it. API/MCP
credential resolution is not browser password autofill. Do not claim the latter
exists or default to generic manual-login questions. A verified, user-only security
step may still need a specific handoff. This supersedes the old page-only login
instruction below; authentication errors can also establish a real blocker.

## onejob onboarding update — 2026-09-07

The user requested multiple independent jobs, left-edge desktop orbs and a focused
connect → describe → research → plan flow. The selected job alone supplies model
context. User-submitted brain dumps explicitly start research through the existing
reviewed tool loop. No background research on launch or job switching.
The user requested accurate dictation. Optional OpenAI gpt-transcribe receives only
user-recorded audio, directly, using a separate API key explicitly imported from a
private 0600 file into this app’s Keychain. Never reuse subscription credentials.
No other transcription processor is authorized by default. macOS on-device speech
remains the fallback when OpenAI dictation is not configured.

# onejob fork

## Hermes execution preview — 2026-09-09

`hermes-client.mjs` embeds the pinned Nous Hermes `AIAgent` in a separate Python
worker. Hermes owns its full conversation/tool loop. `ProblemService` supplies
a callback through the existing ToolRuntime, so approval, Stop, stale-job checks,
page ownership, screenshots and source saving remain app-owned. No main-entry
runtime switch has shipped. The preview rejects research until public search is
connected and verified; it must never silently fall back to another runtime.
The original stateless preview exposed only `onejob_action`. By user request,
execution now also enables Hermes's built-in memory and a job-scoped history
search wrapper, `job_history`. Each job/context version has a private profile,
SQLite transcript, memory files and durable checked-action journal. A kernel lock
permits one worker per profile; process death releases it. Explicit later work
loads recent complete turns plus bounded memory; older details remain searchable.
Source removal/forgetting rotates the context version. Old private profiles stay
on disk but are excluded from subsequent workers. Clarification and action review
use fresh isolated profiles without memory or transcript persistence. No launch,
restart or job switch starts a Hermes worker automatically. Saved notes are not
permission: external operations still pass through current app checks.
No native shell/browser/files, plugins, user rules, cross-job recall, background
review, compression model or fallback model is enabled. It uses the new Hermes-owned ChatGPT login and pinned
Astra. Its separate sandbox blocks unrelated home-file contents, other app data,
dotenv overrides and writes outside its private profile, except the fresh shared
Hermes auth file, lock and atomic refresh temporary files. OAuth stays owned by
Hermes at that root; no token copying. Metadata for resolving
the installed Python executable remains readable. The runtime is a clean pinned
checkout; its isolated Python environment is installed separately.

## Hermes migration preflight — 2026-09-09

The user approved trying Nous Research Hermes Agent with pinned gpt-6-astra,
Aside, and a restricted credential helper. They chose a fresh ChatGPT login,
not API billing or importing existing tokens. `hermes-login.mjs` prepares only
that login: a separate data directory, a stripped environment, and a macOS
sandbox denying access to existing provider credential directories. Hermes owns
the new OAuth exchange and storage. This is not an agent-tool sandbox.
The running app still uses the existing clients. Do not switch it until the
complete pinned Hermes installation, Astra access, tool approvals, job isolation,
and Stop have been tested. No automatic provider/model fallback is authorized.

## Auto mode and readable approvals — 2026-09-09

The user requested an Auto mode toggle and simpler action information. Auto mode
defaults off and is persisted per job. Verified routine navigation proceeds even
with Auto mode off. Exact link/tab/button/menuitem/generic targets without known
consequential wording are candidates, not permission. An isolated check through the selected AI
(no native tools or search) must classify the click as routine navigation. Errors,
uncertainty and malformed output fall back to manual approval. This is a layered
heuristic, not a guarantee about arbitrary webpages. Opening settings is not
changing settings. All consequential or unclear controls and
API/MCP operations retain review. Recheck job, setting and stored page after the
AI check; verify the live snapshot before an automatic click. Enabling Auto mode
can recheck a pending action, but must not override No, Stop, or a newer page.
The user reversed the abbreviated-card design: restore the full JSON request and
nearby page snapshot in the permission screen. The selected-item-only summary was
not enough context. Keep Auto mode unchanged. Preserve exact outgoing text, and
render all details as inert text rather than HTML.

Browser approvals also show a fresh viewport screenshot of the job-owned tab.
Capture only through that tab's Aside session; never capture the desktop or attach
unrelated tabs. onejob sends bounded raster bytes only to its local UI, not to the
AI, action history, or saved sources. Clear the preview when approval closes.
Capture failures omit the image without blocking manual review. Aside's own
session handling remains governed by Aside.

## Browser recovery update — 2026-09-09

Read the current task tab after navigation; keep the reviewed-URL check for
click/fill/press only. A failed open/read reconnects and opens the last known
task URL once, with stop, current-job and page-ownership checks. Never replay a
write during recovery. If recovery fails, pause with an app error before asking
the model for another answer. Do not turn transport errors into user login or
troubleshooting questions. Request login/MFA only when the current page provides
evidence that it is required. This supersedes the old ask-after-two-reads fallback.

## Browser approval update — 2026-09-08

By user request, connected-browser page opens and reads run without per-action
approval. This supersedes the blanket external-action review wording below.
Only validated browser.open/browser.read are exempt; job page ownership, URL
validation, stop and current-job checks still apply. Browser click/fill/press and
API/MCP operations retain exact review. Do not ask a needs-input question before
requesting a tool review. Failed or interrupted reads may retry, but explicit
declines and uncertain writes must not be repeated automatically. Navigation
must not be used to submit changes or transfer private data. This last constraint
is model policy, not a guarantee about arbitrary websites' GET side effects.

## Aside setup update — 2026-09-08

By user request, remove the analytics/sync attestation. Connect Aside itself grants
browser access for the chosen profile after a short page-sharing notice. Do not
claim to change or verify Aside settings. Existing exact-action reviews remain.
Connecting a new Aside connection resumes a needs-input job with an accepted plan.
Each execution result records the browser connections already available, so the
same connection does not repeatedly resume an unanswered question. Opening an old
needs-input job without this checkpoint may recheck it once using a connected
browser. Failed or interrupted runs remain paused; exact action reviews remain.

## Shared AI behavior and clarification

Every new reasoning feature must use `ai-policy.mjs` through `instructionFor` /
`promptFor`, including both provider system prompts. Keep explanations in simple
everyday language. Transcription stays verbatim; do not rewrite what was spoken.
Clarification precedes research: use only the submitted problem and prior attempts,
no search or tools, at most three questions per intake version. On explicit Not
sure or Pick for me requests, also include the current question and earlier
answers from that job. Not sure replaces only that question. AI-picked answers
are assumptions, never user facts or permission; unsupported personal facts stay
unknown. Use explicitly
pinned Astra through the selected ChatGPT connection, never silently substitute
a smaller model or switch providers. User answers and drafts belong only to that
job. Unknown or skipped answers are not authorization to act. Submitting the
final answer (or an intake needing zero questions) now automatically enters
research, by user request. Keep browser permission and exact external-action
approvals. Restarts and job switches never automatically resume research.
Progress lines describe actual events, never simulated activity.

## Public research update — 2026-09-08

Continue on a reviewed plan now explicitly starts execution. Execution may use
the same public search and the existing reviewed app tool loop. Account actions
still require exact approval. Results and missing-input questions are saved per
job. Interrupted execution needs an explicit resume. By user request, opening a
legacy job whose plan was already accepted (work stage with a saved plan and no
execution result) starts that pending work without another Continue gate. This
exception does not start unapproved plans, research, completed or interrupted
runs. The plan alone is not evidence that any work was completed.

The user requested research without personal-browser setup. Research now enables
only the selected provider's public search (Codex hosted live web search; Claude
Code WebSearch). All other native tools stay disabled. Claude WebFetch stays off:
search snippets are not full-page reads. The app loop permits only memory.search
during research, not browser/API/MCP/account actions or document writes. Searches
use the official provider connection, never personal browser cookies. Queries
and public results are handled under the provider's policies. Prompt instructions
minimize private details in queries; this is not a deterministic redaction filter.
Signed-in access stays optional in Tools and requires existing consent and action
reviews after the plan. This narrow exception supersedes the older blanket
provider-native-tool prohibition below, not the account-action approval rules.

The user requested browser-first setup: detect Aside and its local profiles, reuse
website sessions, and keep separate service connectors optional. The user confirms
one browser profile; login/MFA stays in the browser. Optional Notion/Linear OAuth
uses the official MCP SDK, pinned service origins and local callbacks. OAuth
credentials belong in macOS Keychain, never SQLite, logs, or model context.

The user also requested automatic Desktop folders. onejob creates Desktop/onejob
and a separate folder per problem, then indexes only that problem’s folder.
Previously selected folders remain connected. Never index the Desktop itself.

The user requested this separate voice-first problem-solving app on 2026-09-05.
This directory owns a separate SQLite store, not the inherited context corpus.
An explicitly selected official provider client may receive the active problem,
conversation, user-added context, and relevant excerpts from explicitly selected
folders when they send a message. Folder indexing and refresh stay local.
Use existing file readers, SQLite FTS5, and the network-denied macOS embedding
helper; no hosted memory or embedding service. Never read
the existing Intaglio corpus or copy, link, parse, or log provider credentials.
Codex owns a separate login profile. Claude Code owns its existing native login;
the app does not implement Claude.ai OAuth.

The user authorized a native tool loop with direct JSON APIs, MCP servers and
Aside browser controls. External calls require review of the specific action,
destination, and arguments. Credential references stay local; the official
1Password SDK resolves them only for execution after approval. No Docker or
mandatory hosted integration broker. Outside the public-search exception above,
provider-native tools remain disabled and operations pass through this loop. See the README and egress
ledger for the limits of the browser and user-configured service boundaries.
All other parent rules apply.

Prefer Node builtins. Use the official MCP SDK for protocol compatibility and
the official 1Password SDK for desktop authorization; do not reimplement either.
Versions and transitive dependencies are pinned in package-lock.json. Tests live in ui/test/focus-*.test.mjs and use synthetic data.
