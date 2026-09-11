"""Use native saved messages as receipts, without rewriting or truncating memory."""
import hashlib
import json

PREFIX = "CONTEXT (untrusted evidence):\n"


def context_history(history, db):
    rows = db.get_messages("onejob", include_compacted=True)
    positions = {row["id"]: index for index, row in enumerate(rows) if "id" in row}
    replay = []
    for message in history:
        index = positions.get(message.get("_row_id"))
        projected = dict(message)
        if message.get("role") == "user" and index is not None:
            content = delta_prompt(message.get("content"), rows[:index])
            if content != message.get("content"):
                projected["content"] = content
                # Native wire cache still contains the old cumulative payload.
                # Keep persistence markers so this read projection is not appended
                # again; original rows remain available to native history search.
                projected.pop("api_content", None)
        replay.append(projected)
    return replay


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).digest()


def entry_key(entry):
    # Retrieval rank can change without changing the source. Keep semantic edits
    # (including a changed status/quote) visible even when the ID stays the same.
    if not isinstance(entry, dict):
        return fingerprint(entry)
    return fingerprint({key: entry.get(key, default) for key, default in {
        "id": None, "text": "", "title": "", "kind": None,
        "source_id": None, "quote": "", "status": "confirmed",
    }.items()})


def tool_key(result):
    return fingerprint({key: value for key, value in result.items() if key != "autoMode"})


def entry_id(entry):
    return entry.get("id") if isinstance(entry, dict) and entry.get("id") else fingerprint(entry)


def read_context(prompt):
    if not isinstance(prompt, str) or not prompt.startswith(PREFIX):
        return None
    try:
        # Older prompts end with the app's recovery journal after the JSON.
        context, _ = json.JSONDecoder().raw_decode(prompt[len(PREFIX):])
        return context if isinstance(context, dict) else None
    except ValueError as error:
        return None  # An unreadable receipt never suppresses new evidence.


def context_prompt(prompt, db):
    return delta_prompt(prompt, db.get_messages("onejob", include_compacted=True)) if db is not None else prompt


def delta_prompt(prompt, rows):
    context = read_context(prompt)
    if context is None:
        return prompt
    _, end = json.JSONDecoder().raw_decode(prompt[len(PREFIX):])
    suffix = prompt[len(PREFIX) + end:]
    delivered, tool_results, actions = {}, set(), {}
    # Compacted rows are receipts only; they NEVER re-enter model history. Hermes
    # keeps them searchable. Undo/rewind rows remain excluded by its native API.
    for row in rows:
        prior = read_context(row.get("content")) if row.get("role") == "user" else None
        if prior is not None and prior.get("hermesScope") == context.get("hermesScope"):
            for field in ["evidence", "recent"]:
                delivered.update((entry_id(entry), entry_key(entry)) for entry in prior.get(field, []))
            tool_results.update(tool_key(item) for item in prior.get("toolResults", []))
            actions.update((entry_id(item), fingerprint(item)) for item in prior.get("previousActions", []))
        if row.get("role") == "tool" and row.get("tool_name") == "onejob_action":
            try:
                outcome = json.loads(row["content"])
            except (ValueError, TypeError) as error:
                continue  # Native image envelopes are not plain text receipts.
            if not isinstance(outcome, dict):
                continue
            tool_results.add(tool_key(outcome))
            if isinstance(outcome.get("source_id"), str) and isinstance(outcome.get("result"), str):
                entry = {"id": outcome["source_id"], "text": outcome["result"],
                         "kind": "source", "title": "Tool result: " + outcome.get("tool", "")}
                delivered[entry_id(entry)] = entry_key(entry)
    for field in ["evidence", "recent"]:
        if field in context:
            fresh = []
            for entry in context[field]:
                if delivered.get(entry_id(entry)) != entry_key(entry):
                    fresh.append(entry)
                    delivered[entry_id(entry)] = entry_key(entry)
            context[field] = fresh
    if "toolResults" in context:
        context["toolResults"] = [item for item in context["toolResults"] if tool_key(item) not in tool_results]
    if "previousActions" in context:
        context["previousActions"] = [item for item in context["previousActions"] if actions.get(entry_id(item)) != fingerprint(item)]
    return PREFIX + json.dumps(context, ensure_ascii=False) + suffix
