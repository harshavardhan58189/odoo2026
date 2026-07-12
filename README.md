# TransitOps Backend

A custom REST API backend for the TransitOps frontend. Every piece of business
logic that used to live only in the browser (trip lifecycle rules, license
expiry checks, cargo/max-load validation, role permissions, KPI/report math)
now runs **server-side**, so it can't be bypassed by editing client code or
calling the API directly with a modified request.

## Why no Express / no database driver?

This was built in a sandboxed environment with no access to the npm
registry, so it's dependency-free by necessity: just Node's built-in `http`
module for the server/router, and a JSON file for storage. It's a genuine,
working REST API — not a mock — but if you're taking this to production I'd
swap two things:

1. **`db.js`** → replace with a real database (Postgres, MySQL, Mongo...).
   Every other file only calls `db.getAll / findById / insert / update`, so
   this is a contained swap.
2. **`server.js`** router → optionally move to Express/Fastify once you have
   npm access; the route handlers themselves (in `server.js`, calling into
   `business.js`) can move over almost unchanged.

## Running it

```bash
cd transitops-backend
node server.js
```

Then open **http://localhost:3001** — that's the connected frontend, served
by this same server so there's no CORS to deal with. The API itself lives
under `http://localhost:3001/api/*`.

No `npm install` step is needed — there are zero dependencies.

## Project layout

```
server.js      HTTP server, routing, request/response plumbing
auth.js        Bearer-token sessions + the role → permission matrix (RBAC)
business.js    Domain rules: trip lifecycle, KPIs, per-vehicle report, CSV export
db.js          JSON-file persistence (data/db.json), swap-out point for a real DB
public/        The frontend (index.html), now wired to call the API via fetch()
data/db.json   Auto-created on first run, seeded with the original demo data
```

## Auth model

Login is intentionally the same "demo" auth the original frontend had — any
email + a 4+ character password, plus a chosen role — but now the server
issues a real bearer token and **enforces** the permission matrix on every
write route, rather than just hiding buttons in the UI:

```
Fleet Manager     — vehicles: write, maintenance: write, others: read
Driver            — trips: write, fuel: write, others: read
Safety Officer    — drivers: write, others: read
Financial Analyst — fuel: write, reports: write, others: read
```

`POST /api/auth/login` → `{ token, user }`. Send the token back as
`Authorization: Bearer <token>` on every subsequent request. Sessions live in
memory and reset if the server restarts.

## API reference

| Method | Path                              | Access          | Notes |
|--------|------------------------------------|-----------------|-------|
| POST   | `/api/auth/login`                  | public          | `{email, password, role}` |
| POST   | `/api/auth/logout`                 | authenticated   | |
| GET    | `/api/auth/me`                     | authenticated   | current user + permissions |
| GET    | `/api/bootstrap`                   | authenticated   | user + all collections + KPIs, one call |
| GET    | `/api/vehicles`                    | vehicles:read   | |
| POST   | `/api/vehicles`                    | vehicles:write  | validates unique `reg` |
| PATCH  | `/api/vehicles/:id/retire`         | vehicles:write  | |
| GET    | `/api/drivers`                     | drivers:read    | |
| POST   | `/api/drivers`                     | drivers:write   | |
| PATCH  | `/api/drivers/:id/suspend`         | drivers:write   | |
| PATCH  | `/api/drivers/:id/reinstate`       | drivers:write   | |
| GET    | `/api/trips`                       | trips:read      | |
| POST   | `/api/trips`                       | trips:write     | checks vehicle/driver availability, license expiry, max load |
| PATCH  | `/api/trips/:id/dispatch`          | trips:write     | Draft → Dispatched |
| PATCH  | `/api/trips/:id/complete`          | trips:write     | Dispatched → Completed; auto-logs fuel if `fuelUsed > 0` |
| PATCH  | `/api/trips/:id/cancel`            | trips:write     | reverts vehicle/driver to Available if it was Dispatched |
| GET    | `/api/maintenance`                 | maintenance:read| |
| POST   | `/api/maintenance`                 | maintenance:write| opens record, moves vehicle to "In Shop" |
| PATCH  | `/api/maintenance/:id/close`       | maintenance:write| closes record, restores vehicle status |
| GET    | `/api/fuel-logs`                   | fuel:read       | |
| POST   | `/api/fuel-logs`                   | fuel:write      | |
| GET    | `/api/expenses`                    | fuel:read       | |
| POST   | `/api/expenses`                    | fuel:write      | |
| GET    | `/api/reports/kpis`                | reports:read    | |
| GET    | `/api/reports/per-vehicle`         | reports:read    | distance, efficiency, opex, ROI per vehicle |
| GET    | `/api/reports/export.csv`          | reports:write   | downloadable CSV |
| POST   | `/api/dev/reset`                   | public          | resets the DB back to seed data — handy for demos, remove before real deployment |

All error responses are `{ "error": "message" }` with an appropriate HTTP
status (400 validation, 401 unauthenticated, 403 forbidden, 404 not found,
409 business-rule conflict).

## What changed in the frontend

`public/index.html` is the same UI, but every function that used to mutate
`state.vehicles` / `state.trips` / etc. directly now calls the API and
reloads from the server afterwards (see `refresh()` in the `<script>` block),
so the UI always reflects server-authoritative state — including validation
errors, which now surface as the same toast notifications the app already
had.
