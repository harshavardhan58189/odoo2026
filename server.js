// server.js — TransitOps backend API.
//
// Built on Node's built-in `http` module only (no Express / no deps) because
// this environment has no network access to install packages. Everything
// Express would normally give you — routing, JSON body parsing, CORS — is
// hand-rolled below in ~60 lines; the actual endpoint logic lives in
// business.js / auth.js / db.js.
//
// Run:   node server.js
// Then:  http://localhost:3001/          (serves the connected frontend)
//        http://localhost:3001/api/...   (the API itself)

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const db = require("./db");
const auth = require("./auth");
const biz = require("./business");

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------------------------------------------------------------------------
// Tiny router
// ---------------------------------------------------------------------------
const routes = []; // { method, pattern: RegExp, keys: [string], handler }

function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    "^" + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "$"
  );
  routes.push({ method, regex, keys, handler });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) { reject(auth.httpError(413, "Request body too large.")); req.destroy(); }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(auth.httpError(400, "Invalid JSON body.")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// --- Auth ---
route("POST", "/api/auth/login", async (req, res, params, body) => {
  const { email, password, role } = body;
  const result = auth.login(email, password, role);
  sendJson(res, 200, result);
});

route("POST", "/api/auth/logout", async (req, res) => {
  const header = req.headers["authorization"] || "";
  const token = header.split(" ")[1];
  if (token) auth.logout(token);
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/auth/me", async (req, res) => {
  const session = auth.requireAuth(req);
  sendJson(res, 200, { user: { email: session.email, role: session.role }, permissions: auth.PERMS[session.role] });
});

// --- Bootstrap: everything the dashboard needs in one round trip ---
route("GET", "/api/bootstrap", async (req, res) => {
  const session = auth.requireAuth(req);
  sendJson(res, 200, {
    user: { email: session.email, role: session.role },
    permissions: auth.PERMS[session.role],
    vehicles: db.getAll("vehicles"),
    drivers: db.getAll("drivers"),
    trips: db.getAll("trips"),
    maintenance: db.getAll("maintenance"),
    fuelLogs: db.getAll("fuelLogs"),
    expenses: db.getAll("expenses"),
    kpis: biz.computeKpis(),
  });
});

// --- Vehicles ---
route("GET", "/api/vehicles", async (req, res) => {
  auth.requirePermission(req, "vehicles", "read");
  sendJson(res, 200, db.getAll("vehicles"));
});
route("POST", "/api/vehicles", async (req, res, p, body) => {
  auth.requirePermission(req, "vehicles", "write");
  sendJson(res, 201, biz.createVehicle(body));
});
route("PATCH", "/api/vehicles/:id/retire", async (req, res, p) => {
  auth.requirePermission(req, "vehicles", "write");
  sendJson(res, 200, biz.retireVehicle(p.id));
});

// --- Drivers ---
route("GET", "/api/drivers", async (req, res) => {
  auth.requirePermission(req, "drivers", "read");
  sendJson(res, 200, db.getAll("drivers"));
});
route("POST", "/api/drivers", async (req, res, p, body) => {
  auth.requirePermission(req, "drivers", "write");
  sendJson(res, 201, biz.createDriver(body));
});
route("PATCH", "/api/drivers/:id/suspend", async (req, res, p) => {
  auth.requirePermission(req, "drivers", "write");
  sendJson(res, 200, biz.suspendDriver(p.id));
});
route("PATCH", "/api/drivers/:id/reinstate", async (req, res, p) => {
  auth.requirePermission(req, "drivers", "write");
  sendJson(res, 200, biz.reinstateDriver(p.id));
});

// --- Trips ---
route("GET", "/api/trips", async (req, res) => {
  auth.requirePermission(req, "trips", "read");
  sendJson(res, 200, db.getAll("trips"));
});
route("POST", "/api/trips", async (req, res, p, body) => {
  auth.requirePermission(req, "trips", "write");
  sendJson(res, 201, biz.createTrip(body, new Date()));
});
route("PATCH", "/api/trips/:id/dispatch", async (req, res, p) => {
  auth.requirePermission(req, "trips", "write");
  sendJson(res, 200, biz.dispatchTrip(p.id));
});
route("PATCH", "/api/trips/:id/complete", async (req, res, p, body) => {
  auth.requirePermission(req, "trips", "write");
  sendJson(res, 200, biz.completeTrip(p.id, body));
});
route("PATCH", "/api/trips/:id/cancel", async (req, res, p) => {
  auth.requirePermission(req, "trips", "write");
  sendJson(res, 200, biz.cancelTrip(p.id));
});

// --- Maintenance ---
route("GET", "/api/maintenance", async (req, res) => {
  auth.requirePermission(req, "maintenance", "read");
  sendJson(res, 200, db.getAll("maintenance"));
});
route("POST", "/api/maintenance", async (req, res, p, body) => {
  auth.requirePermission(req, "maintenance", "write");
  sendJson(res, 201, biz.createMaintenance(body));
});
route("PATCH", "/api/maintenance/:id/close", async (req, res, p) => {
  auth.requirePermission(req, "maintenance", "write");
  sendJson(res, 200, biz.closeMaintenance(p.id));
});

// --- Fuel logs ---
route("GET", "/api/fuel-logs", async (req, res) => {
  auth.requirePermission(req, "fuel", "read");
  sendJson(res, 200, db.getAll("fuelLogs"));
});
route("POST", "/api/fuel-logs", async (req, res, p, body) => {
  auth.requirePermission(req, "fuel", "write");
  sendJson(res, 201, biz.createFuelLog(body));
});

// --- Expenses ---
route("GET", "/api/expenses", async (req, res) => {
  auth.requirePermission(req, "fuel", "read");
  sendJson(res, 200, db.getAll("expenses"));
});
route("POST", "/api/expenses", async (req, res, p, body) => {
  auth.requirePermission(req, "fuel", "write");
  sendJson(res, 201, biz.createExpense(body));
});

// --- Reports ---
route("GET", "/api/reports/kpis", async (req, res) => {
  auth.requirePermission(req, "reports", "read");
  sendJson(res, 200, biz.computeKpis());
});
route("GET", "/api/reports/per-vehicle", async (req, res) => {
  auth.requirePermission(req, "reports", "read");
  sendJson(res, 200, biz.perVehicleReport());
});
route("GET", "/api/reports/export.csv", async (req, res) => {
  auth.requirePermission(req, "reports", "write");
  const csv = biz.exportCsv();
  res.writeHead(200, {
    "Content-Type": "text/csv",
    "Content-Disposition": 'attachment; filename="transitops_report.csv"',
  });
  res.end(csv);
});

// --- Dev convenience: reset the DB back to seed data ---
route("POST", "/api/dev/reset", async (req, res) => {
  sendJson(res, 200, db.reset());
});

// ---------------------------------------------------------------------------
// Static file serving for the connected frontend (avoids CORS entirely)
// ---------------------------------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  // CORS (harmless even though we serve same-origin; useful if the frontend
  // is ever hosted separately, e.g. a static host + this API elsewhere)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

  const match = routes.find((r) => r.method === req.method && r.regex.test(pathname));
  if (!match) return sendJson(res, 404, { error: "No such route: " + req.method + " " + pathname });

  try {
    const values = match.regex.exec(pathname).slice(1);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]));
    const body = (req.method === "POST" || req.method === "PATCH") ? await readBody(req) : {};
    await match.handler(req, res, params, body);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`TransitOps API listening on http://localhost:${PORT}`);
});
