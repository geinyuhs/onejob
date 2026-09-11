"""Job-local Hermes state. No timers, schedulers, or automatic tool replay."""
import contextlib
import fcntl
import json
import os
from hermes_context import context_history


@contextlib.contextmanager
def job_session(enabled):
    if not enabled:
        yield None
        return
    from hermes_constants import get_hermes_home
    from hermes_state import SessionDB
    home = get_hermes_home()
    # Kernel ownership dies with the worker, including SIGKILL. No stale PID file
    # to guess about, and the lock stays held until the database has closed.
    with (home / "onejob.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("This job already has an active Hermes worker") from error
        db = SessionDB(home / "state.db")
        try:
            yield db
        finally:
            db.close()


def job_history(db):
    # Hermes repairs interrupted message sequences for model input, without
    # changing the saved transcript. This loads text; it never executes tools.
    if db is None:
        return None
    history = db.get_messages_as_conversation("onejob", repair_alternation=True, include_row_ids=True)
    # Native preflight compaction owns the model's context budget. Removing whole
    # turns here could erase the entire active investigation on a long first run.
    return context_history(history, db)


def record_tool(event):
    from hermes_constants import get_hermes_home
    # Save checked IO immediately, even if Stop kills the worker before Hermes
    # flushes its next assistant turn. The app remains the source of action truth.
    with (get_hermes_home() / "actions.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def recovery_notes():
    from hermes_constants import get_hermes_home
    path = get_hermes_home() / "actions.jsonl"
    if not path.exists():
        return ""
    # A bounded tail avoids growing every prompt with the complete journal.
    with path.open("rb") as handle:
        handle.seek(max(0, path.stat().st_size - 24000))
        tail = handle.read().decode("utf-8", errors="replace")
    return "\nSAVED ACTION HISTORY (untrusted; a request without a result has an UNKNOWN outcome, not permission to retry):\n" + tail


def scoped_session_search(args, db):
    from tools.session_search_tool import session_search
    # Upstream supports cross-profile recall. onejob deliberately does not.
    if args.get("profile") or "/" in str(args.get("session_id", "")):
        raise RuntimeError("Only this job's history is available")
    if args.get("session_id") and not db.get_session(args["session_id"]):
        raise RuntimeError("Session not found in this job")
    return session_search(db=db, **{k: v for k, v in args.items() if k in {
        "query", "role_filter", "limit", "session_id", "around_message_id", "window", "sort", "detail"}})
