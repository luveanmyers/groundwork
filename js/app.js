/*
  app.js
  ------
  This file controls what's on screen. It reads data through the functions
  in storage.js (getTrips, addPackingItem, etc.) and turns that data into
  HTML, then puts that HTML into the page.

  The pattern used here is deliberately simple for learning purposes:
    1. Something happens (the app loads, or you click a button).
    2. We call a "render" function.
    3. The render function asks storage.js for the current data.
    4. It builds an HTML string from that data and drops it into a
       container element with .innerHTML = "...".
    5. Buttons in that HTML call plain global functions (e.g.
       onclick="showTab('packing')") which usually change a tiny bit of
       state and then call a render function again.

  This "re-render everything from data" approach is less efficient than
  frameworks like React, but it's much easier to follow when you're
  learning, because there's no hidden magic - the UI is always just a
  direct reflection of whatever is in localStorage.
*/

// ---- View state (kept in memory only, not saved to localStorage) ----
// Which bottom-nav tab is currently showing, while inside a trip.
let currentTab = "itinerary";

// Grabs the single element we render everything into.
function appRoot() {
  return document.getElementById("app");
}

// The main entry point. Decides: show the "pick a trip" screen, or show
// the currently active trip's screen.
function render() {
  const trip = getActiveTrip();
  if (!trip) {
    renderTripsScreen();
  } else {
    renderTripScreen(trip);
  }
}

/* ========================================================================
   SCREEN 1: Trip list / create a trip
   ======================================================================== */

function renderTripsScreen() {
  const trips = getTrips();

  const tripRows = trips
    .map(
      (t) => `
      <div class="card trip-row" onclick="openTrip('${t.id}')">
        <div>
          <div class="trip-name">${escapeHtml(t.name)}</div>
          <div class="muted">${escapeHtml(t.destination || "")} ${formatDateRange(t.startDate, t.endDate)}</div>
        </div>
        <button class="icon-btn danger" onclick="event.stopPropagation(); confirmDeleteTrip('${t.id}')" aria-label="Delete trip">&times;</button>
      </div>`
    )
    .join("");

  appRoot().innerHTML = `
    <header class="app-header">
      <h1>My Trips</h1>
    </header>
    <main class="screen">
      ${trips.length ? tripRows : `<p class="muted empty-state">No trips yet. Add your first one below - everything you enter is stored only on this phone.</p>`}

      <form class="card form" onsubmit="handleCreateTrip(event)">
        <h2>New trip</h2>
        <label>Trip name
          <input name="name" type="text" placeholder="e.g. Japan 2026" required />
        </label>
        <label>Destination
          <input name="destination" type="text" placeholder="e.g. Tokyo, Japan" />
        </label>
        <div class="row">
          <label>Start date
            <input name="startDate" type="date" />
          </label>
          <label>End date
            <input name="endDate" type="date" />
          </label>
        </div>
        <button class="primary" type="submit">Create trip</button>
      </form>
    </main>
  `;
}

function handleCreateTrip(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  if (!name) return;
  createTrip({
    name,
    destination: form.destination.value.trim(),
    startDate: form.startDate.value,
    endDate: form.endDate.value
  });
  currentTab = "itinerary";
  render();
}

function openTrip(tripId) {
  setActiveTrip(tripId);
  currentTab = "itinerary";
  render();
}

function confirmDeleteTrip(tripId) {
  if (confirm("Delete this trip and everything in it? This can't be undone.")) {
    deleteTrip(tripId);
    render();
  }
}

/* ========================================================================
   SCREEN 2: Inside a trip (itinerary / packing / budget / notes)
   ======================================================================== */

function renderTripScreen(trip) {
  appRoot().innerHTML = `
    <header class="app-header">
      <button class="icon-btn" onclick="backToTrips()" aria-label="Back to trips">&larr;</button>
      <div>
        <h1>${escapeHtml(trip.name)}</h1>
        <div class="muted small">${escapeHtml(trip.destination || "")} ${formatDateRange(trip.startDate, trip.endDate)}</div>
      </div>
    </header>
    <main class="screen" id="tab-content"></main>
    <nav class="tab-bar">
      <button class="tab-btn ${currentTab === "itinerary" ? "active" : ""}" onclick="showTab('itinerary')">Itinerary</button>
      <button class="tab-btn ${currentTab === "packing" ? "active" : ""}" onclick="showTab('packing')">Packing</button>
      <button class="tab-btn ${currentTab === "budget" ? "active" : ""}" onclick="showTab('budget')">Budget</button>
      <button class="tab-btn ${currentTab === "notes" ? "active" : ""}" onclick="showTab('notes')">Notes</button>
    </nav>
  `;
  renderTabContent(trip);
}

function backToTrips() {
  setActiveTrip(null);
  render();
}

function showTab(tab) {
  currentTab = tab;
  const trip = getActiveTrip();
  if (trip) renderTripScreen(trip);
}

function renderTabContent(trip) {
  const el = document.getElementById("tab-content");
  if (currentTab === "itinerary") el.innerHTML = itineraryTabHtml(trip);
  else if (currentTab === "packing") el.innerHTML = packingTabHtml(trip);
  else if (currentTab === "budget") el.innerHTML = budgetTabHtml(trip);
  else if (currentTab === "notes") el.innerHTML = notesTabHtml(trip);
}

/* ---------------------------- Itinerary tab ---------------------------- */

function itineraryTabHtml(trip) {
  const items = getItinerary(trip.id);
  const rows = items
    .map(
      (i) => `
      <div class="card list-row">
        <div>
          <div class="row-title">${itineraryIcon(i.type)} ${escapeHtml(i.title)}</div>
          <div class="muted small">${formatDate(i.date)}${i.time ? " &middot; " + escapeHtml(i.time) : ""}</div>
          ${i.details ? `<div class="small">${escapeHtml(i.details)}</div>` : ""}
        </div>
        <button class="icon-btn danger" onclick="handleDeleteItinerary('${trip.id}', '${i.id}')" aria-label="Delete">&times;</button>
      </div>`
    )
    .join("");

  return `
    ${items.length ? rows : emptyStateHtml("No itinerary items yet. Add flights, lodging, or activities below.")}
    <form class="card form" onsubmit="handleAddItinerary(event, '${trip.id}')">
      <h2>Add to itinerary</h2>
      <label>Type
        <select name="type">
          <option value="flight">Flight</option>
          <option value="lodging">Lodging</option>
          <option value="activity">Activity</option>
          <option value="transport">Transport</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Title
        <input name="title" type="text" placeholder="e.g. Flight to Tokyo (NH 106)" required />
      </label>
      <div class="row">
        <label>Date
          <input name="date" type="date" />
        </label>
        <label>Time
          <input name="time" type="time" />
        </label>
      </div>
      <label>Details
        <textarea name="details" placeholder="Confirmation #, address, notes..."></textarea>
      </label>
      <button class="primary" type="submit">Add item</button>
    </form>
  `;
}

function itineraryIcon(type) {
  return { flight: "&#9992;", lodging: "&#127968;", activity: "&#128506;", transport: "&#128652;" }[type] || "&#128204;";
}

function handleAddItinerary(event, tripId) {
  event.preventDefault();
  const form = event.target;
  addItineraryItem(tripId, {
    type: form.type.value,
    title: form.title.value.trim(),
    date: form.date.value,
    time: form.time.value,
    details: form.details.value.trim()
  });
  renderTabContent(getActiveTrip());
}

function handleDeleteItinerary(tripId, itemId) {
  deleteItineraryItem(tripId, itemId);
  renderTabContent(getActiveTrip());
}

/* ----------------------------- Packing tab ----------------------------- */

function packingTabHtml(trip) {
  const items = getPackingItems(trip.id);
  const byCategory = groupBy(items, (i) => i.category || "General");

  const sections = Object.keys(byCategory)
    .sort()
    .map((cat) => {
      const rows = byCategory[cat]
        .map(
          (i) => `
        <label class="check-row">
          <input type="checkbox" ${i.checked ? "checked" : ""} onchange="handleTogglePacking('${trip.id}', '${i.id}')" />
          <span class="${i.checked ? "checked-text" : ""}">${escapeHtml(i.text)}</span>
          <button class="icon-btn danger" type="button" onclick="handleDeletePacking('${trip.id}', '${i.id}')" aria-label="Delete">&times;</button>
        </label>`
        )
        .join("");
      return `<div class="card"><h2>${escapeHtml(cat)}</h2>${rows}</div>`;
    })
    .join("");

  const packed = items.filter((i) => i.checked).length;

  return `
    ${items.length ? `<p class="muted small">${packed} / ${items.length} packed</p>` : ""}
    ${items.length ? sections : emptyStateHtml("No packing items yet. Add some below.")}
    <form class="card form" onsubmit="handleAddPacking(event, '${trip.id}')">
      <h2>Add packing item</h2>
      <div class="row">
        <label>Item
          <input name="text" type="text" placeholder="e.g. Passport" required />
        </label>
        <label>Category
          <input name="category" type="text" placeholder="e.g. Documents" />
        </label>
      </div>
      <button class="primary" type="submit">Add item</button>
    </form>
  `;
}

function handleAddPacking(event, tripId) {
  event.preventDefault();
  const form = event.target;
  addPackingItem(tripId, form.text.value.trim(), form.category.value.trim());
  renderTabContent(getActiveTrip());
}

function handleTogglePacking(tripId, itemId) {
  togglePackingItem(tripId, itemId);
  renderTabContent(getActiveTrip());
}

function handleDeletePacking(tripId, itemId) {
  deletePackingItem(tripId, itemId);
  renderTabContent(getActiveTrip());
}

/* ----------------------------- Budget tab ------------------------------ */

function budgetTabHtml(trip) {
  const items = getBudgetItems(trip.id);
  const total = items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

  const rows = items
    .map(
      (i) => `
      <div class="card list-row">
        <div>
          <div class="row-title">${escapeHtml(i.description)}</div>
          <div class="muted small">${escapeHtml(i.category || "")} ${i.date ? "&middot; " + formatDate(i.date) : ""}</div>
        </div>
        <div class="row-right">
          <span class="amount">${formatAmount(i.amount, i.currency)}</span>
          <button class="icon-btn danger" onclick="handleDeleteBudget('${trip.id}', '${i.id}')" aria-label="Delete">&times;</button>
        </div>
      </div>`
    )
    .join("");

  return `
    <div class="card total-card">
      <span>Total spent</span>
      <span class="total-amount">${formatAmount(total, items[0]?.currency)}</span>
    </div>
    ${items.length ? rows : emptyStateHtml("No expenses logged yet.")}
    <form class="card form" onsubmit="handleAddBudget(event, '${trip.id}')">
      <h2>Log an expense</h2>
      <label>Description
        <input name="description" type="text" placeholder="e.g. Hotel deposit" required />
      </label>
      <div class="row">
        <label>Amount
          <input name="amount" type="number" step="0.01" placeholder="0.00" required />
        </label>
        <label>Currency
          <input name="currency" type="text" placeholder="USD" maxlength="6" />
        </label>
      </div>
      <div class="row">
        <label>Category
          <input name="category" type="text" placeholder="e.g. Lodging" />
        </label>
        <label>Date
          <input name="date" type="date" />
        </label>
      </div>
      <button class="primary" type="submit">Add expense</button>
    </form>
  `;
}

function handleAddBudget(event, tripId) {
  event.preventDefault();
  const form = event.target;
  addBudgetItem(tripId, {
    description: form.description.value.trim(),
    amount: form.amount.value,
    currency: form.currency.value.trim().toUpperCase(),
    category: form.category.value.trim(),
    date: form.date.value
  });
  renderTabContent(getActiveTrip());
}

function handleDeleteBudget(tripId, itemId) {
  deleteBudgetItem(tripId, itemId);
  renderTabContent(getActiveTrip());
}

/* ------------------------------ Notes tab ------------------------------- */
// Used for confirmation numbers, passport/visa reminders, insurance info, etc.

function notesTabHtml(trip) {
  const notes = getNotes(trip.id);
  const rows = notes
    .map(
      (n) => `
      <div class="card list-row">
        <div>
          <div class="row-title">${escapeHtml(n.title)}</div>
          <div class="small note-body">${escapeHtml(n.body)}</div>
        </div>
        <button class="icon-btn danger" onclick="handleDeleteNote('${trip.id}', '${n.id}')" aria-label="Delete">&times;</button>
      </div>`
    )
    .join("");

  return `
    ${notes.length ? rows : emptyStateHtml("No notes yet. Good things to save here: confirmation numbers, passport/visa expiry dates, insurance policy numbers, emergency contacts.")}
    <form class="card form" onsubmit="handleAddNote(event, '${trip.id}')">
      <h2>Add a note</h2>
      <label>Title
        <input name="title" type="text" placeholder="e.g. Passport expiry" required />
      </label>
      <label>Details
        <textarea name="body" placeholder="e.g. Expires 2029-03-14" required></textarea>
      </label>
      <button class="primary" type="submit">Save note</button>
    </form>
  `;
}

function handleAddNote(event, tripId) {
  event.preventDefault();
  const form = event.target;
  addNote(tripId, { title: form.title.value.trim(), body: form.body.value.trim() });
  renderTabContent(getActiveTrip());
}

function handleDeleteNote(tripId, noteId) {
  deleteNote(tripId, noteId);
  renderTabContent(getActiveTrip());
}

/* ------------------------------- Helpers -------------------------------- */

function emptyStateHtml(text) {
  return `<p class="muted empty-state">${escapeHtml(text)}</p>`;
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateRange(start, end) {
  if (!start && !end) return "";
  if (start && end) return `&middot; ${formatDate(start)} - ${formatDate(end)}`;
  return `&middot; ${formatDate(start || end)}`;
}

function formatAmount(amount, currency) {
  const num = parseFloat(amount) || 0;
  return `${num.toFixed(2)} ${currency || ""}`.trim();
}

// Prevents anything typed into a form (like a trip name) from being
// interpreted as HTML/JS when we drop it into innerHTML later.
function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* -------------------------------- Boot ----------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  render();

  // Register the service worker so the app keeps working with no signal.
  // This is what makes "Add to Home Screen" behave like a real offline app.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }
});
