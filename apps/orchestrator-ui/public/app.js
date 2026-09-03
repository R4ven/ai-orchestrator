const socket = io();

const taskEl = document.getElementById("task");
const workflowEl = document.getElementById("workflow");
const maxIterationsEl = document.getElementById("maxIterations");
const runBtn = document.getElementById("runBtn");
const logEl = document.getElementById("log");
const outputEl = document.getElementById("output");
const agentsListEl = document.getElementById("agentsList");
const healthBadgeEl = document.getElementById("healthBadge");

async function loadInitialData() {
  const [agents, workflows, health] = await Promise.all([
    fetch("/api/agents").then((r) => r.json()),
    fetch("/api/workflows").then((r) => r.json()),
    fetch("/api/health").then((r) => r.json()),
  ]);

  agentsListEl.textContent = agents.length ? agents.join(", ") : "(none available)";

  workflowEl.innerHTML = "";
  for (const wf of ["dynamic", ...workflows]) {
    const opt = document.createElement("option");
    opt.value = wf;
    opt.textContent = wf;
    if (wf === "default") opt.selected = true;
    workflowEl.appendChild(opt);
  }

  healthBadgeEl.textContent = health.status;
  healthBadgeEl.className = "badge " + health.status;
}

function appendLog(text, kind) {
  const div = document.createElement("div");
  div.className = "log-entry" + (kind ? " " + kind : "");
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

runBtn.addEventListener("click", () => {
  const task = taskEl.value.trim();
  if (!task) return;

  logEl.innerHTML = "";
  outputEl.textContent = "Running...";
  runBtn.disabled = true;

  socket.emit("run_task", {
    task,
    workflow: workflowEl.value,
    maxIterations: maxIterationsEl.value ? Number(maxIterationsEl.value) : undefined,
  });
});

socket.on("task_started", ({ workflow }) => {
  appendLog("Started with workflow '" + workflow + "'");
});

socket.on("step", (step) => {
  const label = (step.fallback_from ? step.fallback_from + " -> " : "") + step.agent + " (" + step.task + ")";
  appendLog((step.success ? "✓ " : "✗ ") + label + (step.error ? ": " + step.error : ""), step.success ? "success" : "failure");
});

socket.on("task_complete", (results) => {
  runBtn.disabled = false;
  appendLog(results.success ? "Task completed successfully." : "Task finished with issues.", results.success ? "success" : "failure");
  outputEl.textContent = results.final_output ? String(results.final_output) : "(no output)";
});

socket.on("task_error", ({ error }) => {
  runBtn.disabled = false;
  appendLog("Error: " + error, "failure");
  outputEl.textContent = "Error: " + error;
});

loadInitialData().catch((e) => appendLog("Failed to load initial data: " + e, "failure"));
