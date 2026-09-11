# harness for hyper focusing AI

onejob is a macOS prototype for giving an AI sustained attention on one problem.
The engineering work is in the harness: the software around the model that
connects its tools, carries context forward, manages interruptions, and keeps
actions within the job's scope.

The goal is to go deeper on a problem over time, without starting from scratch
at every message or mixing it with unrelated work.

## Harness engineering

Hermes owns the continuing agent loop for ChatGPT-backed jobs. onejob connects
that loop to Aside, public search, local documents, and job memory. Setup,
independent action review, and answer formatting are separate steps, rather than
one growing system prompt.

- **Preserve model capability.** Forward the selected thinking mode, use Hermes's
  native context compaction, and make full tool results available through paging.
  A short displayed excerpt should not mean the rest of the evidence is lost.
- **Make long work resumable.** Keep conversation history, saved findings, and an
  action journal. Distinguish a quiet model from a disconnected worker. After a
  stop or interruption, Continue resumes with the saved context; it does not
  automatically replay uncertain actions.
- **Separate instructions from enforcement.** Prompts describe the job. Workflow
  code owns phase transitions. Tool code checks page ownership, credential
  destinations, approvals, and cancellation. AI action review is a judgment,
  not a guarantee about a website's behavior.
- **Test the failure paths.** Regression tests cover interruptions, stale pages,
  denied actions, context isolation, and credential handling—not just successful
  model responses.

## Memory

Each job has its own local notes, documents, and job-scoped search.
Relevant excerpts are retrieved from that job's selected folders, not the whole
Mac. Local search and embeddings do not require a hosted memory service.

Continuing ChatGPT jobs keep a private Hermes profile with conversation history and
memory. Older turns remain searchable; native compaction summarizes context when
needed. Continuations send new or changed evidence instead of repeating material
already in that history; current plans and settings stay explicit on every turn.
Removing a source changes the job's context version so later runs do not
reload the previous Hermes profile. Historical files may remain on disk, and
removal cannot erase context already sent to an AI provider.

Memory is evidence to revisit, not permission to act. Saved conclusions can be
wrong or out of date, and remembered approvals do not replace current checks.

## Focus

One problem, one editable research plan, one body of accumulated context.
Separate jobs have their own desktop orbs and folders under `Desktop/onejob`.
Speak or type, review the plan, and follow a short status line tied to actual
work rather than a simulated progress animation.

The current execution phase is **research only**: gather the relevant entities,
rules, current state, and schedules; save sources; and identify what is still
unknown. Scheduled actions are a separate, not-yet-implemented next step.
Ongoing help is the setup default, not a claim that background monitoring is
already running.

## How it works

1. Connect your AI. Add Aside if the job needs signed-in websites.
2. Describe the problem and what you have already tried.
3. Answer up to three setup questions. Initial public research follows.
4. Edit the problem and research plan, then press Continue to gather context
   through the connected tools.
5. Review sourced findings and remaining gaps. Incomplete work can continue from
   saved context; stopped work stays paused until you resume it.

AI answers can still be wrong; check important conclusions and proposed actions.

## Privacy, plainly

- Jobs, notes, and the search index are stored on your Mac. The local database
  has restricted file permissions; it is not encrypted by one job.
- The selected AI receives the active job, relevant context, and tool results
  when you start research or work. This is **not an entirely offline app**.
  Provider retention and training settings still apply.
- Public research uses the selected provider's search, without your personal
  browser cookies. Search-query privacy relies on model instructions, not a
  guaranteed redaction filter.
- Aside access is optional. Connecting it allows task-related pages to be opened
  and read without repeated approval. Full page text is available in chunks;
  shortening one result does not discard the remaining text. Routine navigation,
  including opening trade details, needs an independent AI check in either mode.
  Research cannot change accounts, accept trades, or send messages. Auto defaults
  off; when enabled, unavailable actions are blocked without app questions.
  Configured 1Password fills use a separate origin check and ask before retrieval
  with Auto off. Auto does not start interactive password-manager authorization.
  Connecting Aside does not expose unrestricted browser code or the password vault.
- Provider sign-ins belong to the official clients or Hermes's separate login.
  Configured 1Password values enter the local executor only for approved use,
  outside model arguments. Browser masking retains keyed fingerprints, not a
  plaintext credential cache, grouped by job and login origin until app shutdown.
  Only that job's fingerprints are used, including to catch reflected values
  after redirects. Screenshot matching runs locally, not in page scripts.
- Folder indexing and embeddings run locally. There is no hosted memory service
  or analytics SDK in this app. Desktop folders follow your macOS/iCloud settings.
- Removing a context file excludes its indexed excerpts and derived replies from
  future context. A plan based on retired context must be researched again before
  execution. This does not erase copies already received by an AI provider.

See [setup, privacy boundaries, and limitations](widget/focus/README.md) for
details and [the network-access ledger](ops/EGRESS.json) for declared recipients.

## Build

This is a development prototype for macOS 14+. It needs Swift command-line tools,
Node 22.13+ with `node:sqlite`, and the official Codex CLI or Claude Code.
The clarification step currently requires ChatGPT through Codex. Continuing
ChatGPT jobs also need the pinned Hermes runtime and its separate sign-in;
building the app does not install or authenticate Hermes. Claude remains an
explicit alternative for research and execution. Aside is optional for browser work.

```sh
npm ci --prefix ui/server/focus --ignore-scripts --no-audit --no-fund
bash widget/focus/build.sh /tmp/onejob-build/onejob.app
open /tmp/onejob-build/onejob.app
```

The build is ad-hoc signed, not a notarized public release. The
[build notes](widget/focus/README.md#run) explain the standalone Node requirement.

## Development

The app lives in `widget/focus/`; its local service lives in `ui/server/focus/`.
Tests use synthetic data, temporary stores, and local test servers.

```sh
npm ci --prefix connectors --ignore-scripts
npm ci --prefix ui/server/focus --ignore-scripts --no-audit --no-fund
node --test --test-timeout=120000 'connectors/test/*.test.mjs' 'ui/test/*.test.mjs' 'connect/test/*.test.mjs' 'widget/test/*.test.mjs'
```

Before publishing, review the complete diff, commit messages, and author metadata
for private data. Never commit credentials, personal conversations, real contact
details, runtime databases, or results derived from personal data. A passing test
suite is not proof that a document or commit message contains no private data.

## Upstream

one job is built on [Intaglio Labs](https://github.com/intaglio-labs/intagliolabs).
The inherited app, connectors, and runbooks remain in this repository, but are
separate from the one job app and its database. Their local-model architecture
does not describe one job's cloud AI connections.

See the [upstream operations documentation](ops/README.md) for that system.

## License

[MIT](LICENSE)
