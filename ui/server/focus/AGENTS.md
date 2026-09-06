# onejob fork

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
mandatory hosted integration broker. Provider-native tools remain disabled so
all model-requested operations pass through this loop. See the README and egress
ledger for the limits of the browser and user-configured service boundaries.
All other parent rules apply.

Prefer Node builtins. Use the official MCP SDK for protocol compatibility and
the official 1Password SDK for desktop authorization; do not reimplement either.
Versions and transitive dependencies are pinned in package-lock.json. Tests live in ui/test/focus-*.test.mjs and use synthetic data.
