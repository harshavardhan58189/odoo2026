// auth.js — bearer-token sessions + role-based permission matrix.
// This is a demo-grade auth layer (matches the frontend's "any email +
// 4-char password" login), but it moves permission ENFORCEMENT server-side,
// which the original client-only app didn't have — the client could edit
// state directly with no real access control. Here, every write route is
// checked against PERMS before it touches the DB.

const crypto = require("crypto");

const ROLES = ["Fleet Manager", "Driver", "Safety Officer", "Financial Analyst"];

const PERMS = {
  "Fleet Manager":     { vehicles: "write", drivers: "read",  trips: "read",  maintenance: "write", fuel: "read",  reports: "read"  },
  "Driver":            { vehicles: "read",  drivers: "read",  trips: "write", maintenance: "read",  fuel: "write", reports: "read"  },
  "Safety Officer":    { vehicles: "read",  drivers: "write", trips: "read",  maintenance: "read",  fuel: "read",  reports: "read"  },
  "Financial Analyst": { vehicles: "read",  drivers: "read",  trips: "read",  maintenance: "read",  fuel: "write", reports: "write" },
};

// token -> { email, role, createdAt }
const sessions = new Map();

function login(email, password, role) {
  if (!email || !email.includes("@")) throw httpError(400, "Enter a valid email address.");
  if (!password || password.length < 4) throw httpError(400, "Password must be at least 4 characters.");
  if (!ROLES.includes(role)) throw httpError(400, "Unknown role: " + role);

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { email, role, createdAt: Date.now() });
  return { token, user: { email, role } };
}

function logout(token) {
  sessions.delete(token);
}

function sessionFor(req) {
  const header = req.headers["authorization"] || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return sessions.get(token) || null;
}

function requireAuth(req) {
  const session = sessionFor(req);
  if (!session) throw httpError(401, "Missing or invalid session token.");
  return session;
}

function requirePermission(req, area, level) {
  const session = requireAuth(req);
  const granted = PERMS[session.role][area];
  const ok = level === "read" ? (granted === "read" || granted === "write") : granted === "write";
  if (!ok) throw httpError(403, session.role + " does not have " + level + " access to " + area + ".");
  return session;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { ROLES, PERMS, login, logout, sessionFor, requireAuth, requirePermission, httpError };
