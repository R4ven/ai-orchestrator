export type TabId = "orchestrator" | "agentic-team" | "models";

interface SidebarProps {
  tab: TabId;
  onChange: (tab: TabId) => void;
}

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: "orchestrator", label: "Orchestrator", hint: "Step-based workflow" },
  { id: "agentic-team", label: "Agentic Team", hint: "Role-to-role discussion" },
  { id: "models", label: "Local Models", hint: "Ollama / llama.cpp" },
];

export default function Sidebar({ tab, onChange }: SidebarProps): JSX.Element {
  return (
    <nav className="sidebar">
      <div className="brand">AI Orchestrator</div>
      <ul>
        {TABS.map((t) => (
          <li key={t.id}>
            <button className={t.id === tab ? "nav-item active" : "nav-item"} onClick={() => onChange(t.id)}>
              <span className="nav-label">{t.label}</span>
              <span className="nav-hint">{t.hint}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">Desktop • runs entirely offline-capable</div>
    </nav>
  );
}
