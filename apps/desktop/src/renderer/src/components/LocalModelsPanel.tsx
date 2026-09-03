import { useEffect, useState } from "react";

export default function LocalModelsPanel(): JSX.Element {
  const [endpoint, setEndpoint] = useState("http://localhost:11434");
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [pullTarget, setPullTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      const [isHealthy, modelList] = await Promise.all([window.api.ollama.health(endpoint), window.api.ollama.listModels(endpoint)]);
      setHealthy(isHealthy);
      setModels(modelList);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pullModel(): Promise<void> {
    if (!pullTarget.trim()) return;
    setBusy(true);
    setStatus(`Pulling '${pullTarget}'... this can take a while for large models.`);
    try {
      const result = await window.api.ollama.pullModel(pullTarget.trim(), endpoint);
      setStatus(result.success ? result.output : `Failed: ${result.error}`);
      if (result.success) {
        setPullTarget("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeModel(model: string): Promise<void> {
    setBusy(true);
    setStatus(`Removing '${model}'...`);
    try {
      const result = await window.api.ollama.removeModel(model, endpoint);
      setStatus(result.success ? result.output : `Failed: ${result.error}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Local Models</h1>
        {healthy !== null && <span className={`badge ${healthy ? "healthy" : "unhealthy"}`}>{healthy ? "Ollama reachable" : "Ollama unreachable"}</span>}
      </header>

      <section className="panel form-panel">
        <p className="hint">
          Local models run fully offline via <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> — no cloud CLI or API key
          required. The Orchestrator and Agentic Team both use <code>local-code</code> / <code>local-instruct</code> automatically when a cloud
          agent isn't configured or reachable.
        </p>

        <div className="row">
          <div className="field">
            <label htmlFor="endpoint">Ollama endpoint</label>
            <input id="endpoint" type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </div>
        </div>
        <button onClick={() => void refresh()} disabled={busy}>
          {busy ? "Checking…" : "Refresh"}
        </button>
      </section>

      <section className="panel">
        <h2>Installed models</h2>
        {models.length === 0 && <p className="hint">No models found. Pull one below, or run `ollama pull &lt;model&gt;` yourself.</p>}
        <ul className="model-list">
          {models.map((model) => (
            <li key={model}>
              <span>{model}</span>
              <button className="link-button" onClick={() => void removeModel(model)} disabled={busy}>
                remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Pull a model</h2>
        <div className="row">
          <input
            type="text"
            placeholder="e.g. codellama:13b, mistral:7b-instruct"
            value={pullTarget}
            onChange={(e) => setPullTarget(e.target.value)}
          />
          <button onClick={() => void pullModel()} disabled={busy || !pullTarget.trim()}>
            Pull
          </button>
        </div>
        {status && <p className="hint status-line">{status}</p>}
      </section>
    </div>
  );
}
