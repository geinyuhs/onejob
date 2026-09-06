# onejob fork

The user requested this separate voice-first problem-solving app on 2026-09-05.
This directory owns a separate SQLite store, not the inherited context corpus.
An explicitly selected official provider client may receive the active problem,
conversation, user-added context, and relevant excerpts from explicitly selected
folders when they send a message. Folder indexing and refresh stay local.
Use existing file readers, SQLite FTS5, and the network-denied macOS embedding
helper; no hosted memory or embedding service. Never read
the existing Intaglio corpus or copy, link, parse, or log provider credentials.
Codex owns a separate login profile. Claude Code owns its existing native login;
the app does not implement Claude.ai OAuth. All other parent rules apply.

Use Node builtins. Tests live in ui/test/focus-*.test.mjs and use synthetic data.
