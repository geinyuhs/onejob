"""Keep Hermes's native compactor on the already authorized model/client."""


def configure_compaction(agent):
    from agent.auxiliary_client import CodexAuxiliaryClient, extract_content_or_reasoning

    def check_route():
        if (agent.model != "gpt-6-astra" or agent.provider != "openai-codex"
                or agent.api_mode != "codex_responses" or agent._fallback_chain):
            raise RuntimeError("Unexpected context compression route")

    check_route()
    compressor = agent.context_compressor

    def summarize(prompt, prompt_started_at):
        check_route()
        # Use Hermes's Responses adapter directly. Its generic auxiliary router
        # can fall back to other configured providers, even with an explicit model.
        client = CodexAuxiliaryClient(agent.client, agent.model)
        response = client.chat.completions.create(
            model=agent.model, messages=[{"role": "user", "content": prompt}],
            extra_body={"reasoning": agent.reasoning_config},
        )
        content = extract_content_or_reasoning(response, max_reasoning_chars=8000)
        if not content.strip() or response.choices[0].finish_reason == "length":
            raise RuntimeError("Context compression returned an incomplete summary")
        return content

    compressor._call_summary_llm = summarize
    compressor.summary_model = agent.model
    # Failed summaries must leave the original turns intact, not replace them
    # with the native engine's optional static fallback marker.
    compressor.abort_on_summary_failure = True
    agent.compression_enabled = True
