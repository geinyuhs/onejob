"""Hermetic contract checks for the pinned Hermes embedding, without an account."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
import time
from unittest.mock import patch

WORKER = Path(__file__).parents[1] / "server/focus/hermes-worker.py"
sys.path.insert(0, str(WORKER.parent))
spec = importlib.util.spec_from_file_location("onejob_worker", WORKER)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def liveness_gate(self, monitor=worker.WorkerLiveness):
        events = []
        agent = types.SimpleNamespace(_turn_liveness_activity_generation=1,
                                      _last_activity_desc="SYNTHETIC_PRIVATE_STREAM")
        watch = monitor(agent, events.append)
        watch.pulse()
        watch.pulse()
        self.assertEqual(events, [{"event": "heartbeat"}] * 2)
        agent._turn_liveness_activity_generation += 1
        watch.pulse()
        self.assertEqual(events[-2:], [{"event": "heartbeat"}, {"event": "activity"}])
        self.assertNotIn("SYNTHETIC_PRIVATE_STREAM", json.dumps(events))
        watch.pulse()
        self.assertEqual(sum(e["event"] == "activity" for e in events), 1)

    def test_stream_activity_is_bridged_without_text_or_fake_progress(self):
        self.liveness_gate()

    def test_worker_health_thread_stops_on_exit_and_exception(self):
        for fail in [False, True]:
            events = []
            try:
                with worker.WorkerLiveness(types.SimpleNamespace(), events.append, interval=.005) as watch:
                    time.sleep(.025)
                    self.assertGreaterEqual(len(events), 2)
                    if fail:
                        raise RuntimeError("Synthetic failure")
            except RuntimeError as error:
                self.assertTrue(fail)
            self.assertFalse(watch.thread.is_alive())
            count = len(events)
            time.sleep(.01)
            self.assertEqual(len(events), count)

    def test_mutation_proof_activity_requires_a_new_runtime_event(self):
        path = WORKER.parent / "hermes_liveness.py"
        source = path.read_text()
        for replacement in ["if True:", "if False:"]:
            module = types.ModuleType("broken_liveness")
            exec(compile(source.replace("if generation != self.generation:", replacement), str(path), "exec"), module.__dict__)
            with self.assertRaises(AssertionError):
                self.liveness_gate(module.WorkerLiveness)

    def exercise(self, module=worker, *, tools=True, bad=None, completed=True, mismatch=False, persistent=False, image=False):
        events, options, registered, calls, journals = [], {}, {}, [], []
        context = {"hermesScope": {"jobId": "synthetic-job", "epoch": 0},
                   "evidence": [{"id": "synthetic-source", "text": "SYNTHETIC_ALREADY_DELIVERED"}],
                   "plan": {"research": "Synthetic current plan"}}
        prompt = "CONTEXT (untrusted evidence):\n" + json.dumps(context)
        runtime = {"provider": "openai-codex", "requested_provider": "openai-codex", "api_mode": "codex_responses"}
        defaults = {"tools": {"tool_search": {"enabled": "auto"}}}

        class Agent:
            def __init__(self, **kwargs):
                options.update(kwargs)
                self.model = kwargs["model"]
                self.provider = kwargs["provider"]
                self._fallback_chain = kwargs["fallback_model"]
                self.tools = [{"function": {"name": "onejob_action"}}] if tools else []
                if persistent:
                    self.tools += [{"function": {"name": name}} for name in ["memory", "job_history"]]
                if tools and defaults["tools"]["tool_search"]["enabled"] != "off":
                    self.tools = [{"function": {"name": "tool_search"}}]
                self.valid_tool_names = {t["function"]["name"] for t in self.tools}
                if bad == "model":
                    self.model = "other"
                if bad == "provider":
                    self.provider = "other"
                if bad == "fallback":
                    self._fallback_chain = [{"provider": "other", "model": "other"}]
                if bad == "tools":
                    self.tools.append({"function": {"name": "terminal"}})

            def run_conversation(self, prompt, conversation_history=None):
                calls.append(prompt)
                current = json.loads(prompt.split("\n", 1)[1])
                assert current["evidence"] == ([] if persistent else context["evidence"])
                assert current["plan"] == context["plan"]
                assert self._persist_disabled is not persistent
                assert conversation_history == ([{"role": "user", "content": "Synthetic past"}] if persistent else None)
                assert self.compression_enabled is True
                if tools:
                    for _ in range(2):
                        result = registered["onejob_action"]["handler"]({"tool": "browser.view" if image else "memory.search", "arguments": {"query": "synthetic"}})
                        if image:
                            assert result["_multimodal"] is True
                            assert result["image_data_url"] == "data:image/png;base64,c3ludGhldGlj"
                        else:
                            assert json.loads(result) == {"result": "synthetic evidence"}
                return {"completed": completed, "final_response": '{"reply":"Synthetic result"}', "api_calls": 3}

            def close(self):
                events.append({"closed": True})

        registry = types.SimpleNamespace(register=lambda **kwargs: registered.update({kwargs["name"]: kwargs}))
        resolver = lambda **kwargs: runtime
        modules = {"hermes_cli": types.ModuleType("hermes_cli"),
                   "hermes_cli.config_defaults": types.SimpleNamespace(DEFAULT_CONFIG=defaults),
                   "hermes_cli.runtime_provider": types.SimpleNamespace(resolve_runtime_provider=resolver),
                   "run_agent": types.SimpleNamespace(AIAgent=Agent),
                   "tools": types.ModuleType("tools"), "tools.registry": types.SimpleNamespace(registry=registry),
                   "tools.session_search_tool": types.SimpleNamespace(SESSION_SEARCH_SCHEMA={}),
                   "tools.vision_tools": types.SimpleNamespace(_build_native_vision_tool_result=lambda **kwargs: {"_multimodal": True, **kwargs})}
        def receive():
            return {"id": -1 if mismatch else events[-1]["id"], "result": {"result": "synthetic evidence", **({"image": "data:image/png;base64,c3ludGhldGlj"} if image else {})}}

        db = types.SimpleNamespace(get_messages_as_conversation=lambda *a, **kw: [{"role": "user", "content": "Synthetic past"}],
                                   get_messages=lambda *a, **kw: [{"role": "user", "content": prompt}]) if persistent else None
        import contextlib
        with patch.dict(sys.modules, modules), patch.object(module, "configure_compaction", lambda agent: setattr(agent, "compression_enabled", True)), patch.object(module, "job_session", lambda enabled: contextlib.nullcontext(db)), patch.object(module, "record_tool", side_effect=journals.append), patch.object(module, "recovery_notes", return_value=""):
            if bad or not completed or mismatch:
                with self.assertRaises(RuntimeError):
                    module.run({"tools": ["memory.search"] if tools else [], "persistent": persistent, "instruction": "Synthetic policy", "prompt": prompt}, events.append, receive)
                if bad:
                    self.assertEqual(calls, [])
                self.assertEqual(events[-1], {"closed": True})
                return
            module.run({"tools": ["memory.search"] if tools else [], "persistent": persistent, "instruction": "Synthetic policy", "prompt": prompt}, events.append, receive)
        self.assertEqual(len(calls), 1)
        self.assertEqual(options["model"], "gpt-6-astra")
        self.assertEqual(options["provider"], "openai-codex")
        self.assertEqual(options["fallback_model"], [])
        self.assertEqual(options["enabled_toolsets"], (["onejob"] if tools else []) + (["memory", "job_history"] if persistent else []))
        self.assertEqual(options["session_id"], "onejob" if persistent else None)
        self.assertIs(options["session_db"], db)
        for key in ["skip_context_files", "skip_memory", "skip_background_review"]:
            self.assertIs(options[key], True)
        for key in ["save_trajectories", "checkpoints_enabled"]:
            self.assertIs(options[key], False)
        self.assertEqual([event["id"] for event in events if event.get("event") == "action"], [1, 2] if tools else [])
        self.assertEqual(events[-2]["event"], "result")
        self.assertEqual(events[-1], {"closed": True})
        self.assertNotIn("data:image", json.dumps(journals))

    def test_visual_results_use_native_image_content_not_serialized_pixels(self):
        self.exercise(image=True, persistent=True)

    def test_native_loop_and_no_tools(self):
        self.exercise()
        self.exercise(tools=False)
        self.exercise(persistent=True)
        self.exercise(tools=False, persistent=True)

    def test_fail_closed(self):
        for bad in ["model", "provider", "fallback", "tools"]:
            with self.subTest(bad=bad):
                self.exercise(bad=bad)
        self.exercise(completed=False)
        self.exercise(mismatch=True)

    def test_mutation_proofs(self):
        source = WORKER.read_text()
        mutations = [
            ("agent.model != MODEL", "False", {"bad": "model"}),
            ("agent.provider != PROVIDER", "False", {"bad": "provider"}),
            ("or agent._fallback_chain", "or False", {"bad": "fallback"}),
            ('names != (({TOOL} if tools else set()) | ({"memory", "job_history"} if persistent else set()))', "False", {"bad": "tools"}),
            ('result.get("id") != serial', "False", {"mismatch": True}),
            ('not result.get("completed")', "False", {"completed": False}),
            ('agent._persist_disabled = not persistent', 'agent._persist_disabled = False', {}),
            ('agent._persist_disabled = not persistent', 'agent._persist_disabled = True', {"persistent": True}),
            ('conversation_history=job_history(db)', 'conversation_history=None', {"persistent": True}),
            ('context_prompt(request["prompt"], db)', 'request["prompt"]', {"persistent": True}),
            ('configure_compaction(agent)', 'agent.compression_enabled = False', {}),
            ('skip_memory=True', 'skip_memory=False', {}),
            ('skip_background_review=True', 'skip_background_review=False', {}),
            ('skip_context_files=True', 'skip_context_files=False', {}),
            ('DEFAULT_CONFIG["tools"]["tool_search"] = {"enabled": "off"}', 'DEFAULT_CONFIG["tools"]["tool_search"] = {"enabled": "auto"}', {}),
        ]
        for before, after, kwargs in mutations:
            with self.subTest(mutation=before):
                self.assertIn(before, source)
                module = types.ModuleType("mutated_worker")
                exec(compile(source.replace(before, after), str(WORKER), "exec"), module.__dict__)
                with self.assertRaises((AssertionError, RuntimeError)):
                    self.exercise(module, **kwargs)


if __name__ == "__main__":
    unittest.main()
