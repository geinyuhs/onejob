# onejob

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
- A Desktop/onejob folder created automatically at launch, with a separate
  Job folder for each problem. Open the current folder from Context and drop
  notes there. No folder picker or connection setup is required. Existing
  selected folders remain available under Browse context. Changes refresh every
  30 seconds while the app is running,
  and immediately before search or Send.
- Hybrid retrieval: SQLite FTS5 ranked text search plus macOS NaturalLanguage
  sentence embeddings. The embedding helper is denied network access. If its
  English model is unavailable, search falls back to keywords locally.
- Changed or removed files retire old excerpts and derived memories. Replies
  that may repeat old evidence stay visible as history but are excluded from
  future model context. Disconnect removes the folder index, never source files.
- Proposed memories with exact source quotes; Keep and Forget controls.
  A matching quote establishes provenance, not factual truth.
- On-device macOS speech recognition when supported for the current language.
  Tap the orb to start/stop; review the transcript before sending. No audio files
  are saved. macOS voices can read replies aloud. Text remains available.
- Explicit Send and Stop controls. Stale results cannot replace newer context.
- Archived problems remain on disk but are excluded from later retrieval.

## Account connection and privacy

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
recent conversation, and relevant notes, selected-folder excerpts, and tool results. The composer discloses
this before sending. The provider controls its retention and training policies;
local storage and ephemeral client sessions do not promise zero cloud retention.
The app does not import the original Intaglio corpus or other conversations.
Mail, calendar and websites can be accessed through connections you configure
and operations you review. Existing personal browser tabs are not attached
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
Aside tabs. Actual results return to the selected frontier client. There are at
most 12 tool steps per Send. History and results stay in the local database;
saved files live under its `artifacts/` directory. Open them from Tools.

Both provider adapters still disable their native tools and customizations. Codex
uses an ephemeral thread and read-only sandbox. The shared onejob loop interprets
JSON tool requests and enforces reviews; this is not native provider function
calling. There is no background worker or arbitrary shell/JavaScript tool.

The default **Tools** screen detects Aside and local profile IDs. Enable one
profile to reuse websites already signed in there. The agent prefers browser
context over asking for a separate connector for each site. Chrome/Safari
sessions are not imported. onejob does not control the entire desktop. Users
complete normal password-manager autofill, unlock, login, and MFA prompts in Aside;
onejob never asks the model to retrieve those secrets. The browser permission is
remembered, while each external operation still requires its own review.

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

- **Aside:** install its CLI through Developer settings and open the desired profile.
  The main setup detects profile IDs; a choice is needed only when several exist. Review its privacy settings and disable
  analytics and browser/vault sync before enabling this connection. onejob uses
  browser controls through `aside mcp`, not an Aside AI conversation. Aside and
  visited sites still control their own traffic, cookies, subresources, redirects,
  and retention. The checkbox is your confirmation, not a network audit. Normal
  browser login works; onejob does not implement 1Password browser autofill.
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

Every external step displays its destination and arguments for one-use approval.
Browser operations also show the available page excerpt. Approve deliberately:
onejob does not prove what a remote API, MCP tool, or webpage will do. Stop cannot
undo an already dispatched operation. Failed or interrupted writes are marked
uncertain, and an identical declined/uncertain request cannot automatically retry
within that run. Inspect the service before trying again.

No Docker, Nango, Composio, or hosted memory broker is required. Dependencies are
the official MCP SDK (protocol/transport support) and 1Password SDK (desktop
credential authorization). Automatic OAuth setup is currently limited to the Notion and Linear presets.
Other service-specific OAuth flows, non-bearer custom authentication, and
persistent task-tab handles across app restarts are not implemented.

## Limits

Folder import reuses the existing local file reader. It supports Markdown,
plain text, TeX, CSV, and TSV; skips hidden/known credential paths, links, binary
files, and cloud placeholders; and does not trigger cloud downloads. It reads
files up to 256 KiB, retains at most 20,000 characters per file, and splits them
into 5,000-character excerpts. A scan exceeding 200 visited files blocks search
and Send until some files are moved out of that folder.

Meaning search currently uses English, the first 2,000 characters of each
excerpt, and up to 1,000 recent eligible entries. Retrieval quality is not
benchmarked. Other languages retain keyword search. No mail/calendar connectors,
cross-problem search, unattended research, long-running task execution, or true
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

Onboarding shows connect, problem, research, and plan in the existing window.
Research starts only after submitting a problem. Missing browser permission is
requested inside the research step; using only supplied context produces a
preliminary plan. The tool loop still requires exact external-action approvals.
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
