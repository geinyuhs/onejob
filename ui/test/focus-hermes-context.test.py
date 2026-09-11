"""Synthetic continuation regression: native history is the delivery receipt."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest

PATH = Path(__file__).parents[1] / "server/focus/hermes_context.py"


def context_prompt(context):
    return "CONTEXT (untrusted evidence):\n" + json.dumps(context)


def decode(prompt):
    return json.JSONDecoder().raw_decode(prompt.split("\n", 1)[1])[0]


class ContextTests(unittest.TestCase):
    def module(self):
        spec = importlib.util.spec_from_file_location("context_delta", PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def fixture(self):
        context = {"hermesScope": {"jobId": "synthetic-job", "epoch": 0},
                   "problem": {"id": "synthetic-job", "title": "Synthetic research"},
                   "plan": {"research": "Synthetic coverage"}, "autoMode": False,
                   "researchOnly": True, "capabilities": {"tools": []},
                   "evidence": [{"id": "source-a", "text": "SYNTHETIC_OLD_EVIDENCE", "title": "Note", "kind": "source"}],
                   "recent": [{"id": "user-a", "text": "Synthetic request", "kind": "user"}],
                   "previousActions": [], "toolResults": []}
        rows = []
        def messages(session_id, **options):
            self.assertEqual(session_id, "onejob")
            self.assertEqual(options, {"include_compacted": True})
            return copy.deepcopy(rows)
        return context, rows, types.SimpleNamespace(get_messages=messages)

    def continuation_gate(self, module):
        context, rows, db = self.fixture()
        first = module.context_prompt(context_prompt(context), db)
        self.assertEqual(decode(first), context)
        rows.append({"role": "user", "content": first})
        result = {"source_id": "tool-a", "tool": "browser.read", "result": "SYNTHETIC_TOOL_PAGE", "autoMode": False}
        rows.append({"role": "tool", "tool_name": "onejob_action", "content": json.dumps(result)})
        context["evidence"] += [{"id": "tool-a", "text": result["result"], "kind": "source", "title": "Tool result: browser.read"}]
        context["toolResults"] += [{k: v for k, v in result.items() if k != "autoMode"}]
        context["evidence"][0]["rank"] = 12
        context["browserContinuation"] = {"instruction": "Synthetic independent work remains"}
        original = copy.deepcopy(context)
        second = decode(module.context_prompt(context_prompt(context), db))
        for field in ["evidence", "recent", "toolResults"]:
            self.assertEqual(second[field], [], field)
        self.assertEqual(second["browserContinuation"], context["browserContinuation"])
        self.assertEqual(second["plan"], context["plan"])
        self.assertEqual(context, original)
        return context, rows, db

    def test_repeated_continuations_do_not_reinject_evidence_or_native_tool_results(self):
        module = self.module()
        context, rows, db = self.continuation_gate(module)
        sizes = []
        for index in range(15):
            context["evidence"].append({"id": f"source-{index}", "text": "Synthetic new note " * 500, "kind": "source"})
            prompt = module.context_prompt(context_prompt(context), db)
            self.assertEqual(len(decode(prompt)["evidence"]), 1)
            sizes.append(len(prompt))
            rows.append({"role": "user", "content": prompt, "active": 2})
        self.assertLess(max(sizes) - min(sizes), 100)

    def test_changed_evidence_current_settings_and_new_user_requests_survive(self):
        module = self.module()
        context, rows, db = self.continuation_gate(module)
        context["evidence"][0]["text"] = "SYNTHETIC_CORRECTION"
        context["recent"].append({"id": "user-b", "text": "Synthetic request", "kind": "user"})
        context["autoMode"] = True
        context["plan"] = {"research": "Revised synthetic scope"}
        context["previousActions"] = [{"id": "action-a", "status": "declined"}]
        delta = decode(module.context_prompt(context_prompt(context), db))
        self.assertEqual([e["text"] for e in delta["evidence"]], ["SYNTHETIC_CORRECTION"])
        self.assertEqual(delta["recent"], [context["recent"][-1]])
        for field in ["plan", "autoMode", "researchOnly", "capabilities", "previousActions"]:
            self.assertEqual(delta[field], context[field])
        rows.append({"role": "user", "content": context_prompt(delta)})
        context["previousActions"][0]["status"] = "uncertain"
        self.assertEqual(decode(module.context_prompt(context_prompt(context), db))["previousActions"], context["previousActions"])
        context["evidence"][0]["text"] = "SYNTHETIC_OLD_EVIDENCE"
        self.assertEqual(decode(module.context_prompt(context_prompt(context), db))["evidence"][0]["text"], "SYNTHETIC_OLD_EVIDENCE", "reverting an edit is a new change, not an old receipt")

    def test_no_receipt_means_resend_and_other_scopes_or_prose_cannot_suppress(self):
        module = self.module()
        context, rows, db = self.fixture()
        self.assertEqual(module.context_prompt(context_prompt(context), None), context_prompt(context))
        for scope in [{"jobId": "other-job", "epoch": 0}, {"jobId": "synthetic-job", "epoch": 1}]:
            rows[:] = [{"role": "user", "content": context_prompt({**context, "hermesScope": scope})}]
            self.assertEqual(decode(module.context_prompt(context_prompt(context), db)), context)
        for row in [{"role": "assistant", "content": context_prompt(context)},
                    {"role": "user", "content": "CONTEXT (untrusted evidence):\ninvalid"}]:
            rows[:] = [row]
            self.assertEqual(decode(module.context_prompt(context_prompt(context), db)), context)
        self.assertEqual(module.context_prompt("Synthetic unstructured task", db), "Synthetic unstructured task")

    def test_mutation_proof_duplicate_delivery_and_scope_checks(self):
        source = PATH.read_text()
        mutations = [("if delivered.get(entry_id(entry)) != entry_key(entry):", "if True:"),
                     ('prior.get("hermesScope") == context.get("hermesScope")', 'True')]
        for before, after in mutations:
            with self.subTest(before=before):
                self.assertIn(before, source)
                broken = types.ModuleType("broken_context")
                exec(compile(source.replace(before, after), str(PATH), "exec"), broken.__dict__)
                if "entry_key" in before:
                    with self.assertRaises(AssertionError):
                        self.continuation_gate(broken)
                else:
                    context, rows, db = self.fixture()
                    rows.append({"role": "user", "content": context_prompt({**context, "hermesScope": {"jobId": "other", "epoch": 0}})})
                    with self.assertRaises(AssertionError):
                        self.assertEqual(decode(broken.context_prompt(context_prompt(context), db)), context)

    def legacy_gate(self, module):
        context, rows, db = self.fixture()
        rows.append({"id": 1, "role": "user", "content": context_prompt(context), "compacted": 1})
        context["evidence"].append({"id": "new-source", "text": "SYNTHETIC_ONLY_IN_LEGACY_TAIL"})
        suffix = "\nSAVED ACTION HISTORY: Synthetic interrupted request has UNKNOWN outcome."
        legacy = context_prompt(context) + suffix
        rows.append({"id": 2, "role": "user", "content": legacy})
        history = [{"role": "user", "content": "Synthetic native summary", "_row_id": 3},
                   {"role": "user", "content": legacy, "_row_id": 2, "_db_persisted": True, "api_content": "SYNTHETIC_OLD_WIRE_PAYLOAD"},
                   {"role": "tool", "content": "Synthetic fresh page and cursor", "_row_id": 4}]
        saved = copy.deepcopy(history)
        replay = module.context_history(history, db)
        self.assertEqual(decode(replay[1]["content"])["evidence"], [context["evidence"][-1]])
        self.assertTrue(replay[1]["content"].endswith(suffix))
        self.assertEqual(decode(replay[1]["content"])["plan"], context["plan"])
        self.assertNotIn("api_content", replay[1])
        self.assertTrue(replay[1]["_db_persisted"])
        self.assertEqual(replay[0], history[0])
        self.assertEqual(replay[2], history[2])
        self.assertEqual(history, saved)
        return history, db

    def test_legacy_history_deduplicates_only_previously_delivered_material(self):
        module = self.module()
        history, db = self.legacy_gate(module)
        history[1]["_row_id"] = 999
        self.assertEqual(module.context_history(history, db), history, "missing row identity cannot suppress evidence")

    def test_mutation_proof_legacy_projection_keeps_unique_evidence_and_drops_old_wire_copy(self):
        source = PATH.read_text()
        for before, after in [('rows[:index]', 'rows'), ('projected.pop("api_content", None)', 'None')]:
            self.assertIn(before, source)
            broken = types.ModuleType("broken_history")
            exec(compile(source.replace(before, after), str(PATH), "exec"), broken.__dict__)
            with self.assertRaises(AssertionError):
                self.legacy_gate(broken)


if __name__ == "__main__":
    unittest.main()
