export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Context Dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #0b0f14; color: #e6edf3; }
  header { padding: 1.5rem 2rem; border-bottom: 1px solid #22303c; display: flex; align-items: center; justify-content: space-between; }
  h1 { font-size: 1.25rem; margin: 0; font-weight: 600; }
  main { padding: 2rem; max-width: 1100px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #161b22; border: 1px solid #22303c; border-radius: 10px; padding: 1rem 1.25rem; }
  .card h2 { margin: 0 0 0.5rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; }
  .card .value { font-size: 1.8rem; font-weight: 700; }
  .badge { display: inline-block; font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #1f6feb33; color: #58a6ff; margin-left: 0.5rem; }
  .badge.off { background: #f8514933; color: #ff7b72; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #22303c; font-size: 0.85rem; }
  th { color: #8b949e; text-transform: uppercase; font-size: 0.7rem; }
  input[type="text"] { width: 100%; padding: 0.6rem 0.8rem; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font-size: 0.95rem; }
  .search-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .search-row select { background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 0.6rem; }
  #results tr:hover { background: #1c2733; }
</style>
</head>
<body>
<header>
  <h1>Context Dashboard</h1>
  <span id="lastUpdated" style="color:#8b949e;font-size:0.8rem;"></span>
</header>
<main>
  <div class="cards" id="statsCards"></div>

  <div class="search-row">
    <input id="query" type="text" placeholder="Search across both context graphs..." />
    <select id="source">
      <option value="both">Both</option>
      <option value="orchestrator">Orchestrator</option>
      <option value="agentic_team">Agentic Team</option>
    </select>
  </div>
  <table>
    <thead><tr><th>Source</th><th>Type</th><th>Title</th><th>Score</th></tr></thead>
    <tbody id="results"></tbody>
  </table>
</main>
<script>
  async function loadStats() {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const cards = document.getElementById('statsCards');
    cards.innerHTML = '';
    for (const [source, info] of Object.entries(data)) {
      const card = document.createElement('div');
      card.className = 'card';
      const badge = info.available
        ? '<span class="badge">available</span>'
        : '<span class="badge off">unavailable</span>';
      const total = info.available
        ? Object.values(info.nodeCounts || {}).reduce((a, b) => a + b, 0)
        : 0;
      card.innerHTML = '<h2>' + source.replace('_', ' ') + badge + '</h2><div class="value">' + total + '</div>';
      cards.appendChild(card);
    }
    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  async function runSearch() {
    const q = document.getElementById('query').value.trim();
    const source = document.getElementById('source').value;
    const tbody = document.getElementById('results');
    if (!q) { tbody.innerHTML = ''; return; }
    const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&source=' + source);
    const rows = await res.json();
    tbody.innerHTML = rows.map(r =>
      '<tr><td>' + r.source + '</td><td>' + r.type + '</td><td>' + (r.title || '(untitled)') + '</td><td>' + r.score.toFixed(2) + '</td></tr>'
    ).join('');
  }

  document.getElementById('query').addEventListener('input', () => {
    clearTimeout(window.__searchTimer);
    window.__searchTimer = setTimeout(runSearch, 250);
  });
  document.getElementById('source').addEventListener('change', runSearch);

  loadStats();
  setInterval(loadStats, 15000);
</script>
</body>
</html>
`;
