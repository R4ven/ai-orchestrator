import { useEffect, useRef, useState } from "react";
import type { HealthStatus, OrchestratorStepEvent } from "../../../preload/index.js";

interface LogEntry {
  id: number;
  text: string;
  kind: "success" | "failure" | "info";
}

export default function OrchestratorView(): JSX.Element {
  const [agents, setAgents] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [task, setTask] = useState("");
  const [workflow, setWorkflow] = useState("default");
  const [maxIterations, setMaxIterations] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [output, setOutput] = useState("Run a task to see results here.");
  const logCounter = useRef(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const init = await window.api.orchestrator.init();
      setAgents(init.agents);
      setWorkflows(init.workflows);
      setHealth(await window.api.orchestrator.health());

      unsubscribe = window.api.orchestrator.onStep((step: OrchestratorStepEvent) => {
        appendLog(
          `${step.fallback_from ? `${step.fallback_from} -> ` : ""}${step.agent} (${step.task})${step.error ? `: ${step.error}` : ""}`,
          step.success ? "success" : "failure",
        );
      });
    })();

    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function appendLog(text: string, kind: LogEntry["kind"]): void {
    logCounter.current += 1;
    setLog((prev) => [...prev, { id: logCounter.current, text, kind }]);
  }

  async function runTask(): Promise<void> {
    if (!task.trim() || running) return;
    setRunning(true);
    setLog([]);
    setOutput("Running...");
    appendLog(`Started with workflow '${workflow}'`, "info");

    try {
      const results = await window.api.orchestrator.run({
        task: task.trim(),
        workflow,
        maxIterations: maxIterations ? Number(maxIterations) : undefined,
      });
      appendLog(results.success ? "Task completed successfully." : "Task finished with issues.", results.success ? "success" : "failure");
      setOutput(results.final_output ? String(results.final_output) : "(no output)");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      appendLog(`Error: ${message}`, "failure");
      setOutput(`Error: ${message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Orchestrator</h1>
        {health && <span className={`badge ${health.status}`}>{health.status}</span>}
      </header>

      <section className="panel form-panel">
        <label htmlFor="task">Task</label>
        <textarea
          id="task"
          rows={4}
          placeholder="Describe what you want the agents to build..."
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />

        <div className="row">
          <div className="field">
            <label htmlFor="workflow">Workflow</label>
            <select id="workflow" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
              <option value="dynamic">dynamic</option>
              {workflows.map((wf) => (
                <option key={wf} value={wf}>
                  {wf}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="maxIterations">Max iterations</label>
            <input
              id="maxIterations"
              type="number"
              min={1}
              max={10}
              placeholder="default"
              value={maxIterations}
              onChange={(e) => setMaxIterations(e.target.value)}
            />
          </div>
        </div>

        <button onClick={() => void runTask()} disabled={running || !task.trim()}>
          {running ? "Running…" : "Run task"}
        </button>

        <div className="agents-line">
          <span>Available agents:</span>{" "}
          <span className="accent">{agents.length ? agents.join(", ") : "(none available — check Local Models tab)"}</span>
        </div>
      </section>

      <div className="split">
        <section className="panel log-panel">
          <h2>Execution log</h2>
          <div className="log">
            {log.map((entry) => (
              <div key={entry.id} className={`log-entry ${entry.kind}`}>
                {entry.text}
              </div>
            ))}
          </div>
        </section>

        <section className="panel output-panel">
          <h2>Final output</h2>
          <pre>{output}</pre>
        </section>
      </div>
    </div>
  );
}
