"""Bridge process health separately from Hermes's own model-activity clock."""
import threading


class WorkerLiveness:
    def __init__(self, agent, emit, interval=5):
        self.agent, self.emit, self.interval = agent, emit, interval
        self.generation = getattr(agent, "_turn_liveness_activity_generation", None)
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def pulse(self):
        # A live process is not proof of model progress. Hermes's native transport
        # watchdogs still own first-event waits, stalled streams and request limits.
        self.emit({"event": "heartbeat"})
        generation = getattr(self.agent, "_turn_liveness_activity_generation", None)
        if generation != self.generation:
            self.generation = generation
            # Never forward descriptions, reasoning, tokens or provider payloads.
            self.emit({"event": "activity"})

    def _run(self):
        try:
            while not self.stopped.wait(self.interval):
                self.pulse()
        except (BrokenPipeError, OSError) as error:
            self.stopped.set()

    def __enter__(self):
        self.pulse()
        self.thread.start()
        return self

    def __exit__(self, *error):
        self.stopped.set()
        self.thread.join(timeout=1)
