const socket = io();

const taskEl = document.getElementById("task");
const maxTurnsEl = document.getElementById("maxTurns");
const runBtn = document.getElementById("runBtn");
const logEl = document.getElementById("log");
const outputEl = document.getElementById("output");
const rosterEl = document.getElementById("roster");
const validBadgeEl = document.getElementById("validBadge");

async function loadInitialData() {
  const [teamConfig, validation] = await Promise.all([
    fetch("/api/team-config").then((r) => r.json()),
    fetch("/api/validate").then((r) => r.json()),
  ]);

  rosterEl.innerHTML = "";
  for (const [roleName, spec] of Object.entries(teamConfig.roles || {})) {
    const span = document.createElement("span");
    span.className = "role";
    span.textContent = roleName + " -> " + (spec.agent || "unassigned") + (roleName === teamConfig.lead_role ? " (lead)" : "");
    rosterEl.appendChild(span);
  }

  validBadgeEl.textContent = validation.valid ? "bindings valid" : "bindings invalid: " + validation.reason;
  validBadgeEl.className = "badge " + (validation.valid ? "valid" : "invalid");
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
  outputEl.textContent = "Team is working...";
  runBtn.disabled = true;

  socket.emit("run_task", {
    task,
    maxTurns: maxTurnsEl.value ? Number(maxTurnsEl.value) : undefined,
  });
});

socket.on("task_started", () => {
  appendLog("Team session started.");
});

socket.on("turn", (step) => {
  const arrow = step.to_role === "user" ? "-> user" : "-> " + step.to_role;
  const kind = step.action === "finalize" ? "finalize" : step.success ? "" : "failure";
  appendLog("[turn " + step.turn + "] " + step.from_role + " " + arrow + " (" + step.action + ")" + (step.error ? ": " + step.error : ""), kind);
});

socket.on("task_complete", (result) => {
  runBtn.disabled = false;
  appendLog(result.success ? "Team finalized the task." : "Team stopped without a clean finalize.", result.success ? "finalize" : "failure");
  outputEl.textContent = result.final_output || "(no output)";
});

socket.on("task_error", ({ error }) => {
  runBtn.disabled = false;
  appendLog("Error: " + error, "failure");
  outputEl.textContent = "Error: " + error;
});

loadInitialData().catch((e) => appendLog("Failed to load initial data: " + e, "failure"));
