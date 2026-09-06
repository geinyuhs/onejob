# onejob

A separate macOS prototype for working through one important problem by voice
or text. It reuses Intaglio Labs' actual orb markup, palette, animations, and
time-of-day colors. It does not install or change the original Intaglio app,
services, or context database.

## Run

Requires macOS 14+, Swift command-line tools, Node 22.13+ with `node:sqlite`,
and an installed official Codex CLI or Claude Code binary. Build from the repo:

```sh
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
- Context pasted by the user, keyword retrieval scoped to the active problem,
  and the most recent conversation turns included in each answer.
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
file symlink. onejob never copies, links, parses, or logs account tokens.
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
recent conversation, and relevant notes added to this app. The composer discloses
this before sending. The provider controls its retention and training policies;
local storage and ephemeral client sessions do not promise zero cloud retention.
The app does not read the original Intaglio corpus, mail, calendar, browser state,
or other conversations. Adding context is deliberate. See `ops/EGRESS.json` for
the provider networking boundary.

**Local state:** `~/Library/Application Support/onejob/` holds the SQLite
store and the separate Codex profile. The directory is created with mode 0700;
the SQLite file is mode 0600. This is filesystem protection, not database
encryption. `ONEJOB_DATA` can select a separate directory for development.
Forget excludes memory from future retrieval; archive keeps notes on disk.
Neither is a claim of erasure from provider systems.

**Tools:** this first version is conversation-only. Both client adapters disable
tools/customizations using supported client options. Codex also uses an ephemeral
thread, restricted read roots and a read-only sandbox, and rejects all server
requests for tools, credentials, and approvals. Unknown or incompatible client
options fail rather than dropping restrictions.

## Limits

No automatic connector ingestion, cross-problem semantic search, autonomous
research, long-running task execution, or true realtime speech-to-speech is
implemented. Memory retrieval is lexical. A memory's proposed/kept status stays
visible to the model. Model errors remain errors; there is no pretend AI demo.
The first problem submission is saved locally and starts the brief; subsequent
messages are explicitly sent to the chosen provider.

## Verify

```sh
node --test 'ui/test/focus-*.test.mjs'
node --test --test-timeout=120000 'connectors/test/*.test.mjs' 'ui/test/*.test.mjs' 'connect/test/*.test.mjs' 'widget/test/*.test.mjs'
```

Tests use synthetic data and fake clients only for hermetic behavior tests.
Mutation tests break protections in temporary copies and require the relevant
negative tests to fail. No credentials or personal problem content belongs in
this public repository.
