const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Helper to read database
async function readDb() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading db.json, returning empty structure', error);
    return {
      users: [],
      vehicles: [],
      drivers: [],
      trips: [],
      maintenanceLogs: [],
      fuelLogs: [],
      expenses: [],
      fines: [],
      activityLogs: []
    };
  }
}

// Helper to write database
async function writeDb(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Helper to log actions
async function logAction(user, action) {
  const db = await readDb();
  db.activityLogs.push({
    timestamp: new Date().toISOString(),
    user,
    action
  });
  await writeDb(db);
}

// API: Get complete database state
app.get('/api/db', async (req, res) => {
  const db = await readDb();
  res.json(db);
});

// ======= ROBUST AUTHENTICATION SYSTEM =======
const crypto = require('crypto');

// In-memory rate-limiting & session store
const loginAttempts = {};  // { ip: { count, lockedUntil } }
const activeSessions = {}; // { token: { email, name, role, createdAt } }

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Middleware: Validate session token on protected routes
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !activeSessions[token]) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  // Check TTL
  const session = activeSessions[token];
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    delete activeSessions[token];
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.user = session;
  next();
}

// API: Robust Login with rate limiting & brute-force protection
app.post('/api/auth/login', async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  // 1. Rate-limit check
  if (!loginAttempts[clientIP]) {
    loginAttempts[clientIP] = { count: 0, lockedUntil: 0 };
  }
  const record = loginAttempts[clientIP];

  if (record.lockedUntil > now) {
    const remainSec = Math.ceil((record.lockedUntil - now) / 1000);
    return res.status(429).json({
      error: `Too many failed attempts. Account locked for ${remainSec} seconds.`,
      lockedUntil: record.lockedUntil,
      remainingSeconds: remainSec
    });
  }

  const { email, password } = req.body;

  // 2. Input presence validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // 3. Email format validation (server-side)
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  // 4. Sanitize inputs (trim, lowercase email)
  const sanitizedEmail = email.trim().toLowerCase();
  const sanitizedPassword = password.trim();

  // 5. Credential lookup
  const db = await readDb();
  const user = db.users.find(u =>
    u.email.toLowerCase() === sanitizedEmail && u.password === sanitizedPassword
  );

  if (!user) {
    // Increment failed attempts
    record.count += 1;
    const remaining = MAX_ATTEMPTS - record.count;

    if (record.count >= MAX_ATTEMPTS) {
      record.lockedUntil = now + (LOCKOUT_SECONDS * 1000);
      record.count = 0; // reset counter for next window
      return res.status(429).json({
        error: `Too many failed attempts. Account locked for ${LOCKOUT_SECONDS} seconds.`,
        lockedUntil: record.lockedUntil,
        remainingSeconds: LOCKOUT_SECONDS
      });
    }

    return res.status(401).json({
      error: 'Invalid email or password.',
      attemptsRemaining: remaining
    });
  }

  // 6. Success: reset attempts, generate session token
  record.count = 0;
  record.lockedUntil = 0;

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions[token] = {
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: Date.now()
  };

  await logAction(user.email, `Logged in successfully from IP ${clientIP}`);

  res.json({
    token,
    email: user.email,
    name: user.name,
    role: user.role
  });
});

// API: Verify existing session token (for page reload persistence)
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token || !activeSessions[token]) {
    return res.status(401).json({ valid: false });
  }
  const session = activeSessions[token];
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    delete activeSessions[token];
    return res.status(401).json({ valid: false, error: 'Session expired.' });
  }
  res.json({ valid: true, email: session.email, name: session.name, role: session.role });
});

// API: Logout (destroy session)
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'] || req.body.token;
  if (token && activeSessions[token]) {
    delete activeSessions[token];
  }
  res.json({ message: 'Logged out successfully.' });
});

// API: Add Vehicle
app.post('/api/vehicles', async (req, res) => {
  const { registrationNumber, model, type, maxCapacity, odometer, acquisitionCost, user } = req.body;
  const db = await readDb();
  
  // Registration Number must be unique
  const exists = db.vehicles.some(v => v.registrationNumber.toUpperCase() === registrationNumber.toUpperCase());
  if (exists) {
    return res.status(400).json({ error: `Vehicle with registration number ${registrationNumber} already exists.` });
  }

  const newVehicle = {
    registrationNumber: registrationNumber.toUpperCase(),
    model,
    type,
    maxCapacity: Number(maxCapacity),
    odometer: Number(odometer),
    acquisitionCost: Number(acquisitionCost),
    status: 'Available',
    acquisitionDate: new Date().toISOString().split('T')[0],
    fuelLevel: 100,
    vehicleAge: 0.1,
    lastOilChangeKm: Number(odometer) || 0,
    nextServiceDate: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().split('T')[0], // 3 months default
    documents: {
      insurance: { status: 'Active', expiry: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0], docId: 'INS-' + Math.floor(Math.random() * 9000 + 1000) },
      puc: { status: 'Active', expiry: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().split('T')[0], docId: 'PUC-' + Math.floor(Math.random() * 9000 + 1000) },
      roadTax: { status: 'Active', expiry: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0], docId: 'TAX-' + Math.floor(Math.random() * 9000 + 1000) }
    }
  };

  db.vehicles.push(newVehicle);
  await writeDb(db);
  await logAction(user || 'Fleet Manager', `Registered vehicle ${newVehicle.registrationNumber}`);
  res.status(201).json(newVehicle);
});

// API: Add Driver
app.post('/api/drivers', async (req, res) => {
  const { email, name, licenseNumber, licenseCategory, licenseExpiry, contact, user } = req.body;
  const db = await readDb();
  
  const exists = db.drivers.some(d => d.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: `Driver with email ${email} already exists.` });
  }

  const newDriver = {
    email: email.toLowerCase(),
    name,
    licenseNumber,
    licenseCategory,
    licenseExpiry,
    contact,
    safetyScore: 5.0,
    status: 'Available',
    reviews: [],
    attendance: [],
    documents: {
      drivingLicense: { status: 'Active', expiry: licenseExpiry, docId: licenseNumber },
      medicalCertificate: { status: 'Active', expiry: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0], docId: 'MED-' + Math.floor(Math.random() * 9000 + 1000) },
      backgroundCheck: { status: 'Active', expiry: new Date(Date.now() + 3 * 365 * 24 * 3600 * 1000).toISOString().split('T')[0], docId: 'BG-' + Math.floor(Math.random() * 9000 + 1000) }
    }
  };

  db.drivers.push(newDriver);
  // Also register driver in users table for basic credentials
  db.users.push({
    email: email.toLowerCase(),
    password: 'password123',
    name,
    role: 'Driver'
  });

  await writeDb(db);
  await logAction(user || 'Safety Officer', `Registered driver ${name} (${email})`);
  res.status(201).json(newDriver);
});

// API: Create Trip (Draft) with Business Rule Validations
app.post('/api/trips', async (req, res) => {
  const { source, destination, vehicleReg, driverEmail, cargoWeight, distance, user } = req.body;
  const db = await readDb();
  
  const vehicle = db.vehicles.find(v => v.registrationNumber === vehicleReg);
  const driver = db.drivers.find(d => d.email === driverEmail);
  
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  // 1. Retired or In Shop vehicles must never appear/be assigned
  if (vehicle.status === 'Retired' || vehicle.status === 'In Shop') {
    return res.status(400).json({ error: `Vehicle ${vehicleReg} is currently ${vehicle.status} and cannot be assigned.` });
  }

  // 2. Drivers with expired licenses or Suspended status cannot be assigned to trips.
  const today = new Date().toISOString().split('T')[0];
  if (driver.licenseExpiry && driver.licenseExpiry < today) {
    return res.status(400).json({ error: `Driver license for ${driver.name} has expired on ${driver.licenseExpiry}.` });
  }
  if (driver.status === 'Suspended') {
    return res.status(400).json({ error: `Driver ${driver.name} is currently Suspended.` });
  }

  // 3. A driver or vehicle already marked On Trip cannot be assigned.
  if (vehicle.status === 'On Trip') {
    return res.status(400).json({ error: `Vehicle ${vehicleReg} is already On Trip.` });
  }
  if (driver.status === 'On Trip') {
    return res.status(400).json({ error: `Driver ${driver.name} is already On Trip.` });
  }

  // 4. Cargo Weight must not exceed the vehicle's maximum load capacity.
  if (Number(cargoWeight) > vehicle.maxCapacity) {
    return res.status(400).json({ error: `Cargo Weight (${cargoWeight} kg) exceeds vehicle maximum capacity (${vehicle.maxCapacity} kg).` });
  }

  const newTrip = {
    id: `T-${Math.floor(Math.random() * 9000 + 1000)}`,
    source,
    destination,
    vehicleReg,
    driverEmail,
    cargoWeight: Number(cargoWeight),
    distance: Number(distance),
    status: 'Draft',
    fuelConsumed: 0,
    endOdometer: 0,
    date: new Date().toISOString().split('T')[0]
  };

  db.trips.push(newTrip);
  await writeDb(db);
  await logAction(user || 'Fleet Manager', `Created Draft trip ${newTrip.id}`);
  res.status(201).json(newTrip);
});

// API: Dispatch Trip
app.post('/api/trips/dispatch', async (req, res) => {
  const { tripId, user } = req.body;
  const db = await readDb();
  
  const trip = db.trips.find(t => t.id === tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  
  const vehicle = db.vehicles.find(v => v.registrationNumber === trip.vehicleReg);
  const driver = db.drivers.find(d => d.email === trip.driverEmail);

  if (!vehicle || !driver) {
    return res.status(400).json({ error: 'Vehicle or Driver assigned to this trip is missing.' });
  }

  // Dispatching a trip automatically changes both vehicle and driver status to On Trip
  trip.status = 'Dispatched';
  vehicle.status = 'On Trip';
  driver.status = 'On Trip';

  await writeDb(db);
  await logAction(user || 'Fleet Manager', `Dispatched trip ${tripId} with Driver ${driver.name} and Vehicle ${vehicle.registrationNumber}`);
  res.json({ trip, vehicle, driver });
});

// API: Complete Trip
app.post('/api/trips/complete', async (req, res) => {
  const { tripId, endOdometer, fuelConsumedLiters, fuelCost, user } = req.body;
  const db = await readDb();
  
  const trip = db.trips.find(t => t.id === tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  
  const vehicle = db.vehicles.find(v => v.registrationNumber === trip.vehicleReg);
  const driver = db.drivers.find(d => d.email === trip.driverEmail);

  if (Number(endOdometer) <= vehicle.odometer) {
    return res.status(400).json({ error: `End odometer (${endOdometer}) must be greater than vehicle current odometer (${vehicle.odometer}).` });
  }

  // Completing a trip automatically changes both vehicle and driver status back to Available
  trip.status = 'Completed';
  trip.fuelConsumed = Number(fuelConsumedLiters);
  trip.endOdometer = Number(endOdometer);

  // Update vehicle odometer and fuel Level
  const previousOdo = vehicle.odometer;
  vehicle.odometer = Number(endOdometer);
  vehicle.status = 'Available';
  
  // Simulate fuel drop and log fuel
  vehicle.fuelLevel = Math.max(0, vehicle.fuelLevel - Math.floor(Number(fuelConsumedLiters) * 0.5));
  
  if (driver) {
    driver.status = 'Available';
  }

  // Add fuel log
  const flId = `FL-${Math.floor(Math.random() * 9000 + 1000)}`;
  db.fuelLogs.push({
    id: flId,
    vehicleReg: vehicle.registrationNumber,
    liters: Number(fuelConsumedLiters),
    cost: Number(fuelCost),
    date: new Date().toISOString().split('T')[0]
  });

  // Calculate if oil change is needed
  // Check if current odometer - lastOilChangeKm is approaching vehicle's limit (assume 10,000 km limit)
  const odoSinceLastOil = vehicle.odometer - vehicle.lastOilChangeKm;
  if (odoSinceLastOil >= 10000) {
    // Generate notification / action flag in client
    console.log(`Vehicle ${vehicle.registrationNumber} is due for an Engine Oil Change!`);
  }

  await writeDb(db);
  await logAction(user || 'Driver', `Completed trip ${tripId}. Odometer updated to ${endOdometer}. Fuel level: ${vehicle.fuelLevel}%`);
  res.json({ trip, vehicle, driver });
});

// API: Cancel Trip
app.post('/api/trips/cancel', async (req, res) => {
  const { tripId, user } = req.body;
  const db = await readDb();
  
  const trip = db.trips.find(t => t.id === tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  
  const vehicle = db.vehicles.find(v => v.registrationNumber === trip.vehicleReg);
  const driver = db.drivers.find(d => d.email === trip.driverEmail);

  // Cancelling a dispatched/draft trip restores the vehicle and driver to Available
  trip.status = 'Cancelled';
  if (vehicle && vehicle.status === 'On Trip') vehicle.status = 'Available';
  if (driver && driver.status === 'On Trip') driver.status = 'Available';

  await writeDb(db);
  await logAction(user || 'Fleet Manager', `Cancelled trip ${tripId}`);
  res.json({ trip, vehicle, driver });
});

// API: Log Maintenance (Oil Change, Engine check, etc.)
app.post('/api/maintenance', async (req, res) => {
  const { vehicleReg, description, cost, user } = req.body;
  const db = await readDb();
  
  const vehicle = db.vehicles.find(v => v.registrationNumber === vehicleReg);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const logId = `M-${Math.floor(Math.random() * 9000 + 1000)}`;
  const newLog = {
    id: logId,
    vehicleReg,
    description,
    cost: Number(cost) || 0,
    status: 'In Progress',
    date: new Date().toISOString().split('T')[0]
  };

  db.maintenanceLogs.push(newLog);

  // Creating an active maintenance record automatically changes vehicle status to In Shop
  vehicle.status = 'In Shop';

  await writeDb(db);
  await logAction(user || 'Fleet Manager', `Vehicle ${vehicleReg} placed in Maintenance (In Shop). ID: ${logId}`);
  res.status(201).json(newLog);
});

// API: Close Maintenance
app.post('/api/maintenance/close', async (req, res) => {
  const { logId, user } = req.body;
  const db = await readDb();
  
  const mLog = db.maintenanceLogs.find(l => l.id === logId);
  if (!mLog) return res.status(404).json({ error: 'Maintenance log not found' });
  
  mLog.status = 'Closed';
  
  const vehicle = db.vehicles.find(v => v.registrationNumber === mLog.vehicleReg);
  if (vehicle && vehicle.status === 'In Shop') {
    // Closing maintenance restores the vehicle to Available (unless retired)
    vehicle.status = 'Available';
    
    // If maintenance was an oil change, reset the oil change indicator
    if (mLog.description.toLowerCase().includes('oil')) {
      vehicle.lastOilChangeKm = vehicle.odometer;
    }
  }

  await writeDb(db);
  await logAction(user || 'Fleet Manager', `Closed maintenance ID ${logId}. Vehicle ${mLog.vehicleReg} status reverted to Available.`);
  res.json(mLog);
});

// API: Log Driver review and update Safety Score
app.post('/api/drivers/review', async (req, res) => {
  const { email, passenger, rating, comment, user } = req.body;
  const db = await readDb();
  
  const driver = db.drivers.find(d => d.email === email);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  
  driver.reviews.push({
    passenger: passenger || 'Anonymous Rider',
    rating: Number(rating),
    comment: comment || '',
    date: new Date().toISOString().split('T')[0]
  });

  // Re-calculate safety score / rating (average)
  const total = driver.reviews.reduce((sum, r) => sum + r.rating, 0);
  driver.safetyScore = Math.round((total / driver.reviews.length) * 10) / 10;

  await writeDb(db);
  await logAction(user || 'Passenger', `Submitted review for driver ${driver.name}. New rating: ${driver.safetyScore}`);
  res.json(driver);
});

// API: Driver Attendance Punch (Clock-In / Clock-Out)
app.post('/api/drivers/attendance', async (req, res) => {
  const { email, action, time, hours, user } = req.body; // action: 'clock-in', 'clock-out'
  const db = await readDb();
  
  const driver = db.drivers.find(d => d.email === email);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  
  const todayStr = new Date().toISOString().split('T')[0];
  let todayRec = driver.attendance.find(a => a.date === todayStr);

  if (action === 'clock-in') {
    if (todayRec) {
      todayRec.status = 'Present';
      todayRec.checkIn = time || '08:00';
    } else {
      driver.attendance.push({
        date: todayStr,
        status: 'Present',
        checkIn: time || '08:00',
        checkOut: '',
        hours: 0
      });
    }
  } else { // clock-out
    const activeHours = Number(hours) || 8;
    if (!todayRec) {
      todayRec = {
        date: todayStr,
        status: 'Present',
        checkIn: '08:00',
        checkOut: time || '17:00',
        hours: activeHours
      };
      driver.attendance.push(todayRec);
    } else {
      todayRec.checkOut = time || '17:00';
      todayRec.hours = activeHours;
    }

    // Business Rule Check: Driver working hours limits (Max 10 hours daily)
    if (activeHours > 10) {
      // Check if duplicate fine already exists for this driver today
      const alreadyFined = db.fines.some(f => f.driverEmail === email && f.date === todayStr && f.type === 'Working Hours Limit Breach');
      if (!alreadyFined) {
        db.fines.push({
          id: `F-${Math.floor(Math.random() * 9000 + 1000)}`,
          driverEmail: email,
          vehicleReg: 'N/A',
          date: todayStr,
          amount: 150,
          type: 'Working Hours Limit Breach',
          description: `Driver ${driver.name} breached working hours limit by logging a shift of ${activeHours} hours.`
        });
      }
    }
  }

  await writeDb(db);
  await logAction(email, `Driver attendance recorded: ${action}`);
  res.json(driver);
});

// API: Log general Fines (Working hours breach, duplicate trip etc.)
app.post('/api/fines', async (req, res) => {
  const { driverEmail, vehicleReg, date, amount, type, description, user } = req.body;
  const db = await readDb();
  
  const newFine = {
    id: `F-${Math.floor(Math.random() * 9000 + 1000)}`,
    driverEmail,
    vehicleReg: vehicleReg || 'N/A',
    date: date || new Date().toISOString().split('T')[0],
    amount: Number(amount) || 100,
    type, // "Working Hours Limit Breach", "Duplicate Trip Violation", "Speeding" etc.
    description
  };
  
  db.fines.push(newFine);
  await writeDb(db);
  await logAction(user || 'Safety Officer', `Logged fine for driver ${driverEmail} (${type})`);
  res.status(201).json(newFine);
});

// API: Route Optimization solver using Nearest Neighbor TSP algorithm
app.post('/api/route-optimize', async (req, res) => {
  const { start, checkpoints } = req.body; // start: {lat, lng}, checkpoints: [{id, name, lat, lng}]
  if (!start || !checkpoints || checkpoints.length === 0) {
    return res.status(400).json({ error: 'Missing start coordinate or checkpoints list' });
  }

  function getDistance(p1, p2) {
    const dy = p1.lat - p2.lat;
    const dx = p1.lng - p2.lng;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const unvisited = [...checkpoints];
  const route = [];
  let currentPos = start;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < unvisited.length; i++) {
      const dist = getDistance(currentPos, unvisited[i]);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }
    
    const nextNode = unvisited.splice(nearestIdx, 1)[0];
    route.push(nextNode);
    currentPos = nextNode;
  }

  // Calculate total mock route distance in kilometers (approx conversion factor 111 km per coordinate degree)
  let totalDistance = 0;
  let curr = start;
  for (let i = 0; i < route.length; i++) {
    totalDistance += getDistance(curr, route[i]) * 111;
    curr = route[i];
  }
  totalDistance += getDistance(curr, start) * 111; // return to base

  res.json({
    optimizedRoute: route,
    totalDistance: Math.round(totalDistance * 10) / 10,
    unit: 'km'
  });
});

const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`TransitOps server is running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy, trying ${nextPort}...`);
      startServer(nextPort);
    } else {
      console.error('Server failed to start:', error);
      process.exit(1);
    }
  });
};

startServer(DEFAULT_PORT);
