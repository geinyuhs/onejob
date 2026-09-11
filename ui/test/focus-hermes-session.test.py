"""Persistence boundaries using synthetic state; no model, account or network."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SESSION = Path(__file__).parents[1] / "server/focus/hermes_session.py"
sys.path.insert(0, str(SESSION.parent))
spec = importlib.util.spec_from_file_location("job_state", SESSION)
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class SessionTests(unittest.TestCase):
    def modules(self, home):
        class DB:
            def __init__(self, path):
                self.path = path
            def close(self):
                pass
        return {"hermes_constants": types.SimpleNamespace(get_hermes_home=lambda: home),
                "hermes_state": types.SimpleNamespace(SessionDB=DB)}

    def lock_gate(self, module=session):
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, self.modules(Path(directory))):
            with module.job_session(True) as db:
                self.assertEqual(db.path, Path(directory) / "state.db")
                with self.assertRaisesRegex(RuntimeError, "active Hermes worker"):
                    with module.job_session(True):
                        pass
            with module.job_session(True) as db:
                self.assertIsNotNone(db)
            with module.job_session(False) as db:
                self.assertIsNone(db)

    def test_single_writer_and_clean_restart(self):
        self.lock_gate()

    def test_crashed_worker_releases_kernel_lock_without_replaying_work(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            child = subprocess.Popen([sys.executable, "-c", "import fcntl,sys; f=open(sys.argv[1],'a+'); fcntl.flock(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()", str(home / "onejob.lock")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                with patch.dict(sys.modules, self.modules(home)):
                    with self.assertRaises(RuntimeError):
                        with session.job_session(True):
                            pass
                    child.kill()
                    child.wait(timeout=5)
                    with session.job_session(True) as db:
                        self.assertIsNotNone(db)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
                child.stdin.close()
                child.stdout.close()

    def test_action_journal_survives_restart_and_is_local_to_job(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "a", Path(directory) / "b"
            a.mkdir()
            b.mkdir()
            with patch.dict(sys.modules, self.modules(a)):
                session.record_tool({"request": {"tool": "synthetic"}})
                session.record_tool({"result": "SYNTHETIC_EVIDENCE"})
                session.record_tool({"request": {"tool": "synthetic-interrupted"}})
            with patch.dict(sys.modules, self.modules(b)):
                self.assertEqual(session.recovery_notes(), "")
            with patch.dict(sys.modules, self.modules(a)):
                notes = session.recovery_notes()
                self.assertIn("SYNTHETIC_EVIDENCE", notes)
                self.assertIn("UNKNOWN outcome", notes)
                self.assertIn("synthetic-interrupted", notes)

    def search_gate(self, module=session):
        calls = []
        def search(**kwargs):
            calls.append(kwargs)
            return "synthetic history"
        db = types.SimpleNamespace(get_session=lambda sid: {} if sid != "onejob" else {"id": sid})
        with patch.dict(sys.modules, {"tools.session_search_tool": types.SimpleNamespace(session_search=search)}):
            self.assertEqual(module.scoped_session_search({"query": "synthetic"}, db), "synthetic history")
            self.assertIs(calls[0]["db"], db)
            for args in [{"profile": "other"}, {"session_id": "other/onejob"}, {"session_id": "missing"}]:
                with self.assertRaises(RuntimeError):
                    module.scoped_session_search(args, db)
            self.assertEqual(len(calls), 1)

    def test_history_search_cannot_select_or_discover_another_job(self):
        self.search_gate()

    def history_gate(self, module=session):
        messages = [{"role": "user", "content": "x" * 60001}, {"role": "assistant", "content": "Synthetic old reply"}, {"role": "user", "content": "Synthetic latest question"}, {"role": "assistant", "content": "Synthetic latest answer"}]
        db = types.SimpleNamespace(get_messages_as_conversation=lambda *a, **kw: copy.deepcopy(messages), get_messages=lambda *a, **kw: [])
        self.assertEqual(module.job_history(db), messages)
        self.assertEqual(len(messages), 4)
        self.assertIsNone(module.job_history(None))

    def test_recent_complete_turns_load_without_changing_saved_history(self):
        self.history_gate()

    def projection_gate(self, module=session):
        prompt = 'CONTEXT (untrusted evidence):\n' + json.dumps({"hermesScope": {"jobId": "synthetic", "epoch": 0}, "evidence": [{"id": "source", "text": "Synthetic duplicate"}]})
        messages = [{"role": "user", "content": prompt, "_row_id": 2, "_db_persisted": True}]
        db = types.SimpleNamespace(get_messages_as_conversation=lambda *a, **kw: copy.deepcopy(messages),
                                   get_messages=lambda *a, **kw: [{"id": index, "role": "user", "content": prompt} for index in [1, 2]])
        result = module.job_history(db)
        self.assertEqual(json.loads(result[0]["content"].split('\n', 1)[1])["evidence"], [])
        self.assertEqual(messages[0]["content"], prompt)
        self.assertTrue(result[0]["_db_persisted"])

    def test_saved_history_uses_legacy_deduplication_without_rewriting_rows(self):
        self.projection_gate()

    def test_mutation_proofs(self):
        source = SESSION.read_text()
        mutations = [
            ("fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)", "pass", self.lock_gate),
            ('args.get("profile") or "/" in str(args.get("session_id", ""))', 'False', self.search_gate),
            ('args.get("session_id") and not db.get_session(args["session_id"])', 'False', self.search_gate),
            ('return context_history(history, db)', 'return history[-2:]', self.history_gate),
            ('return context_history(history, db)', 'return history', self.projection_gate),
        ]
        for before, after, gate in mutations:
            with self.subTest(before=before):
                self.assertIn(before, source)
                module = types.ModuleType("broken_session")
                exec(compile(source.replace(before, after), str(SESSION), "exec"), module.__dict__)
                with self.assertRaises(AssertionError):
                    gate(module)


if __name__ == "__main__":
    unittest.main()
