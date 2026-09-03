import { useState } from "react";
import Sidebar, { type TabId } from "./components/Sidebar.js";
import OrchestratorView from "./components/OrchestratorView.js";
import AgenticTeamView from "./components/AgenticTeamView.js";
import LocalModelsPanel from "./components/LocalModelsPanel.js";

export default function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>("orchestrator");

  return (
    <div className="app">
      <Sidebar tab={tab} onChange={setTab} />
      <main className="app-main">
        {tab === "orchestrator" && <OrchestratorView />}
        {tab === "agentic-team" && <AgenticTeamView />}
        {tab === "models" && <LocalModelsPanel />}
      </main>
    </div>
  );
}
