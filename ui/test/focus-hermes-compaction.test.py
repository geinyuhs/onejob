"""Synthetic route and summary-failure proofs; never reads credentials."""
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1] / "server/focus"))
import hermes_compaction


class CompactionTests(unittest.TestCase):
    def exercise(self, configure=hermes_compaction.configure_compaction):
        calls = []
        response = types.SimpleNamespace(choices=[types.SimpleNamespace(finish_reason="stop")], text="Synthetic durable summary")
        def create(**kwargs):
            calls.append(kwargs)
            return response
        real = object()
        def adapter(client, model):
            self.assertIs(client, real)
            self.assertEqual(model, "gpt-6-astra")
            return types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create)))
        agent = types.SimpleNamespace(model="gpt-6-astra", provider="openai-codex", api_mode="codex_responses", _fallback_chain=[],
                                      client=real, reasoning_config={"effort": "high"}, context_compressor=types.SimpleNamespace())
        module = types.SimpleNamespace(CodexAuxiliaryClient=adapter, extract_content_or_reasoning=lambda value, **kwargs: value.text)
        with patch.dict(sys.modules, {"agent.auxiliary_client": module}):
            configure(agent)
            self.assertTrue(agent.compression_enabled)
            self.assertTrue(agent.context_compressor.abort_on_summary_failure)
            summarize = agent.context_compressor._call_summary_llm
            self.assertEqual(summarize("Synthetic history", 0), response.text)
            self.assertEqual(calls[-1]["extra_body"], {"reasoning": {"effort": "high"}})
            for field, value in [("model", "other"), ("provider", "other"), ("api_mode", "other"), ("_fallback_chain", ["other"])]:
                old = getattr(agent, field)
                setattr(agent, field, value)
                before = len(calls)
                with self.assertRaises(RuntimeError):
                    summarize("Synthetic history", 0)
                self.assertEqual(len(calls), before)
                setattr(agent, field, old)
            for text, finish in [("", "stop"), ("Partial", "length")]:
                response.text, response.choices[0].finish_reason = text, finish
                with self.assertRaises(RuntimeError):
                    summarize("Synthetic history", 0)

    def test_pinned_route_and_complete_summary(self):
        self.exercise()

    def test_mutation_proofs(self):
        source = Path(hermes_compaction.__file__).read_text()
        for before, after in [
            ('agent.model != "gpt-6-astra"', 'False'),
            ('agent.provider != "openai-codex"', 'False'),
            ('agent.api_mode != "codex_responses"', 'False'),
            ('or agent._fallback_chain', 'or False'),
            ('if not content.strip() or response.choices[0].finish_reason == "length":', 'if False:'),
            ('compressor.abort_on_summary_failure = True', 'compressor.abort_on_summary_failure = False'),
        ]:
            with self.subTest(before=before):
                self.assertIn(before, source)
                broken = types.ModuleType("broken_compaction")
                exec(compile(source.replace(before, after), "broken_compaction", "exec"), broken.__dict__)
                with self.assertRaises(AssertionError):
                    self.exercise(broken.configure_compaction)


if __name__ == "__main__":
    unittest.main()
