// db.js — tiny file-backed JSON "database".
// No external dependencies (sandbox has no network access for npm install),
// so persistence is a JSON file on disk with synchronous atomic writes.
// Swap this module out for a real DB (Postgres/Mongo) later without touching
// route handlers — they only ever call the exported functions below.

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data", "db.json");

const SEED = {
  vehicles: [
    { id: "VH-1001", reg: "TS-09-AB-4471", name: "Van-05", type: "Van", region: "North", maxLoad: 500, odometer: 12500, cost: 1800000, status: "Available" },
    { id: "VH-1002", reg: "TS-07-CD-8821", name: "Truck-12", type: "Truck", region: "South", maxLoad: 5000, odometer: 45210, cost: 4200000, status: "On Trip" },
    { id: "VH-1003", reg: "TS-11-EF-2290", name: "Bike-03", type: "Bike", region: "East", maxLoad: 30, odometer: 8900, cost: 120000, status: "In Shop" },
    { id: "VH-1004", reg: "TS-02-GH-6634", name: "Trailer-07", type: "Trailer", region: "West", maxLoad: 12000, odometer: 102300, cost: 6500000, status: "Retired" },
  ],
  drivers: [
    { id: "DR-01", name: "Alex", license: "DL-88213", category: "LMV", expiry: "2027-03-15", contact: "+91 90000 11111", safety: 92, status: "Available" },
    { id: "DR-02", name: "Priya", license: "DL-77410", category: "HMV", expiry: "2026-01-01", contact: "+91 90000 22222", safety: 78, status: "Available" },
    { id: "DR-03", name: "Ramesh", license: "DL-55210", category: "HMV", expiry: "2027-11-20", contact: "+91 90000 33333", safety: 65, status: "On Trip" },
    { id: "DR-04", name: "Fatima", license: "DL-90011", category: "LMV", expiry: "2027-06-01", contact: "+91 90000 44444", safety: 88, status: "Suspended" },
  ],
  trips: [
    { id: "TR-01", source: "Hyderabad", destination: "Warangal", vehicleId: "VH-1001", driverId: "DR-01", cargo: 450, distance: 140, status: "Completed", revenue: 8000, finalOdometer: 12640, fuelUsed: 18 },
    { id: "TR-02", source: "Chennai", destination: "Bengaluru", vehicleId: "VH-1002", driverId: "DR-03", cargo: 3500, distance: 350, status: "Dispatched", revenue: 21000, finalOdometer: null, fuelUsed: null },
  ],
  maintenance: [
    { id: "MT-01", vehicleId: "VH-1003", type: "Oil Change", cost: 1200, date: "2026-07-08", status: "Open" },
    { id: "MT-02", vehicleId: "VH-1001", type: "Tire Replacement", cost: 3500, date: "2026-06-02", status: "Closed" },
  ],
  fuelLogs: [
    { id: "FL-01", vehicleId: "VH-1001", liters: 18, cost: 1980, date: "2026-07-01" },
    { id: "FL-02", vehicleId: "VH-1002", liters: 60, cost: 6600, date: "2026-07-05" },
  ],
  expenses: [
    { id: "EX-01", vehicleId: "VH-1002", category: "Toll", amount: 450, date: "2026-07-05" },
    { id: "EX-02", vehicleId: "VH-1001", category: "Toll", amount: 120, date: "2026-07-01" },
  ],
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(SEED, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

let cache = load();

// Atomic-ish write: write to temp file then rename, so a crash mid-write
// never corrupts db.json.
function persist() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function getAll(collection) {
  return cache[collection];
}

function findById(collection, id) {
  return cache[collection].find((x) => x.id === id) || null;
}

function insert(collection, record) {
  cache[collection].push(record);
  persist();
  return record;
}

function update(collection, id, patch) {
  const record = findById(collection, id);
  if (!record) return null;
  Object.assign(record, patch);
  persist();
  return record;
}

function nextId(collection, prefix) {
  // Mirrors the original frontend's uid() scheme: PREFIX-NN-RRR
  const arr = cache[collection];
  return prefix + "-" + String(arr.length + 1).padStart(2, "0") + "-" + Math.floor(Math.random() * 900 + 100);
}

function reset() {
  cache = JSON.parse(JSON.stringify(SEED));
  persist();
  return cache;
}

module.exports = { getAll, findById, insert, update, nextId, reset };
