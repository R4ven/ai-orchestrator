# Deployment

This TypeScript rebuild ships Docker, Docker Compose, Kubernetes, and systemd
configs for the four long-running services:

| Service | Port | Entry point |
|---|---|---|
| Orchestrator UI | 5001 | `apps/orchestrator-ui/dist/server.js` |
| Agentic Team UI | 5002 | `apps/agentic-team-ui/dist/server.js` |
| Context Dashboard | 5003 | `packages/context-dashboard/dist/index.js` |
| MCP Server | stdio | `packages/mcp-server/dist/index.js` |

## Docker Compose (recommended)

```bash
docker compose up --build -d              # orchestrator-ui, agentic-team-ui, context-dashboard
docker compose --profile mcp up --build   # + mcp-server (stdio; typically run on demand, not long-running)
docker compose --profile monitoring up -d # + Prometheus (:9091) and Grafana (:3000)
docker compose down
```

Each service reads its own `agents.yaml` from `packages/<orchestrator|agentic-team>/config/`,
mounted read-only into the container. Context-graph databases persist in the
named volumes `orchestrator-context` and `agentic-team-context`.

## Kubernetes

```bash
kubectl create namespace ai-orchestrator
kubectl apply -f deployment/kubernetes/
kubectl get pods -n ai-orchestrator
```

Includes `configmap.yaml`, `deployment.yaml` (orchestrator-ui, agentic-team-ui,
context-dashboard), `service.yaml`, `hpa.yaml`, and `ingress.yaml`. Build and
push the image first (`docker build -t <registry>/ai-orchestrator:latest .`)
and update the `image:` field in `deployment.yaml` accordingly. Persistent
context-graph storage (PVCs) and secrets management are left to your cluster's
conventions — add a `PersistentVolumeClaim` and mount it over
`/home/appuser/.ai-orchestrator` / `/home/appuser/.agentic-team` if you need
the graph memory to survive pod restarts.

## systemd (bare-metal / VM)

```bash
sudo useradd -r -m -s /bin/bash appuser   # if it doesn't already exist
sudo mkdir -p /opt/ai-orchestrator /var/log/ai-orchestrator
sudo cp -r . /opt/ai-orchestrator
cd /opt/ai-orchestrator && npm install && npm run build

sudo cp deployment/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orchestrator-ui agentic-team-ui context-dashboard mcp-server
```

## Building the image directly

```bash
docker build -t ai-orchestrator:latest .
docker run --rm -p 5001:5001 -e PORT=5001 ai-orchestrator:latest \
  node apps/orchestrator-ui/dist/server.js
```

## Monitoring

`apps/orchestrator-ui` exposes Prometheus metrics at `/metrics`
(`orchestrator_*` counters/histograms — tasks, agent calls, cache hits, etc.,
via `prom-client`). Point `deployment/monitoring/prometheus.yml` (already
wired into the `monitoring` compose profile) at it, or your own Prometheus
instance.

## Scope note

The original project also ships Azure/Terraform, HAProxy/NGINX load-balancer
configs, and blue-green/canary rollout scripts. Those weren't ported in this
pass — Docker Compose, plain Kubernetes manifests, and systemd units cover the
common self-hosting paths; the cloud-specific and progressive-delivery pieces
are a reasonable follow-up once the core rebuild has seen real usage.
