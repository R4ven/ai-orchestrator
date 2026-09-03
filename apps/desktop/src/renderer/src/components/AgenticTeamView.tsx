import { useEffect, useRef, useState } from "react";
import type { TeamConfig, TeamStepEvent, TeamValidationResult } from "../../../preload/index.js";

interface LogEntry {
  id: number;
  text: string;
  kind: "finalize" | "failure" | "info";
}

export default function AgenticTeamView(): JSX.Element {
  const [teamConfig, setTeamConfig] = useState<TeamConfig | null>(null);
  const [validation, setValidation] = useState<TeamValidationResult | null>(null);
  const [task, setTask] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [output, setOutput] = useState("Start a task to see the team's final response here.");
  const logCounter = useRef(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const init = await window.api.agenticTeam.init();
      setTeamConfig(init.teamConfig);
      setValidation(init.validation);

      unsubscribe = window.api.agenticTeam.onTurn((step: TeamStepEvent) => {
        const arrow = step.to_role === "user" ? "-> user" : `-> ${step.to_role}`;
        appendLog(
          `[turn ${step.turn}] ${step.from_role} ${arrow} (${step.action})${step.error ? `: ${step.error}` : ""}`,
          step.action === "finalize" ? "finalize" : step.success ? "info" : "failure",
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
    setOutput("Team is working...");
    appendLog("Team session started.", "info");

    try {
      const result = await window.api.agenticTeam.run({ task: task.trim(), maxTurns: maxTurns ? Number(maxTurns) : undefined });
      appendLog(result.success ? "Team finalized the task." : "Team stopped without a clean finalize.", result.success ? "finalize" : "failure");
      setOutput(result.final_output || "(no output)");
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
        <h1>Agentic Team</h1>
        {validation && (
          <span className={`badge ${validation.valid ? "healthy" : "unhealthy"}`}>
            {validation.valid ? "bindings valid" : `bindings invalid: ${validation.reason}`}
          </span>
        )}
      </header>

      <section className="panel form-panel">
        <label htmlFor="team-task">Task</label>
        <textarea
          id="team-task"
          rows={4}
          placeholder="Describe what you want the team to build..."
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />

        <div className="row">
          <div className="field field-narrow">
            <label htmlFor="maxTurns">Max turns</label>
            <input
              id="maxTurns"
              type="number"
              min={1}
              max={50}
              placeholder={teamConfig ? `default (${teamConfig.max_turns})` : "default"}
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
            />
          </div>
        </div>

        <button className="accent-button" onClick={() => void runTask()} disabled={running || !task.trim()}>
          {running ? "Working…" : "Start team"}
        </button>

        {teamConfig && (
          <div className="roster">
            {Object.entries(teamConfig.roles).map(([roleName, spec]) => (
              <span key={roleName} className="role-chip">
                {roleName} → {spec.agent ?? "unassigned"}
                {roleName === teamConfig.lead_role ? " (lead)" : ""}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="split">
        <section className="panel log-panel">
          <h2>Team conversation</h2>
          <div className="log">
            {log.map((entry) => (
              <div key={entry.id} className={`log-entry ${entry.kind}`}>
                {entry.text}
              </div>
            ))}
          </div>
        </section>

        <section className="panel output-panel">
          <h2>Final deliverable</h2>
          <pre>{output}</pre>
        </section>
      </div>
    </div>
  );
}
