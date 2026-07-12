// business.js — domain rules ported from the original frontend JS, now
// running server-side so they can't be bypassed by a modified client.

const db = require("./db");
const { httpError } = require("./auth");

function isLicenseExpired(driver, today) {
  return new Date(driver.expiry) < today;
}

function money(n) {
  return Number(n || 0);
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
function createVehicle(body) {
  const { reg, name, type, region, maxLoad, odometer, cost } = body;
  if (!reg || !name || !maxLoad || !cost) throw httpError(400, "Please fill in all required fields.");
  const dup = db.getAll("vehicles").some((v) => v.reg.toLowerCase() === String(reg).toLowerCase());
  if (dup) throw httpError(409, "Registration number must be unique.");
  return db.insert("vehicles", {
    id: db.nextId("vehicles", "VH"),
    reg, name, type: type || "Van", region: region || "North",
    maxLoad: Number(maxLoad), odometer: Number(odometer) || 0, cost: Number(cost),
    status: "Available",
  });
}

function retireVehicle(id) {
  const v = db.findById("vehicles", id);
  if (!v) throw httpError(404, "Vehicle not found.");
  return db.update("vehicles", id, { status: "Retired" });
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
function createDriver(body) {
  const { name, license, category, expiry, contact, safety } = body;
  if (!name || !license || !expiry) throw httpError(400, "Please fill in all required fields.");
  return db.insert("drivers", {
    id: db.nextId("drivers", "DR"),
    name, license, category: category || "LMV", expiry, contact: contact || "",
    safety: Number(safety) || 0, status: "Available",
  });
}

function suspendDriver(id) {
  if (!db.findById("drivers", id)) throw httpError(404, "Driver not found.");
  return db.update("drivers", id, { status: "Suspended" });
}

function reinstateDriver(id) {
  if (!db.findById("drivers", id)) throw httpError(404, "Driver not found.");
  return db.update("drivers", id, { status: "Available" });
}

// ---------------------------------------------------------------------------
// Trips (Draft -> Dispatched -> Completed, or Cancelled)
// ---------------------------------------------------------------------------
function createTrip(body, today) {
  const { source, destination, vehicleId, driverId } = body;
  const cargo = Number(body.cargo);
  const distance = Number(body.distance) || 0;
  if (!source || !destination || !vehicleId || !driverId || !cargo) {
    throw httpError(400, "Please fill in all required fields.");
  }
  const vehicle = db.findById("vehicles", vehicleId);
  const driver = db.findById("drivers", driverId);
  if (!vehicle || vehicle.status !== "Available") throw httpError(409, "Vehicle is not available.");
  if (!driver || driver.status !== "Available") throw httpError(409, "Driver is not available.");
  if (isLicenseExpired(driver, today)) throw httpError(409, "Driver's license has expired.");
  if (cargo > vehicle.maxLoad) throw httpError(409, "Cargo exceeds " + vehicle.name + "'s max load (" + vehicle.maxLoad + "kg).");

  return db.insert("trips", {
    id: db.nextId("trips", "TR"),
    source, destination, vehicleId, driverId, cargo, distance,
    status: "Draft", revenue: 0, finalOdometer: null, fuelUsed: null,
  });
}

function dispatchTrip(id) {
  const t = db.findById("trips", id);
  if (!t) throw httpError(404, "Trip not found.");
  if (t.status !== "Draft") throw httpError(409, "Only Draft trips can be dispatched.");
  const vehicle = db.findById("vehicles", t.vehicleId);
  const driver = db.findById("drivers", t.driverId);
  if (vehicle.status !== "Available") throw httpError(409, "Vehicle no longer available.");
  if (driver.status !== "Available" || isLicenseExpired(driver, new Date())) throw httpError(409, "Driver no longer eligible.");

  db.update("vehicles", vehicle.id, { status: "On Trip" });
  db.update("drivers", driver.id, { status: "On Trip" });
  return db.update("trips", id, { status: "Dispatched" });
}

function completeTrip(id, body) {
  const t = db.findById("trips", id);
  if (!t) throw httpError(404, "Trip not found.");
  if (t.status !== "Dispatched") throw httpError(409, "Only Dispatched trips can be completed.");
  const vehicle = db.findById("vehicles", t.vehicleId);
  const driver = db.findById("drivers", t.driverId);

  const finalOdometer = Number(body.finalOdometer);
  const fuelUsed = Number(body.fuelUsed) || 0;
  const revenue = Number(body.revenue) || 0;

  db.update("trips", id, { status: "Completed", finalOdometer, fuelUsed, revenue });
  db.update("drivers", driver.id, { status: "Available" });

  const vehiclePatch = { status: "Available" };
  if (finalOdometer > vehicle.odometer) vehiclePatch.odometer = finalOdometer;
  db.update("vehicles", vehicle.id, vehiclePatch);

  if (fuelUsed > 0) {
    db.insert("fuelLogs", {
      id: db.nextId("fuelLogs", "FL"),
      vehicleId: t.vehicleId,
      liters: fuelUsed,
      cost: Math.round(fuelUsed * 110),
      date: new Date().toISOString().slice(0, 10),
    });
  }
  return db.findById("trips", id);
}

function cancelTrip(id) {
  const t = db.findById("trips", id);
  if (!t) throw httpError(404, "Trip not found.");
  if (t.status === "Completed" || t.status === "Cancelled") {
    throw httpError(409, "Trip is already " + t.status + ".");
  }
  if (t.status === "Dispatched") {
    db.update("vehicles", t.vehicleId, { status: "Available" });
    db.update("drivers", t.driverId, { status: "Available" });
  }
  return db.update("trips", id, { status: "Cancelled" });
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------
function createMaintenance(body) {
  const { vehicleId, type, date } = body;
  const cost = Number(body.cost);
  if (!vehicleId || !cost) throw httpError(400, "Please fill in all required fields.");
  const vehicle = db.findById("vehicles", vehicleId);
  if (!vehicle) throw httpError(404, "Vehicle not found.");
  const record = db.insert("maintenance", {
    id: db.nextId("maintenance", "MT"),
    vehicleId, type: type || "Inspection", cost, date: date || new Date().toISOString().slice(0, 10),
    status: "Open",
  });
  db.update("vehicles", vehicleId, { status: "In Shop" });
  return record;
}

function closeMaintenance(id) {
  const m = db.findById("maintenance", id);
  if (!m) throw httpError(404, "Maintenance record not found.");
  if (m.status !== "Open") throw httpError(409, "Maintenance record is already closed.");
  db.update("maintenance", id, { status: "Closed" });
  const vehicle = db.findById("vehicles", m.vehicleId);
  if (vehicle && vehicle.status !== "Retired") db.update("vehicles", vehicle.id, { status: "Available" });
  return db.findById("maintenance", id);
}

// ---------------------------------------------------------------------------
// Fuel / Expenses
// ---------------------------------------------------------------------------
function createFuelLog(body) {
  const { vehicleId, date } = body;
  const liters = Number(body.liters);
  const cost = Number(body.cost) || 0;
  if (!vehicleId || !liters) throw httpError(400, "Please fill in all required fields.");
  if (!db.findById("vehicles", vehicleId)) throw httpError(404, "Vehicle not found.");
  return db.insert("fuelLogs", {
    id: db.nextId("fuelLogs", "FL"), vehicleId, liters, cost, date: date || new Date().toISOString().slice(0, 10),
  });
}

function createExpense(body) {
  const { vehicleId, category, date } = body;
  const amount = Number(body.amount);
  if (!vehicleId || !amount) throw httpError(400, "Please fill in all required fields.");
  if (!db.findById("vehicles", vehicleId)) throw httpError(404, "Vehicle not found.");
  return db.insert("expenses", {
    id: db.nextId("expenses", "EX"), vehicleId, category: category || "Other", amount, date: date || new Date().toISOString().slice(0, 10),
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function perVehicleReport() {
  const vehicles = db.getAll("vehicles");
  const trips = db.getAll("trips");
  const fuelLogs = db.getAll("fuelLogs");
  const maintenance = db.getAll("maintenance");
  const expenses = db.getAll("expenses");

  return vehicles.map((v) => {
    const vTrips = trips.filter((t) => t.vehicleId === v.id && t.status === "Completed");
    const distance = vTrips.reduce((s, t) => s + (t.distance || 0), 0);
    const revenue = vTrips.reduce((s, t) => s + (t.revenue || 0), 0);
    const fuelL = fuelLogs.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.liters, 0);
    const fuelCost = fuelLogs.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.cost, 0);
    const maintCost = maintenance.filter((m) => m.vehicleId === v.id).reduce((s, m) => s + m.cost, 0);
    const expCost = expenses.filter((e) => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0);
    const opCost = fuelCost + maintCost + expCost;
    const efficiency = fuelL > 0 ? distance / fuelL : 0;
    const roi = v.cost > 0 ? (revenue - (maintCost + fuelCost)) / v.cost : 0;
    return Object.assign({}, v, { distance, revenue, fuelL, fuelCost, maintCost, expCost, opCost, efficiency, roi });
  });
}

function computeKpis() {
  const vehicles = db.getAll("vehicles");
  const trips = db.getAll("trips");
  const drivers = db.getAll("drivers");

  const active = vehicles.filter((v) => v.status !== "Retired");
  const available = vehicles.filter((v) => v.status === "Available");
  const inShop = vehicles.filter((v) => v.status === "In Shop");
  const onTrip = vehicles.filter((v) => v.status === "On Trip");
  const activeTrips = trips.filter((t) => t.status === "Dispatched").length;
  const pendingTrips = trips.filter((t) => t.status === "Draft").length;
  const driversOnDuty = drivers.filter((d) => d.status === "On Trip").length;
  const utilization = active.length ? Math.round((onTrip.length / active.length) * 100) : 0;

  return {
    active: active.length, available: available.length, inShop: inShop.length,
    activeTrips, pendingTrips, driversOnDuty, utilization,
  };
}

function exportCsv() {
  const report = perVehicleReport();
  const rows = [
    ["Vehicle", "Distance (km)", "Fuel (L)", "Fuel Efficiency (km/L)", "Fuel Cost", "Maintenance Cost", "Other Expenses", "Operational Cost", "Revenue", "ROI (%)"],
  ].concat(report.map((r) => [r.name, r.distance, r.fuelL, r.efficiency.toFixed(2), r.fuelCost, r.maintCost, r.expCost, r.opCost, r.revenue, (r.roi * 100).toFixed(1)]));
  return rows.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
}

module.exports = {
  isLicenseExpired,
  createVehicle, retireVehicle,
  createDriver, suspendDriver, reinstateDriver,
  createTrip, dispatchTrip, completeTrip, cancelTrip,
  createMaintenance, closeMaintenance,
  createFuelLog, createExpense,
  perVehicleReport, computeKpis, exportCsv,
};
