"""Small process adapter. Hermes owns the conversation/tool loop; onejob owns IO."""
import contextlib
import json
import sys
import threading
import os
from hermes_session import job_session, job_history, record_tool, recovery_notes, scoped_session_search
from hermes_liveness import WorkerLiveness
from hermes_compaction import configure_compaction
from hermes_context import context_prompt

MODEL = "gpt-6-astra"
PROVIDER = "openai-codex"
TOOL = "onejob_action"


def check_agent(agent, tools, persistent=False):
    names = {item["function"]["name"] for item in agent.tools}
    if (agent.model != MODEL or agent.provider != PROVIDER
            or agent._fallback_chain or names != (({TOOL} if tools else set()) | ({"memory", "job_history"} if persistent else set()))):
        raise RuntimeError("Unexpected Hermes model or tool configuration")


def run(request, emit, receive):
    with job_session(request.get("persistent", False)) as db:
        return run_agent(request, emit, receive, db)


def run_agent(request, emit, receive, db):
    from hermes_cli.config_defaults import DEFAULT_CONFIG
    # Private process defaults: expose the one app bridge directly, not Hermes's
    # generic discovery wrapper. User config is ignored by the launch environment.
    DEFAULT_CONFIG["tools"]["tool_search"] = {"enabled": "off"}
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from run_agent import AIAgent
    from tools.registry import registry

    tools = request["tools"]
    persistent = request.get("persistent", False)
    lock = threading.Lock()
    serial = 0

    def action(args, **kwargs):
        nonlocal serial
        with lock:
            serial += 1
            if persistent:
                record_tool({"request": args})
            emit({"event": "action", "id": serial, "action": args})
            result = receive()
            if result.get("id") != serial:
                raise RuntimeError("Mismatched tool result")
            outcome = result["result"]
            image = outcome.pop("image", None)
            if persistent:
                record_tool({"result": outcome})
            if image:
                if args.get("tool") != "browser.view" or not image.startswith("data:image/"):
                    raise RuntimeError("Unexpected visual tool result")
                from tools.vision_tools import _build_native_vision_tool_result
                visual = _build_native_vision_tool_result(
                    image_url="job-owned browser page", question=json.dumps(outcome),
                    image_data_url=image, image_size_bytes=len(image) * 3 // 4,
                )
                return visual
            return json.dumps(outcome)

    if tools:
        registry.register(name=TOOL, toolset="onejob", handler=action, schema={
            "name": TOOL,
            "description": "Run one tool from the supplied onejob catalog. The app handles approval and returns evidence.",
            "parameters": {"type": "object", "required": ["tool", "arguments"],
                           "additionalProperties": False,
                           "properties": {"tool": {"type": "string", "enum": tools},
                                          "arguments": {"type": "object"}}},
        })
    if persistent:
        from tools.session_search_tool import SESSION_SEARCH_SCHEMA
        # A separate name avoids Hermes's inline session_search dispatcher, which
        # intentionally supports cross-profile recall. Delegate to its search only
        # after our job-local checks, through the ordinary registry path.
        schema = {**SESSION_SEARCH_SCHEMA, "name": "job_history"}
        registry.register(name="job_history", toolset="job_history", schema=schema,
                          handler=lambda args, **kwargs: scoped_session_search(args, db))
    runtime = resolve_runtime_provider(requested=PROVIDER, target_model=MODEL)
    agent = AIAgent(
        model=MODEL, provider=runtime.get("provider"),
        requested_provider=runtime.get("requested_provider"), api_mode=runtime.get("api_mode"),
        api_key=runtime.get("api_key"), base_url=runtime.get("base_url"),
        credential_pool=runtime.get("credential_pool"), fallback_model=[],
        enabled_toolsets=(["onejob"] if tools else []) + (["memory", "job_history"] if persistent else []),
        skip_context_files=True, skip_memory=True, skip_background_review=True,
        save_trajectories=False, checkpoints_enabled=False, quiet_mode=True,
        reasoning_config={"effort": request.get("reasoningEffort") or "medium"},
        step_callback=lambda *args: emit({"event": "progress"}),
        stream_delta_callback=lambda *args: emit({"event": "progress"}),
        reasoning_callback=lambda *args: emit({"event": "progress"}),
        ephemeral_system_prompt=request["instruction"],
        session_id="onejob" if persistent else None, session_db=db,
    )
    try:
        # Built-in job memory is enabled by its toolset; skip_memory=True keeps
        # external memory providers disabled. Compaction reuses this same model.
        agent._persist_disabled = not persistent
        check_agent(agent, tools, persistent)
        configure_compaction(agent)
        emit({"event": "ready", "model": agent.model, "provider": agent.provider,
              "tools": sorted(agent.valid_tool_names), "fallbacks": len(agent._fallback_chain)})
        with WorkerLiveness(agent, emit):
            result = agent.run_conversation(context_prompt(request["prompt"], db) + (recovery_notes() if persistent else ""),
                                            conversation_history=job_history(db))
        check_agent(agent, tools, persistent)
        if not result.get("completed"):
            raise RuntimeError("Hermes did not complete the run")
        emit({"event": "result", "text": result.get("final_response", ""),
              "model": agent.model, "provider": agent.provider, "apiCalls": result.get("api_calls")})
    finally:
        agent.close()


def main():
    os.umask(0o077)
    sys.path.insert(0, sys.argv[1])
    output = sys.stdout
    output_lock = threading.Lock()

    def emit(value):
        with output_lock:
            output.write(json.dumps(value) + "\n")
            output.flush()

    def receive():
        return json.loads(sys.stdin.readline())

    # Upstream banners/logging must never corrupt the app's JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            run(receive(), emit, receive)
        except Exception as error:
            # Errors may contain page data or credentials. Send a category, not the exception.
            emit({"event": "error", "category": type(error).__name__})
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
