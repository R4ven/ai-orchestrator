#!/usr/bin/env node
/** Context Dashboard entry point. */
import { startDashboard } from "./app.js";

const port = process.env.PORT ? Number(process.env.PORT) : 5003;
startDashboard({ port });

export { createDashboardApp, startDashboard } from "./app.js";
