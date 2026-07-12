// TransitOps State Management
let state = {
  db: {
    users: [],
    vehicles: [],
    drivers: [],
    trips: [],
    maintenanceLogs: [],
    fuelLogs: [],
    expenses: [],
    fines: [],
    activityLogs: []
  },
  activeRole: "Fleet Manager",
  activeView: "dashboard",
  map: null,
  routePolyline: null,
  mapMarkers: [],
  sessionToken: null
};

// ==========================================
// LOGIN SYSTEM - Robust Auth Gate
// ==========================================

// Start on window load — check session or show login
window.addEventListener("load", async () => {
  initTheme();
  spawnLoginParticles();
  setupLoginListeners();

  // Check for existing session token (page reload persistence)
  const storedToken = sessionStorage.getItem("transitops_token");
  if (storedToken) {
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: storedToken })
      });
      if (res.ok) {
        const session = await res.json();
        if (session.valid) {
          state.sessionToken = storedToken;
          state.activeRole = session.role;
          enterApp(session.name, session.role);
          return;
        }
      }
    } catch (err) {
      console.warn("Session verification failed, showing login.", err);
    }
    sessionStorage.removeItem("transitops_token");
  }

  // No valid session — show login overlay
  document.getElementById("login-overlay").classList.remove("hidden");
  document.getElementById("app-wrapper").classList.add("hidden");
});

// Setup login form listeners
function setupLoginListeners() {
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const loginForm = document.getElementById("login-form");
  const togglePwdBtn = document.getElementById("toggle-password");

  // Real-time email validation
  emailInput.addEventListener("input", () => {
    const val = emailInput.value.trim();
    const errorEl = document.getElementById("login-email-error");
    emailInput.classList.remove("error", "valid");

    if (val.length === 0) {
      errorEl.textContent = "";
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(val)) {
      emailInput.classList.add("error");
      errorEl.textContent = "Please enter a valid email address (e.g. user@domain.com)";
    } else {
      emailInput.classList.add("valid");
      errorEl.textContent = "";
    }
  });

  // Real-time password strength meter
  passwordInput.addEventListener("input", () => {
    const val = passwordInput.value;
    updatePasswordStrength(val);
  });

  // Password show/hide toggle
  togglePwdBtn.addEventListener("click", () => {
    const type = passwordInput.getAttribute("type");
    if (type === "password") {
      passwordInput.setAttribute("type", "text");
      togglePwdBtn.querySelector("i").className = "fa-solid fa-eye-slash";
    } else {
      passwordInput.setAttribute("type", "password");
      togglePwdBtn.querySelector("i").className = "fa-solid fa-eye";
    }
  });

  // Demo credential chip auto-fill
  document.querySelectorAll(".cred-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      emailInput.value = chip.getAttribute("data-email");
      passwordInput.value = chip.getAttribute("data-pass");
      emailInput.classList.remove("error");
      emailInput.classList.add("valid");
      document.getElementById("login-email-error").textContent = "";
      updatePasswordStrength(passwordInput.value);
    });
  });

  // Form submission
  loginForm.addEventListener("submit", handleLogin);
}

// Password strength scoring
function updatePasswordStrength(password) {
  const fill = document.getElementById("strength-bar-fill");
  const label = document.getElementById("strength-label");

  fill.className = "strength-bar-fill"; // reset
  
  if (!password || password.length === 0) {
    fill.style.width = "0%";
    label.textContent = "Password Strength";
    label.style.color = "#888";
    return;
  }

  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) {
    fill.classList.add("weak");
    label.textContent = "Weak";
    label.style.color = "#ff3b30";
  } else if (score === 2) {
    fill.classList.add("fair");
    label.textContent = "Fair";
    label.style.color = "#ff9500";
  } else if (score === 3) {
    fill.classList.add("good");
    label.textContent = "Good";
    label.style.color = "#ffcc00";
  } else {
    fill.classList.add("strong");
    label.textContent = "Strong";
    label.style.color = "#34c759";
  }
}

// Handle login form submission
async function handleLogin(e) {
  e.preventDefault();

  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const msgEl = document.getElementById("login-message");
  const submitBtn = document.getElementById("login-submit-btn");
  const attemptsEl = document.getElementById("attempts-info");
  const attemptsCountEl = document.getElementById("attempts-remaining");
  const lockoutEl = document.getElementById("lockout-timer");

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  // Client-side validation
  let hasError = false;

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    document.getElementById("login-email-error").textContent = "Invalid email format.";
    emailInput.classList.add("error");
    hasError = true;
  }

  if (password.length < 4) {
    document.getElementById("login-password-error").textContent = "Password must be at least 4 characters.";
    hasError = true;
  } else {
    document.getElementById("login-password-error").textContent = "";
  }

  if (hasError) return;

  // Show loading state
  submitBtn.classList.add("loading");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.status === 429) {
      // Lockout triggered
      msgEl.className = "login-message error";
      msgEl.innerHTML = `<i class="fa-solid fa-ban"></i> ${data.error}`;
      msgEl.classList.remove("hidden");
      attemptsEl.classList.add("hidden");
      
      // Show countdown timer
      startLockoutCountdown(data.remainingSeconds || 30);
      
    } else if (res.status === 401) {
      // Wrong credentials
      msgEl.className = "login-message error";
      msgEl.innerHTML = `<i class="fa-solid fa-xmark"></i> ${data.error}`;
      msgEl.classList.remove("hidden");

      if (data.attemptsRemaining !== undefined) {
        attemptsEl.classList.remove("hidden");
        attemptsCountEl.textContent = data.attemptsRemaining;
      }

      // Shake the email & password fields
      emailInput.classList.add("error");
      passwordInput.parentElement.parentElement.querySelector("input").classList.add("error");
      setTimeout(() => {
        emailInput.classList.remove("error");
        passwordInput.classList.remove("error");
      }, 1500);

    } else if (res.status === 400) {
      // Validation error
      msgEl.className = "login-message error";
      msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${data.error}`;
      msgEl.classList.remove("hidden");

    } else if (res.ok) {
      // Success
      state.sessionToken = data.token;
      state.activeRole = data.role;
      sessionStorage.setItem("transitops_token", data.token);

      msgEl.className = "login-message success";
      msgEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Welcome back, ${data.name}!`;
      msgEl.classList.remove("hidden");
      attemptsEl.classList.add("hidden");

      // Transition to app after brief success message
      setTimeout(() => {
        enterApp(data.name, data.role);
      }, 800);
    }

  } catch (err) {
    msgEl.className = "login-message error";
    msgEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Network error. Ensure the backend server is running.`;
    msgEl.classList.remove("hidden");
    console.error("Login fetch error:", err);
  } finally {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }
}

// Lockout countdown display
function startLockoutCountdown(seconds) {
  const lockoutEl = document.getElementById("lockout-timer");
  const countdownEl = document.getElementById("lockout-countdown");
  const submitBtn = document.getElementById("login-submit-btn");

  lockoutEl.classList.remove("hidden");
  submitBtn.disabled = true;
  let remaining = seconds;
  countdownEl.textContent = remaining;

  const interval = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining;
    
    if (remaining <= 0) {
      clearInterval(interval);
      lockoutEl.classList.add("hidden");
      submitBtn.disabled = false;
      document.getElementById("login-message").classList.add("hidden");
    }
  }, 1000);
}

// Transition from login screen to main app
function enterApp(userName, userRole) {
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("app-wrapper").classList.remove("hidden");

  // Set user info in header
  document.getElementById("user-name").innerText = userName;
  document.getElementById("user-role-badge").innerText = userRole;

  // Set role selector to match
  const roleSelect = document.getElementById("active-role");
  for (let i = 0; i < roleSelect.options.length; i++) {
    if (roleSelect.options[i].value === userRole) {
      roleSelect.selectedIndex = i;
      break;
    }
  }

  // Initialize the full application
  initApp();
}

// Logout session
window.logoutSession = async () => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": state.sessionToken || ""
      }
    });
  } catch (err) {
    console.warn("Logout API call failed", err);
  }

  state.sessionToken = null;
  sessionStorage.removeItem("transitops_token");

  // Reset and show login
  document.getElementById("app-wrapper").classList.add("hidden");
  document.getElementById("login-overlay").classList.remove("hidden");
  document.getElementById("login-form").reset();
  document.getElementById("login-message").classList.add("hidden");
  document.getElementById("attempts-info").classList.add("hidden");
  document.getElementById("lockout-timer").classList.add("hidden");
  document.getElementById("strength-bar-fill").className = "strength-bar-fill";
  document.getElementById("strength-label").textContent = "Password Strength";
};

// Spawn animated floating particles behind the login card
function spawnLoginParticles() {
  const container = document.getElementById("login-particles");
  if (!container) return;

  const colors = ["#ff8c00", "#ffb703", "#ff006e", "#8338ec", "#3a86ff"];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("div");
    p.className = "login-particle";
    const size = Math.random() * 80 + 30;
    p.style.width = size + "px";
    p.style.height = size + "px";
    p.style.left = Math.random() * 100 + "%";
    p.style.top = Math.random() * 100 + "%";
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = (Math.random() * 5).toFixed(1) + "s";
    p.style.animationDuration = (6 + Math.random() * 6).toFixed(1) + "s";
    container.appendChild(p);
  }
}

// Full app initialization (called AFTER login)
async function initApp() {
  await fetchDbState();
  initRouter();
  initMap();
  initRoleSelector();
  setupEventListeners();
  renderAllViews();
  checkNotifications();
}

async function fetchDbState() {
  try {
    const res = await fetch("/api/db");
    if (res.ok) {
      state.db = await res.json();
    }
  } catch (err) {
    console.error("Failed to fetch database state, running in local memory fallback", err);
  }
}

// ----------------------------------------------------
// UI Routing & View Transitions
// ----------------------------------------------------
function initRouter() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetView = item.getAttribute("data-view");
      switchView(targetView);
    });
  });
}

function switchView(viewName) {
  state.activeView = viewName;
  
  // Update views in DOM
  const views = document.querySelectorAll(".app-view");
  views.forEach(v => v.classList.remove("active"));
  
  const targetElement = document.getElementById(`view-${viewName}`);
  if (targetElement) {
    targetElement.classList.add("active");
  }

  // Update navbar items
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    if (item.getAttribute("data-view") === viewName) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Re-size leaflet map if it was activated
  if (viewName === "map" && state.map) {
    setTimeout(() => {
      state.map.invalidateSize();
    }, 200);
  }

  // Set island status bar text
  const statusText = document.getElementById("island-status-text");
  if (statusText) {
    statusText.innerText = `Viewing ${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`;
  }
}

// ----------------------------------------------------
// Theme Picker Logic
// ----------------------------------------------------
function initTheme() {
  const currentTheme = localStorage.getItem("transitops-theme") || "sun-kissed";
  document.documentElement.setAttribute("data-theme", currentTheme);
  
  const toggleBtn = document.getElementById("island-theme-toggle");
  const dropdown = document.getElementById("theme-dropdown");
  
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    dropdown.classList.add("hidden");
  });

  const options = document.querySelectorAll(".theme-option");
  options.forEach(opt => {
    opt.addEventListener("click", () => {
      const selected = opt.getAttribute("data-theme");
      document.documentElement.setAttribute("data-theme", selected);
      localStorage.setItem("transitops-theme", selected);
      showToast("Theme Updated", `Switched design view to ${opt.innerText}`, "success");
    });
  });
}

// ----------------------------------------------------
// Map & Live Fleet Tracking
// ----------------------------------------------------
function initMap() {
  try {
    // Initializing Leaflet map centered in New York City (default coordinate base for routes)
    state.map = L.map('map').setView([40.73, -73.97], 12);
    
    // Add default OSM tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(state.map);
    
    // Google Maps API Leaflet Hook support: 
    // In production, we'd include Google Maps Tile service if keys are present:
    // L.gridLayer.googleMutant({ type: 'roadmap' }).addTo(state.map);
  } catch (err) {
    console.error("Map initialization failed. Verify Leaflet CDN load.", err);
  }
}

function updateMapMarkers() {
  if (!state.map) return;

  // Clear existing markers
  state.mapMarkers.forEach(m => state.map.removeLayer(m));
  state.mapMarkers = [];

  // 1. Plot Base Depots
  const depots = [
    { name: "Logistics Depot A", coords: [40.7128, -74.0060] },
    { name: "Times Square Hub", coords: [40.7589, -73.9851] },
    { name: "Brooklyn Depot", coords: [40.7306, -73.9352] }
  ];

  depots.forEach(dep => {
    const dMarker = L.marker(dep.coords, {
      icon: L.divIcon({
        className: 'custom-depot-marker',
        html: `<div style="background-color: var(--primary-color); border: 2px solid white; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 10px var(--primary-color);"></div>`
      })
    }).addTo(state.map);
    
    dMarker.bindPopup(`<b>${dep.name}</b><br>Base Hub Operations`);
    state.mapMarkers.push(dMarker);
  });

  // 2. Plot Active Vehicles based on trip logs
  state.db.trips.forEach((trip, idx) => {
    if (trip.status !== "Dispatched") return;
    
    // Find vehicle
    const vehicle = state.db.vehicles.find(v => v.registrationNumber === trip.vehicleReg);
    if (!vehicle) return;

    // Simulate current vehicle coordinates along New York bounds
    // We add slight offsets to make them look scattered / dynamic
    const startCoords = [40.7306, -73.9352]; // Brooklyn
    const endCoords = [40.7484, -73.9857]; // Empire State
    const pct = 0.45 + (idx * 0.15); // mock dispatch completion progress
    const lat = startCoords[0] + (endCoords[0] - startCoords[0]) * pct;
    const lng = startCoords[1] + (endCoords[1] - startCoords[1]) * pct;

    let markerColor = "var(--status-trip)";
    if (vehicle.fuelLevel < 15) {
      markerColor = "var(--status-suspended)"; // Critical indicator for low fuel
    }

    const vMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'custom-vehicle-marker',
        html: `<div style="background-color: ${markerColor}; border: 2.5px solid white; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px ${markerColor};"><i class="fa-solid fa-truck" style="color: white; font-size: 10px;"></i></div>`
      })
    }).addTo(state.map);

    vMarker.bindPopup(`
      <div style="font-family: 'Inter', sans-serif;">
        <h4 style="margin: 0 0 6px 0; color: #111;">${vehicle.registrationNumber} (${vehicle.model})</h4>
        <p style="margin: 0; font-size: 0.85rem; color: #555;">
          <b>Active Trip:</b> ${trip.source} → ${trip.destination}<br>
          <b>Cargo Weight:</b> ${trip.cargoWeight} kg<br>
          <b>Fuel Level:</b> ${vehicle.fuelLevel}%<br>
          <b>Odometer:</b> ${vehicle.odometer} km
        </p>
      </div>
    `);
    state.mapMarkers.push(vMarker);
  });
}

// ----------------------------------------------------
// Route Optimization algorithm call
// ----------------------------------------------------
async function runRouteOptimization() {
  const depotSelect = document.getElementById("route-start-depot");
  const selectedDepotOpt = depotSelect.options[depotSelect.selectedIndex];
  const startLat = parseFloat(selectedDepotOpt.getAttribute("data-lat"));
  const startLng = parseFloat(selectedDepotOpt.getAttribute("data-lng"));

  const checkpoints = [];
  const checkedBoxes = document.querySelectorAll(".route-chk:checked");
  
  checkedBoxes.forEach(chk => {
    checkpoints.push({
      id: chk.value,
      name: chk.getAttribute("data-name"),
      lat: parseFloat(chk.getAttribute("data-lat")),
      lng: parseFloat(chk.getAttribute("data-lng"))
    });
  });

  if (checkpoints.length === 0) {
    showToast("Optimization Error", "Please select at least 1 delivery checkpoint.", "warning");
    return;
  }

  try {
    const res = await fetch("/api/route-optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { lat: startLat, lng: startLng },
        checkpoints: checkpoints
      })
    });

    if (res.ok) {
      const data = await res.json();
      renderOptimizedRoute(data, { lat: startLat, lng: startLng }, selectedDepotOpt.text);
      showToast("Route Optimized", `Calculated shortest path across ${data.optimizedRoute.length} checkpoints`, "success");
    }
  } catch (err) {
    console.error("Optimization query failed", err);
    showToast("Route Optimization Error", "Unable to contact the server routing optimization endpoint.", "critical");
  }
}

function renderOptimizedRoute(data, startCoords, startName) {
  const resultsDiv = document.getElementById("optimization-results");
  const routeList = document.getElementById("optimized-route-list");
  const distEl = document.getElementById("route-total-distance");

  routeList.innerHTML = "";
  resultsDiv.classList.remove("hidden");
  distEl.innerText = `${data.totalDistance} ${data.unit}`;

  // Print start depot
  const startLi = document.createElement("li");
  startLi.innerHTML = `<i class="fa-solid fa-house-user"></i> <b>Start:</b> ${startName}`;
  routeList.appendChild(startLi);

  // Print optimized sequence
  data.optimizedRoute.forEach((node, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<i class="fa-solid fa-arrow-down-long"></i> <b>Stop ${idx + 1}:</b> ${node.name}`;
    routeList.appendChild(li);
  });

  // Plot path line on Leaflet map
  if (!state.map) return;

  if (state.routePolyline) {
    state.map.removeLayer(state.routePolyline);
  }

  const pathPoints = [[startCoords.lat, startCoords.lng]];
  data.optimizedRoute.forEach(node => {
    pathPoints.push([node.lat, node.lng]);
  });
  pathPoints.push([startCoords.lat, startCoords.lng]); // Loop back to base depot

  state.routePolyline = L.polyline(pathPoints, {
    color: 'var(--primary-color)',
    weight: 4,
    opacity: 0.8,
    dashArray: '10, 8',
    lineJoin: 'round'
  }).addTo(state.map);

  // Zoom map to fit path bounds
  state.map.fitBounds(state.routePolyline.getBounds(), { padding: [40, 40] });
}

// ----------------------------------------------------
// Role Based Access Control (RBAC) & View Constraints
// ----------------------------------------------------
function initRoleSelector() {
  const roleSelect = document.getElementById("active-role");
  const userRoleBadge = document.getElementById("user-role-badge");
  const userName = document.getElementById("user-name");

  window.switchRole = (role) => {
    state.activeRole = role;
    userRoleBadge.innerText = role;

    // Adjust user profiles for realism
    if (role === "Fleet Manager") {
      userName.innerText = "Sarah Connor";
      userRoleBadge.className = "badge";
    } else if (role === "Driver") {
      userName.innerText = "Alex Mercer";
      userRoleBadge.className = "badge";
    } else if (role === "Safety Officer") {
      userName.innerText = "Priya Patel";
      userRoleBadge.className = "badge";
    } else if (role === "Financial Analyst") {
      userName.innerText = "John Doe";
      userRoleBadge.className = "badge";
    }

    applyRBACConstraints();
    showToast("Role Switched", `Switched current session view to ${role}`, "success");
  };
}

function applyRBACConstraints() {
  // Hide or show controls based on role constraints
  const role = state.activeRole;
  
  // Drivers should only view and punch attendance, complete active trip
  const regAddButtons = document.querySelectorAll(".panel-header-actions button");
  const createTripPanel = document.querySelector(".trip-dispatch-form");
  const manageFinesBtn = document.querySelector("#view-fines .btn-danger");
  const exportSection = document.querySelector(".export-actions");

  if (role === "Driver") {
    regAddButtons.forEach(b => b.style.display = "none");
    if (createTripPanel) createTripPanel.style.display = "none";
    if (manageFinesBtn) manageFinesBtn.style.display = "none";
    if (exportSection) exportSection.style.display = "none";
    // Navigate Driver automatically to compliance attendance clock view
    switchView("compliance");
  } else {
    regAddButtons.forEach(b => b.style.display = "inline-flex");
    if (createTripPanel) createTripPanel.style.display = "block";
    if (manageFinesBtn) manageFinesBtn.style.display = "inline-flex";
    if (exportSection) exportSection.style.display = "flex";
  }
}

// ----------------------------------------------------
// UI Rendering - Registry, Trips, Maintenance, Fines
// ----------------------------------------------------
function renderAllViews() {
  renderVehicleRegistry();
  renderDriverRegistry();
  renderTripSelects();
  renderActiveTrips();
  renderFinesTable();
  renderComplianceView();
  renderPerformanceReviews();
  renderROIPanel();
  updateMapMarkers();
  renderActivityLogs();
}

function renderVehicleRegistry() {
  const tbody = document.getElementById("vehicle-table-body");
  tbody.innerHTML = "";
  
  state.db.vehicles.forEach(v => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${v.registrationNumber}</b></td>
      <td>${v.model}</td>
      <td>${v.type}</td>
      <td>${v.maxCapacity} kg</td>
      <td>${v.odometer} km</td>
      <td>$${v.acquisitionCost.toLocaleString()}</td>
      <td><span class="status-badge ${v.status.toLowerCase().replace(' ', '-')}">${v.status}</span></td>
      <td>
        ${v.status === 'Available' ? `<button class="btn btn-secondary btn-sm" onclick="window.placeInShop('${v.registrationNumber}')"><i class="fa-solid fa-screwdriver-wrench"></i> Service</button>` : ''}
        ${v.status === 'In Shop' ? `<button class="btn btn-success btn-sm" onclick="window.closeMaintenanceFor('${v.registrationNumber}')"><i class="fa-solid fa-circle-check"></i> Close</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDriverRegistry() {
  const tbody = document.getElementById("driver-table-body");
  tbody.innerHTML = "";

  state.db.drivers.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${d.name}</b></td>
      <td>${d.email}</td>
      <td><code>${d.licenseNumber}</code></td>
      <td>${d.licenseCategory}</td>
      <td>${d.licenseExpiry}</td>
      <td><i class="fa-solid fa-star" style="color: var(--primary-hover);"></i> ${d.safetyScore}</td>
      <td><span class="status-badge ${d.status.toLowerCase()}">${d.status}</span></td>
      <td>
        ${d.status === 'Suspended' ? `<button class="btn btn-secondary btn-sm" onclick="window.updateDriverStatus('${d.email}', 'Available')">Activate</button>` : `<button class="btn btn-danger btn-sm" onclick="window.updateDriverStatus('${d.email}', 'Suspended')">Suspend</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTripSelects() {
  const vSelect = document.getElementById("trip-vehicle");
  const dSelect = document.getElementById("trip-driver");

  vSelect.innerHTML = `<option value="">-- Choose Available Vehicle --</option>`;
  dSelect.innerHTML = `<option value="">-- Choose Available Driver --</option>`;

  // Exclude In Shop/Retired
  state.db.vehicles.forEach(v => {
    if (v.status === "Available") {
      vSelect.innerHTML += `<option value="${v.registrationNumber}">${v.registrationNumber} (Max ${v.maxCapacity} kg)</option>`;
    }
  });

  // Exclude Suspended/Expired licenses
  const today = new Date().toISOString().split('T')[0];
  state.db.drivers.forEach(d => {
    const isLicenseValid = d.licenseExpiry && d.licenseExpiry >= today;
    if (d.status === "Available" && isLicenseValid) {
      dSelect.innerHTML += `<option value="${d.email}">${d.name} (${d.licenseCategory})</option>`;
    }
  });
}

function renderActiveTrips() {
  const tbody = document.getElementById("trip-table-body");
  tbody.innerHTML = "";

  state.db.trips.forEach(t => {
    const driver = state.db.drivers.find(d => d.email === t.driverEmail) || { name: t.driverEmail };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${t.id}</code></td>
      <td>${t.source} → ${t.destination}</td>
      <td>${t.vehicleReg}</td>
      <td>${driver.name}</td>
      <td>${t.cargoWeight} kg</td>
      <td><span class="status-badge ${t.status.toLowerCase()}">${t.status}</span></td>
      <td>
        ${t.status === 'Draft' ? `<button class="btn btn-primary btn-sm" onclick="window.dispatchTrip('${t.id}')">Dispatch</button>` : ''}
        ${t.status === 'Dispatched' ? `<button class="btn btn-success btn-sm" onclick="window.openCompleteTripModal('${t.id}')">Complete</button>` : ''}
        ${t.status === 'Dispatched' || t.status === 'Draft' ? `<button class="btn btn-danger btn-sm" onclick="window.cancelTrip('${t.id}')">Cancel</button>` : '—'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFinesTable() {
  const tbody = document.getElementById("fines-table-body");
  tbody.innerHTML = "";

  state.db.fines.forEach(f => {
    const driver = state.db.drivers.find(d => d.email === f.driverEmail) || { name: f.driverEmail };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${driver.name}</td>
      <td><code>${f.vehicleReg}</code></td>
      <td><span style="color:#ff3b30; font-weight:600;">${f.type}</span></td>
      <td>$${f.amount}</td>
      <td>${f.date}</td>
      <td>${f.description}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ----------------------------------------------------
// Point 4 Compliance Layout (Attendance -> Driver Doc -> Vehicle Doc -> Expiry notifications)
// ----------------------------------------------------
function renderComplianceView() {
  // 1. Attendance Punch Panel
  const attendanceContainer = document.getElementById("attendance-list-container");
  
  // Render active driver roster punch indicators
  let html = `
    <div class="table-responsive">
      <table class="table">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Today's Punch Shift Status</th>
            <th>Check In</th>
            <th>Check Out</th>
            <th>Active Hours logged today</th>
            <th>HR Punches</th>
          </tr>
        </thead>
        <tbody>
  `;

  state.db.drivers.forEach(d => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayPunch = d.attendance.find(a => a.date === todayStr) || { checkIn: "", checkOut: "", hours: 0 };
    
    html += `
      <tr>
        <td><b>${d.name}</b></td>
        <td>
          <span class="status-badge ${todayPunch.checkIn ? 'available' : 'suspended'}">
            ${todayPunch.checkIn ? 'Present' : 'Absent'}
          </span>
        </td>
        <td>${todayPunch.checkIn || '—'}</td>
        <td>${todayPunch.checkOut || '—'}</td>
        <td><b>${todayPunch.hours} hrs</b></td>
        <td>
          ${!todayPunch.checkIn ? 
            `<button class="btn btn-primary btn-sm" onclick="window.punchAttendance('${d.email}', 'clock-in')">Clock In</button>` : 
            (!todayPunch.checkOut ? `<button class="btn btn-success btn-sm" onclick="window.promptClockOut('${d.email}')">Clock Out</button>` : 'Shift Closed')
          }
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  attendanceContainer.innerHTML = html;

  // 2. Driver Documents panel
  const driverDocsEl = document.getElementById("driver-docs-container");
  let driverDocsHtml = `<div class="compliance-grid">`;
  
  state.db.drivers.forEach(d => {
    const dlStatus = d.documents.drivingLicense;
    const medStatus = d.documents.medicalCertificate;
    const bgStatus = d.documents.backgroundCheck;
    
    driverDocsHtml += `
      <div class="compliance-card">
        <div class="comp-card-header">
          <span>${d.name}</span>
          <i class="fa-solid fa-user-check" style="color: var(--status-avail);"></i>
        </div>
        <div class="comp-card-detail">
          <p><b>Driving License:</b> Exp: ${dlStatus.expiry || 'N/A'} 
            <span class="status-badge ${dlStatus.status.toLowerCase()}">${dlStatus.status}</span>
          </p>
          <p style="margin-top:4px;"><b>Medical Certificate:</b> Exp: ${medStatus.expiry || 'N/A'}
            <span class="status-badge ${medStatus.status.toLowerCase()}">${medStatus.status}</span>
          </p>
          <p style="margin-top:4px;"><b>Criminal Background Check:</b> Exp: ${bgStatus.expiry || 'N/A'}
            <span class="status-badge ${bgStatus.status.toLowerCase()}">${bgStatus.status}</span>
          </p>
        </div>
      </div>
    `;
  });
  driverDocsHtml += `</div>`;
  driverDocsEl.innerHTML = driverDocsHtml;

  // 3. Vehicle Documents panel
  const vehicleDocsEl = document.getElementById("vehicle-docs-container");
  let vehicleDocsHtml = `<div class="compliance-grid">`;
  
  state.db.vehicles.forEach(v => {
    const ins = v.documents.insurance;
    const puc = v.documents.puc;
    const tax = v.documents.roadTax;

    vehicleDocsHtml += `
      <div class="compliance-card">
        <div class="comp-card-header">
          <span>${v.registrationNumber} (${v.model})</span>
          <i class="fa-solid fa-truck-ramp-box" style="color: var(--status-trip);"></i>
        </div>
        <div class="comp-card-detail">
          <p><b>Insurance Policy:</b> Exp: ${ins.expiry || 'N/A'} 
            <span class="status-badge ${ins.status.toLowerCase()}">${ins.status}</span>
          </p>
          <p style="margin-top:4px;"><b>Pollution Certificate:</b> Exp: ${puc.expiry || 'N/A'}
            <span class="status-badge ${puc.status.toLowerCase()}">${puc.status}</span>
          </p>
          <p style="margin-top:4px;"><b>Road Tax Authority:</b> Exp: ${tax.expiry || 'N/A'}
            <span class="status-badge ${tax.status.toLowerCase()}">${tax.status}</span>
          </p>
        </div>
      </div>
    `;
  });
  vehicleDocsHtml += `</div>`;
  vehicleDocsEl.innerHTML = vehicleDocsHtml;
}

// ----------------------------------------------------
// Point 5 Check Notification (Low Fuel, Oil Change, Expiries)
// ----------------------------------------------------
function checkNotifications() {
  const alertListEl = document.getElementById("dashboard-alerts-list");
  const expiryFeedEl = document.getElementById("expiry-feed-list");
  
  alertListEl.innerHTML = "";
  expiryFeedEl.innerHTML = "";

  const alerts = [];
  const today = new Date();

  // 1. License Expiry Alerts (< 30 days)
  state.db.drivers.forEach(d => {
    if (d.licenseExpiry) {
      const expDate = new Date(d.licenseExpiry);
      const diffTime = expDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < 0) {
        alerts.push({
          type: "critical",
          title: `Driver License Expired: ${d.name}`,
          desc: `License expired on ${d.licenseExpiry}. Suspend assignment dispatch operations immediately!`
        });
      } else if (diffDays <= 30) {
        alerts.push({
          type: "warning",
          title: `Driver License Expiring Soon: ${d.name}`,
          desc: `License expires in ${diffDays} days (${d.licenseExpiry}). Request renewal document submission.`
        });
      }
    }
  });

  // 2. Vehicle Document Expiry Alerts (< 30 days)
  state.db.vehicles.forEach(v => {
    Object.keys(v.documents).forEach(docKey => {
      const doc = v.documents[docKey];
      if (doc.expiry) {
        const expDate = new Date(doc.expiry);
        const diffTime = expDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
          alerts.push({
            type: "critical",
            title: `Vehicle document Expired: ${v.registrationNumber}`,
            desc: `The document ${docKey.toUpperCase()} (ID: ${doc.docId}) expired on ${doc.expiry}.`
          });
        } else if (diffDays <= 30) {
          alerts.push({
            type: "warning",
            title: `Vehicle Document Expiry Alert: ${v.registrationNumber}`,
            desc: `The document ${docKey.toUpperCase()} expires in ${diffDays} days (${doc.expiry}).`
          });
        }
      }
    });

    // 3. Fuel Level Alerts (< 15%)
    if (v.fuelLevel < 15) {
      alerts.push({
        type: "warning",
        title: `Low Fuel Telemetry Alert: ${v.registrationNumber}`,
        desc: `Current fuel level is ${v.fuelLevel}%. Re-route to nearest fuel depot immediately.`
      });
    }

    // 4. Predictive Oil Change Alerts (approaching 10,000 km range limit)
    const currentOdo = v.odometer;
    const lastChange = v.lastOilChangeKm || 0;
    const diffKm = currentOdo - lastChange;
    const rangeLimit = 10000; // standard engine oil change range limit
    
    if (diffKm >= rangeLimit) {
      alerts.push({
        type: "critical",
        title: `Engine Oil Replacement Required: ${v.registrationNumber}`,
        desc: `Odometer range reached ${diffKm} km since last oil change. Schedule immediate engine service.`
      });
    } else if (diffKm >= (rangeLimit - 1500)) {
      alerts.push({
        type: "warning",
        title: `Engine Oil Replacement Approaching: ${v.registrationNumber}`,
        desc: `Vehicle has driven ${diffKm} km of the ${rangeLimit} km engine oil life range.`
      });
    }
  });

  // Render warnings in Dashboards & Compliance Feed
  if (alerts.length === 0) {
    alertListEl.innerHTML = `<p style="padding: 10px; color: var(--status-avail);">All driver licensing, fuel levels, and oil lifecycles are in optimal parameters.</p>`;
    expiryFeedEl.innerHTML = `<p style="padding: 10px; color: var(--status-avail);">No warning alerts present.</p>`;
    return;
  }

  alerts.forEach(alert => {
    // Render Toast alerts on loading
    // Render lists
    const alertHtml = `
      <div class="alert-item">
        <span class="alert-item-status ${alert.type === 'critical' ? 'active-alert' : ''}"></span>
        <div>
          <h4 style="font-size:0.92rem; color:${alert.type === 'critical' ? '#ff3b30' : '#ffcc00'};">${alert.title}</h4>
          <p style="font-size:0.8rem; margin-top:2px;">${alert.desc}</p>
        </div>
      </div>
    `;
    alertListEl.innerHTML += alertHtml;

    // Render in compliance view (point 4.4)
    const cardClass = alert.type === 'critical' ? 'critical' : 'warning';
    const iconClass = alert.type === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation';
    
    const feedHtml = `
      <div class="expiry-alert-card ${cardClass}">
        <div class="expiry-left">
          <i class="fa-solid ${iconClass} expiry-icon"></i>
          <div class="expiry-info">
            <h5>${alert.title}</h5>
            <p>${alert.desc}</p>
          </div>
        </div>
      </div>
    `;
    expiryFeedEl.innerHTML += feedHtml;
  });

  // Update KPI available counts
  const availableCount = state.db.vehicles.filter(v => v.status === "Available").length;
  const activeCount = state.db.trips.filter(t => t.status === "Dispatched").length;
  const shopCount = state.db.vehicles.filter(v => v.status === "In Shop").length;
  const dutyDrivers = state.db.drivers.filter(d => d.status === "On Trip" || d.attendance.some(a => a.date === today.toISOString().split('T')[0] && a.checkIn)).length;

  document.getElementById("kpi-avail-vehicles").innerText = availableCount;
  document.getElementById("kpi-active-trips").innerText = activeCount;
  document.getElementById("kpi-maint-vehicles").innerText = shopCount;
  document.getElementById("kpi-drivers-duty").innerText = dutyDrivers;

  const totalVehiclesCount = state.db.vehicles.length;
  const utilization = totalVehiclesCount > 0 ? Math.round(((activeCount + shopCount) / totalVehiclesCount) * 100) : 0;
  document.getElementById("kpi-fleet-utilization").innerText = `${utilization}%`;
}

// ----------------------------------------------------
// Driver Review & Salary Hike calculation engine
// ----------------------------------------------------
function renderPerformanceReviews() {
  const container = document.getElementById("performance-hike-panel");
  container.innerHTML = "";

  state.db.drivers.forEach(d => {
    // Calculate total hours worked in all logs
    const totalHours = d.attendance.reduce((sum, day) => sum + (day.hours || 0), 0);
    
    // Check hike eligibility
    // Rating must be >= 4.5 and working hours >= 40 (meaning active attendance hours)
    const isEligible = d.safetyScore >= 4.5 && totalHours >= 40;
    const avgRating = d.safetyScore;

    // Build lists of passenger reviews
    let reviewsHtml = `<div style="margin-top:10px; max-height: 100px; overflow-y:auto;">`;
    d.reviews.forEach(r => {
      reviewsHtml += `
        <div style="font-size:0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 4px 0; color:var(--text-secondary);">
          <b>${r.passenger}:</b> "${r.comment}" (${r.rating}★)
        </div>
      `;
    });
    reviewsHtml += `</div>`;

    const card = document.createElement("div");
    card.className = "performance-card";
    card.innerHTML = `
      <div class="perf-header">
        <strong>${d.name}</strong>
        <span class="perf-rating"><i class="fa-solid fa-star"></i> ${avgRating} / 5.0</span>
      </div>
      <p style="font-size:0.85rem;">Total Logged Hours: <b>${totalHours} hours</b></p>
      
      ${reviewsHtml}

      <div class="hike-actions-area" style="margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          ${isEligible ? 
            `<span class="perf-hike-badge"><i class="fa-solid fa-money-bill-trend-up"></i> Eligible for Hike (+15%)</span>` :
            `<span class="perf-hike-badge ineligible">Hike Criteria Unmet (Rating ≥ 4.5 & Hours ≥ 40)</span>`
          }
        </div>
        ${isEligible ? 
          `<button class="btn btn-success btn-sm" onclick="window.applySalaryHikePrompt('${d.name}', '${d.email}')">Award Hike</button>` : 
          `<button class="btn btn-secondary btn-sm" onclick="window.openAddReviewModal('${d.email}')">Add Rating</button>`
        }
      </div>
    `;
    container.innerHTML += card.outerHTML;
  });
}

window.applySalaryHikePrompt = (name, email) => {
  showToast("Salary Hike Approved", `Driver ${name} received a salary package appraisal of +15% based on customer rating reviews!`, "success");
};

// ----------------------------------------------------
// ROI Reports calculation table
// ----------------------------------------------------
function renderROIPanel() {
  const tbody = document.getElementById("roi-table-body");
  tbody.innerHTML = "";

  state.db.vehicles.forEach(v => {
    // Operational Cost = Maintenance + Fuel costs logged for this vehicle
    const maintCost = state.db.maintenanceLogs
      .filter(m => m.vehicleReg === v.registrationNumber)
      .reduce((sum, m) => sum + m.cost, 0);

    const fuelCost = state.db.fuelLogs
      .filter(f => f.vehicleReg === v.registrationNumber)
      .reduce((sum, f) => sum + f.cost, 0);

    const totalOpsCost = maintCost + fuelCost;

    // Mock generated Revenue based on completed trips distance
    const tripsDone = state.db.trips.filter(t => t.vehicleReg === v.registrationNumber && t.status === "Completed");
    const totalKm = tripsDone.reduce((sum, t) => sum + t.distance, 0);
    const mockRevenue = totalKm * 12; // Assume earning $12 per km of cargo transit

    // ROI formula: (Revenue - OperationsCost) / AcquisitionCost
    let roi = 0;
    if (v.acquisitionCost > 0) {
      roi = ((mockRevenue - totalOpsCost) / v.acquisitionCost) * 100;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${v.registrationNumber}</b> (${v.model})</td>
      <td>$${mockRevenue.toLocaleString()}</td>
      <td>$${maintCost.toLocaleString()}</td>
      <td>$${fuelCost.toLocaleString()}</td>
      <td>$${v.acquisitionCost.toLocaleString()}</td>
      <td><span style="font-weight:700; color:${roi >= 0 ? 'var(--status-avail)' : 'var(--status-suspended)'};">${roi.toFixed(1)}%</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ----------------------------------------------------
// Action Log render
// ----------------------------------------------------
function renderActivityLogs() {
  const container = document.getElementById("dashboard-logs-list");
  container.innerHTML = "";
  
  const sortedLogs = [...state.db.activityLogs].reverse();
  sortedLogs.forEach(log => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `
      <span><b>${log.user}:</b> ${log.action}</span>
      <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
    `;
    container.appendChild(item);
  });
}

// ----------------------------------------------------
// Toast Notification
// ----------------------------------------------------
function showToast(title, desc, type = "info") {
  const container = document.getElementById("alert-banner-container");
  
  const toast = document.createElement("div");
  toast.className = `alert-toast ${type}`;
  
  let icon = '<i class="fa-solid fa-circle-info"></i>';
  if (type === "success") icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === "warning") icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
  if (type === "critical") icon = '<i class="fa-solid fa-skull-crossbones"></i>';

  toast.innerHTML = `
    <div class="alert-toast-icon">${icon}</div>
    <div class="alert-toast-content">
      <h4>${title}</h4>
      <p>${desc}</p>
    </div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s reverse forwards";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// ----------------------------------------------------
// Modal Handlers & Submit Forms
// ----------------------------------------------------
window.showModal = (id) => {
  document.getElementById(id).classList.add("active");
};

window.hideModal = (id) => {
  document.getElementById(id).classList.remove("active");
};

function setupEventListeners() {
  // Add Vehicle Form
  document.getElementById("form-add-vehicle").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      registrationNumber: document.getElementById("add-v-reg").value,
      model: document.getElementById("add-v-model").value,
      type: document.getElementById("add-v-type").value,
      maxCapacity: document.getElementById("add-v-capacity").value,
      odometer: document.getElementById("add-v-odometer").value,
      acquisitionCost: document.getElementById("add-v-cost").value,
      user: state.activeRole
    };

    try {
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showToast("Vehicle Registered", `Successfully added vehicle ${data.registrationNumber}`, "success");
        hideModal("modal-add-vehicle");
        e.target.reset();
        await fetchDbState();
        renderAllViews();
        checkNotifications();
      } else {
        const err = await res.json();
        showToast("Registration Error", err.error, "critical");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Add Driver Form
  document.getElementById("form-add-driver").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById("add-d-name").value,
      email: document.getElementById("add-d-email").value,
      licenseNumber: document.getElementById("add-d-license").value,
      licenseCategory: document.getElementById("add-d-category").value,
      licenseExpiry: document.getElementById("add-d-expiry").value,
      contact: document.getElementById("add-d-contact").value,
      user: state.activeRole
    };

    try {
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showToast("Driver Registered", `Successfully added driver ${data.name}`, "success");
        hideModal("modal-add-driver");
        e.target.reset();
        await fetchDbState();
        renderAllViews();
        checkNotifications();
      } else {
        const err = await res.json();
        showToast("Driver Error", err.error, "critical");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Create Dispatch Trip Form
  document.getElementById("dispatch-trip-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      source: document.getElementById("trip-source").value,
      destination: document.getElementById("trip-destination").value,
      vehicleReg: document.getElementById("trip-vehicle").value,
      driverEmail: document.getElementById("trip-driver").value,
      cargoWeight: document.getElementById("trip-cargo").value,
      distance: document.getElementById("trip-distance").value,
      user: state.activeRole
    };

    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showToast("Trip Created", `Trip registered in Draft status. Wait for Dispatch.`, "success");
        e.target.reset();
        await fetchDbState();
        renderAllViews();
        checkNotifications();
      } else {
        const err = await res.json();
        showToast("Dispatch Validation Failed", err.error, "critical");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Complete Trip Form (Telemetry submit)
  document.getElementById("form-complete-trip").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      tripId: document.getElementById("complete-trip-id").value,
      endOdometer: document.getElementById("complete-odo").value,
      fuelConsumedLiters: document.getElementById("complete-fuel-liters").value,
      fuelCost: document.getElementById("complete-fuel-cost").value,
      user: state.activeRole
    };

    try {
      const res = await fetch("/api/trips/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showToast("Trip Closed", `Odometer updated. Fuel consumption logged successfully.`, "success");
        hideModal("modal-complete-trip");
        e.target.reset();
        await fetchDbState();
        renderAllViews();
        checkNotifications();
      } else {
        const err = await res.json();
        showToast("Telemetry validation error", err.error, "critical");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Log Fine Form
  document.getElementById("form-add-fine").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      driverEmail: document.getElementById("fine-d-email").value,
      vehicleReg: document.getElementById("fine-v-reg").value,
      type: document.getElementById("fine-type").value,
      amount: document.getElementById("fine-amount").value,
      description: document.getElementById("fine-desc").value,
      user: state.activeRole
    };

    try {
      const res = await fetch("/api/fines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showToast("Fine citation logged", `Logged a fine record for ${data.driverEmail}`, "success");
        hideModal("modal-add-fine");
        e.target.reset();
        await fetchDbState();
        renderAllViews();
        checkNotifications();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Route optimize button
  document.getElementById("btn-optimize-route").addEventListener("click", runRouteOptimization);
}

// ----------------------------------------------------
// Additional Global Operational Actions
// ----------------------------------------------------
window.dispatchTrip = async (id) => {
  try {
    const res = await fetch("/api/trips/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: id, user: state.activeRole })
    });
    if (res.ok) {
      showToast("Trip Dispatched", `Vehicle and Driver statuses updated to 'On Trip'`, "success");
      await fetchDbState();
      renderAllViews();
      checkNotifications();
    }
  } catch (err) {
    console.error(err);
  }
};

window.cancelTrip = async (id) => {
  try {
    const res = await fetch("/api/trips/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: id, user: state.activeRole })
    });
    if (res.ok) {
      showToast("Trip Cancelled", `Restored Vehicle and Driver to 'Available'`, "warning");
      await fetchDbState();
      renderAllViews();
      checkNotifications();
    }
  } catch (err) {
    console.error(err);
  }
};

window.openCompleteTripModal = (id) => {
  document.getElementById("complete-trip-id").value = id;
  showModal("modal-complete-trip");
};

window.updateDriverStatus = async (email, newStatus) => {
  // Basic mock API call for setting status
  showToast("Driver Status Changed", `Updated status to ${newStatus}`, "success");
};

window.placeInShop = async (vehicleReg) => {
  // Puts vehicle under maintenance logs
  try {
    const res = await fetch("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleReg: vehicleReg,
        description: "Scheduled engine oil and telemetry checkup",
        cost: 250,
        user: state.activeRole
      })
    });
    if (res.ok) {
      showToast("Placed In Shop", `Vehicle ${vehicleReg} is now marked 'In Shop' and excluded from dispatch pool.`, "success");
      await fetchDbState();
      renderAllViews();
      checkNotifications();
    }
  } catch (err) {
    console.error(err);
  }
};

window.closeMaintenanceFor = async (vehicleReg) => {
  // Find open maintenance request for vehicle
  const openLog = state.db.maintenanceLogs.find(l => l.vehicleReg === vehicleReg && l.status === "In Progress");
  if (!openLog) return;
  
  try {
    const res = await fetch("/api/maintenance/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: openLog.id,
        user: state.activeRole
      })
    });
    if (res.ok) {
      showToast("Maintenance Closed", `Vehicle ${vehicleReg} returned to 'Available'`, "success");
      await fetchDbState();
      renderAllViews();
      checkNotifications();
    }
  } catch (err) {
    console.error(err);
  }
};

// Punch Attendance logic
window.punchAttendance = async (email, action) => {
  let activeHours = 8;
  if (action === 'clock-out') {
    // Pick daily hours
    activeHours = parseFloat(prompt("Enter total hours worked during today's dispatch shift (Breaching limit is > 10 hours):", "8")) || 8;
  }

  try {
    const res = await fetch("/api/drivers/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        action: action,
        time: new Date().toLocaleTimeString().slice(0, 5),
        hours: activeHours,
        user: state.activeRole
      })
    });
    if (res.ok) {
      showToast("Attendance Punch Logged", `Driver shift punch recorded: ${action.toUpperCase()}`, "success");
      await fetchDbState();
      renderAllViews();
      checkNotifications();
    }
  } catch (err) {
    console.error(err);
  }
};

window.promptClockOut = (email) => {
  window.punchAttendance(email, 'clock-out');
};

// ----------------------------------------------------
// Passenger Review Modal Mock
// ----------------------------------------------------
window.openAddReviewModal = async (email) => {
  const rating = prompt("Enter Passenger rating stars (1-5):", "5");
  const comment = prompt("Enter passenger review description comment:", "Safe driving, arrived on time!");
  
  if (rating === null || comment === null) return;
  
  try {
    const res = await fetch("/api/drivers/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        passenger: "Rider " + Math.floor(Math.random() * 50 + 1),
        rating: Number(rating),
        comment: comment,
        user: state.activeRole
      })
    });
    if (res.ok) {
      showToast("Passenger Review Logged", "Driver safety scores updated successfully", "success");
      await fetchDbState();
      renderAllViews();
    }
  } catch (err) {
    console.error(err);
  }
};

// Add driver selection to fine modal when opened
document.querySelector("[onclick=\"window.showModal('modal-add-fine')\"]").addEventListener("click", () => {
  const select = document.getElementById("fine-d-email");
  select.innerHTML = "";
  state.db.drivers.forEach(d => {
    select.innerHTML += `<option value="${d.email}">${d.name} (${d.email})</option>`;
  });
});

// Setup sub-registry views
window.switchRegistryTab = (tabName) => {
  const panels = document.querySelectorAll(".registry-tab-panel");
  const buttons = document.querySelectorAll(".reg-tab");
  
  panels.forEach(p => p.classList.remove("active"));
  buttons.forEach(b => b.classList.remove("active"));

  document.getElementById(`registry-${tabName}`).classList.add("active");
  event.currentTarget.classList.add("active");
};

// ----------------------------------------------------
// CSV / PDF Exports Mock
// ----------------------------------------------------
window.exportCSV = () => {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Registration Number,Model,Type,Odometer,Status,Fuel Level,Acquisition Cost\n";
  
  state.db.vehicles.forEach(v => {
    csvContent += `${v.registrationNumber},${v.model},${v.type},${v.odometer},${v.status},${v.fuelLevel}%,$${v.acquisitionCost}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "TransitOps_Fleet_Report.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV Export Started", "TransitOps Fleet Report spreadsheet downloaded.", "success");
};

window.exportPDF = () => {
  showToast("PDF Exporting", "Compiling document layouts and financial statements. PDF generated.", "success");
};
