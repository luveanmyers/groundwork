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

// Which Ideas-tab filters are currently applied. "all" means that filter
// isn't narrowing anything. Kept in memory only (like currentTab) - a
// filter is a way of looking at your ideas, not part of the ideas
// themselves, so it doesn't belong in storage.js.
function defaultIdeaFilters() {
  return {
    activityType: "all",
    style: "all",
    region: "all",
    stage: "all",
    reservation: "all",
    urgentOnly: false
  };
}
let ideaFilters = defaultIdeaFilters();

// Which idea cards are currently expanded on the kanban board, and
// which card (if any) is mid-drag. Both are purely about how the board
// LOOKS right now, not the ideas themselves, so - like currentTab and
// ideaFilters above - they live in memory only and reset when you
// switch trips.
let expandedIdeaIds = new Set();
let draggedIdeaId = null;

// Whether the "Add an idea" form is currently open. Same reasoning as
// above - the form used to always sit at the bottom of the page, which
// felt heavy; now it's tucked behind a "+ Add idea" button and this
// just tracks whether that's currently expanded.
let isAddIdeaFormOpen = false;

// Which view the Ideas tab is showing: the kanban "board" (the
// original/default) or the newer "map" view for comparing candidates
// geographically. See product-decisions.md's "Map view" section and
// mockup/map-table-mockup.html (retired once this was confirmed) for
// what was reviewed before this got built. Same in-memory-only
// treatment as everything else in this block.
let ideasView = "board";

// --- TEMPORARY: demo pin preview (delete this whole block once Phase 2
// wires up real geocoding + real pin positions) ---
// Lets the pin/hover/click/scroll-sync interaction be evaluated now,
// against fake positions, without waiting on real geocoding. Off by
// default; never persisted; never written to idea.location - purely a
// render-time overlay. See product-decisions.md's "Map view" section.
let mapDemoPinsEnabled = false;
let mapActiveIdeaId = null;
let mapClickedIdeaId = null;

// Which top-level screen is showing: "home" (the bento landing page),
// "tripsList" (My Trips), "newTrip" (the create-trip form), or "trip"
// (inside an active trip - itinerary/packing/etc. tabs). In-memory
// only, like everything else in this block - always starts back at
// "home" on a fresh load, by design (see product-decisions.md's Home
// screen section), even if a trip is still active - the hero banner
// on Home is what lets you jump straight back in.
let currentScreen = "home";

// Whether the hamburger dropdown (shown on every screen except Home)
// is currently open. In-memory only.
let isMenuOpen = false;

// Grabs the single element we render everything into.
function appRoot() {
  return document.getElementById("app");
}

// The main entry point. Decides which top-level screen to show, based
// on currentScreen. Home is deliberately NOT gated on whether a trip
// exists - it's always reachable, and its hero banner is what shows/
// hides depending on trip state (see renderHomeScreen below).
function render() {
  if (currentScreen === "tripsList") {
    renderTripsListScreen();
  } else if (currentScreen === "newTrip") {
    renderNewTripScreen();
  } else if (currentScreen === "trip") {
    const trip = getActiveTrip();
    if (!trip) {
      // Active trip vanished (e.g. deleted) - fall back to Home rather
      // than rendering a blank screen.
      currentScreen = "home";
      renderHomeScreen();
    } else {
      renderTripScreen(trip);
    }
  } else {
    renderHomeScreen();
  }
}

/* ------------------------- Navigation helpers ------------------------- */
// Every screen change goes through one of these three, so there's a
// single place that closes the hamburger menu and re-renders - no
// screen-switching code path can forget to do either.

function goHome() {
  currentScreen = "home";
  isMenuOpen = false;
  render();
}

function goToScreen(screen) {
  currentScreen = screen;
  isMenuOpen = false;
  render();
}

function toggleMenu() {
  isMenuOpen = !isMenuOpen;
  render();
}

/* ---------------------------- Small icon svgs --------------------------- */
// Plain inline SVGs (not an icon font/library, to keep this dependency-
// free) reused across the hamburger dropdown and the Home bento tiles.
// `cls` lets a caller add "tile-icon" for the bigger bento sizing; the
// dropdown uses the default (no class) size below.

function hamburgerIconSvg(cls) {
  return `<svg class="${cls || ""}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
}
function homeIconSvg(cls) {
  return `<svg class="${cls || ""}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`;
}
function tripsIconSvg(cls) {
  return `<svg class="${cls || ""}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="7" y1="14" x2="12" y2="14"/></svg>`;
}
function plusIconSvg(cls) {
  return `<svg class="${cls || ""}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}
function dashboardIconSvg(cls) {
  return `<svg class="${cls || ""}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="19" x2="4" y2="10"/><line x1="12" y1="19" x2="12" y2="4"/><line x1="20" y1="19" x2="20" y2="14"/></svg>`;
}
function settingsIconSvg(cls) {
  return `<svg class="${cls || ""}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
}

/* SetOut brand lockup - "Set" [trail mark] "Out". Full version (with
   the connector mark) on Home only; every other header uses the
   compact text-only version (compact=true) - see product-decisions.md's
   "SetOut wordmark, logo, and favicon" section for why. "Set" and "Out"
   deliberately use different fonts/colors (see the .word-set/.word-out
   CSS rules), independent of the app's page-title font. */
function brandLockupSvg(compact) {
  if (compact) {
    return `<span class="word-set">Set</span><span class="word-out">Out</span>`;
  }
  return `<span class="word-set">Set</span><svg width="51" height="20" viewBox="0 0 164 64" fill="none" aria-hidden="true"><rect x="2" y="38" width="20" height="20" rx="3" fill="var(--ink)"/><circle cx="40" cy="42" r="3.6" fill="var(--ink)"/><circle cx="60" cy="26" r="3" fill="var(--accent-vivid)"/><circle cx="78" cy="46" r="4.6" fill="var(--accent-vivid)"/><circle cx="102" cy="22" r="4" fill="var(--accent-vivid)"/><circle cx="126" cy="40" r="5.4" fill="var(--accent-vivid)"/><circle cx="152" cy="18" r="4.6" fill="var(--accent-vivid)"/></svg><span class="word-out">Out</span>`;
}

/* Activity-type icons for the ideas board pills - line-icon set from
   the confirmed 2026-09-07 style pass (see product-decisions.md).
   Flight/Lodging/Transport don't have a designed icon yet (added to
   ACTIVITY_TYPES after that pass) - falls back to no icon for those
   three rather than guessing a design that hasn't been confirmed. */
const ACTIVITY_TYPE_ICON_IDS = {
  land: "i-land",
  water: "i-water",
  historical: "i-culture",
  food: "i-food",
  exploring: "i-explore",
  other: "i-other"
};
function activityTypeIconHtml(value) {
  const id = ACTIVITY_TYPE_ICON_IDS[value];
  if (!id) return "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/* Shared sub-page header: the lockup (tap = go Home) stacked with this
   screen's own title on the left, hamburger menu alone on the right.
   Every header except Home's is built through this - see
   product-decisions.md for why Home is the one exception. */
function subpageHeaderHtml(titleHtml) {
  return `
    <div class="header-left">
      <div class="brand-lockup" onclick="goHome()" role="button" tabindex="0" aria-label="SetOut - go to Home">${brandLockupSvg(true)}</div>
      ${titleHtml}
    </div>
    ${menuButtonHtml()}
  `;
}

/* ----------------------------- Hamburger menu --------------------------- */
// Shown in the header of every screen except Home (whose bento tiles
// already ARE the navigation - a menu there would just duplicate
// them). Opens a dropdown that jumps straight to any section in one
// tap, rather than forcing a detour back through Home first. Dashboard
// and Settings are listed but disabled (muted, no click handler) since
// neither is built yet - see backlog.md.

function menuButtonHtml() {
  const dropdown = isMenuOpen
    ? `
      <div class="menu-dropdown">
        <div class="menu-item" onclick="event.stopPropagation(); goToScreen('tripsList')">${tripsIconSvg()} My Trips</div>
        <div class="menu-item" onclick="event.stopPropagation(); goToScreen('newTrip')">${plusIconSvg()} Start a New Trip</div>
        <div class="menu-item muted" title="Coming soon">${dashboardIconSvg()} Dashboard</div>
        <div class="menu-item muted" title="Coming soon">${settingsIconSvg()} Settings</div>
      </div>`
    : "";
  return `
    <button class="icon-btn" onclick="event.stopPropagation(); toggleMenu()" aria-label="Menu">
      ${hamburgerIconSvg()}
      ${dropdown}
    </button>
    ${isMenuOpen ? `<div class="menu-overlay" onclick="toggleMenu()"></div>` : ""}
  `;
}

/* ========================================================================
   SCREEN: Home (bento landing page)
   ======================================================================== */
// A hero banner (the only state-aware part - shows "Continue [trip]"
// when one's active, an empty-state prompt when there isn't) sitting
// above a tile grid that never changes shape regardless of trip state.
// See product-decisions.md's Home screen section and
// mockup/home-mockup.html (retired once this was reviewed) for what
// was confirmed before this got built.

function renderHomeScreen() {
  const trip = getActiveTrip();
  const trips = getTrips();

  const banner = trip
    ? `
      <div class="hero-banner" onclick="openTrip('${trip.id}')">
        <div class="eyebrow">Continue</div>
        <div class="trip-name">${escapeHtml(trip.name)}</div>
        <div class="muted small">${escapeHtml(trip.destination || "")} ${formatDateRange(trip.startDate, trip.endDate)}</div>
      </div>`
    : `
      <div class="hero-banner empty">
        <div class="eyebrow">No trip in progress</div>
        <div class="trip-name">Ready to plan your next one?</div>
      </div>`;

  appRoot().innerHTML = `
    <header class="app-header">
      <h1 class="brand-lockup" onclick="goHome()" aria-label="SetOut">${brandLockupSvg()}</h1>
    </header>
    <main class="screen">
      ${banner}
      <div class="bento-grid">
        <div class="tile tile-trips" onclick="goToScreen('tripsList')">
          ${tripsIconSvg("tile-icon")}
          <div>
            <div class="tile-label">My Trips</div>
            <div class="tile-sub">${trips.length} trip${trips.length === 1 ? "" : "s"} saved</div>
          </div>
        </div>
        <div class="tile tile-new" onclick="goToScreen('newTrip')">
          ${plusIconSvg("tile-icon")}
          <div class="tile-label">Start a New Trip</div>
        </div>
        <div class="tile tile-dash disabled" title="Coming soon">
          ${dashboardIconSvg("tile-icon")}
          <div>
            <div class="tile-label">Dashboard</div>
            <div class="coming-soon-badge">Coming soon</div>
          </div>
        </div>
        <div class="tile tile-settings disabled" title="Coming soon">
          ${settingsIconSvg("tile-icon")}
          <div>
            <div class="tile-label">Settings</div>
            <div class="coming-soon-badge">Coming soon</div>
          </div>
        </div>
      </div>
    </main>
  `;
}

/* ========================================================================
   SCREEN: My Trips (list only - the create-trip form now lives on its
   own screen, see renderNewTripScreen below)
   ======================================================================== */

function renderTripsListScreen() {
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
      ${subpageHeaderHtml('<h1 class="page-title">My Trips</h1>')}
    </header>
    <main class="screen">
      ${trips.length ? tripRows : `<p class="muted empty-state">No trips yet. <a href="#" onclick="event.preventDefault(); goToScreen('newTrip')">Start your first one</a> - everything you enter is stored only on this phone.</p>`}
    </main>
  `;
}

/* ========================================================================
   SCREEN: Start a New Trip (create-trip form, on its own screen)
   ======================================================================== */

function renderNewTripScreen() {
  appRoot().innerHTML = `
    <header class="app-header">
      ${subpageHeaderHtml('<h1 class="page-title">New Trip</h1>')}
    </header>
    <main class="screen">
      <form class="card form" onsubmit="handleCreateTrip(event)">
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
  currentScreen = "trip";
  render();
}

function openTrip(tripId) {
  setActiveTrip(tripId);
  currentTab = "itinerary";
  currentScreen = "trip";
  ideaFilters = defaultIdeaFilters();
  expandedIdeaIds = new Set();
  draggedIdeaId = null;
  isAddIdeaFormOpen = false;
  isMenuOpen = false;
  render();
}

function confirmDeleteTrip(tripId) {
  if (confirm("Delete this trip and everything in it? This can't be undone.")) {
    deleteTrip(tripId);
    render();
  }
}

/* ========================================================================
   SCREEN: Inside a trip (itinerary / packing / budget / notes)
   ======================================================================== */

function renderTripScreen(trip) {
  appRoot().innerHTML = `
    <header class="app-header">
      ${subpageHeaderHtml(`<h1 class="page-title">${escapeHtml(trip.name)}</h1><div class="muted small">${escapeHtml(trip.destination || "")} ${formatDateRange(trip.startDate, trip.endDate)}</div>`)}
    </header>
    <main class="screen" id="tab-content"></main>
    <nav class="tab-bar">
      <button class="tab-btn ${currentTab === "ideas" ? "active" : ""}" onclick="showTab('ideas')">Ideas</button>
      <button class="tab-btn ${currentTab === "itinerary" ? "active" : ""}" onclick="showTab('itinerary')">Itinerary</button>
      <button class="tab-btn ${currentTab === "packing" ? "active" : ""}" onclick="showTab('packing')">Packing</button>
      <button class="tab-btn ${currentTab === "budget" ? "active" : ""}" onclick="showTab('budget')">Budget</button>
      <button class="tab-btn ${currentTab === "notes" ? "active" : ""}" onclick="showTab('notes')">Notes</button>
    </nav>
  `;
  renderTabContent(trip);
}

function showTab(tab) {
  currentTab = tab;
  const trip = getActiveTrip();
  if (trip) renderTripScreen(trip);
}

function renderTabContent(trip) {
  const el = document.getElementById("tab-content");
  if (currentTab === "ideas") el.innerHTML = ideasTabHtml(trip);
  else if (currentTab === "itinerary") el.innerHTML = itineraryTabHtml(trip);
  else if (currentTab === "packing") el.innerHTML = packingTabHtml(trip);
  else if (currentTab === "budget") el.innerHTML = budgetTabHtml(trip);
  else if (currentTab === "notes") el.innerHTML = notesTabHtml(trip);
}

/* ------------------------------ Ideas tab ------------------------------- */
// The ideation board: a 3-column kanban board (The Ideas / The Plan /
// The Itinerary). Card data shape and the fixed ACTIVITY_TYPES /
// IDEA_STYLES lists live in storage.js. See product-decisions.md for
// what each field means and mockup/kanban-mockup.html (now retired)
// for how this board was reviewed before being built for real.

// Which column a card is in is never stored directly - it's always
// derived from a couple of plain fields on the card (see
// columnKeyForIdea below). That's what lets both the move buttons and
// drag-and-drop go through one shared function (moveIdeaToColumn)
// instead of two separate code paths that could drift out of sync.
const KANBAN_COLUMN_ORDER = ["ideas", "plan", "itinerary"];
const KANBAN_COLUMN_LABELS = {
  ideas: "The Ideas",
  plan: "The Plan",
  itinerary: "The Itinerary"
};

function columnKeyForIdea(idea) {
  if (!idea.selected) return "ideas";
  return idea.finalized ? "itinerary" : "plan";
}

function ideasTabHtml(trip) {
  const allIdeas = getIdeas(trip.id);
  const toolbar = `
    <div class="ideas-toolbar-row">
      <button type="button" class="pill-btn" onclick="toggleAddIdeaForm()">${isAddIdeaFormOpen ? "&times; Close" : "+ Add idea"}</button>
      ${ideasViewToggleHtml()}
    </div>
  `;
  const form = isAddIdeaFormOpen ? ideaFormHtml(trip) : "";

  if (!allIdeas.length) {
    return `
      ${toolbar}
      ${form}
      ${isAddIdeaFormOpen ? "" : emptyStateHtml('No ideas yet. Click "+ Add idea" above to add your first one.')}
    `;
  }

  // Filtered once here, then handed to whichever view is showing - the
  // Board and Map views share one filtered list rather than each doing
  // their own filtering, so a filter (including the stage filter) does
  // the same thing no matter which view you're looking at it through.
  const visibleIdeas = applyIdeaFilters(allIdeas);
  const boardOrMap = ideasView === "map" ? mapViewHtml(visibleIdeas) : kanbanBoardHtml(trip, visibleIdeas);

  return `
    ${toolbar}
    ${form}
    ${ideaFilterBarHtml(allIdeas)}
    ${boardOrMap}
  `;
}

// "Board" / "Map" segmented toggle - see product-decisions.md's "Map
// view" section for what was reviewed in mockup/map-table-mockup.html
// before this got built for real.
function ideasViewToggleHtml() {
  return `
    <div class="view-toggle">
      <button type="button" class="${ideasView === "board" ? "active" : ""}" onclick="setIdeasView('board')">Board</button>
      <button type="button" class="${ideasView === "map" ? "active" : ""}" onclick="setIdeasView('map')">Map</button>
    </div>
  `;
}

function setIdeasView(view) {
  ideasView = view;
  renderTabContent(getActiveTrip());
}

// Pulled out of ideasTabHtml so Board and Map can share the same
// already-filtered idea list without duplicating filtering logic.
function kanbanBoardHtml(trip, visibleIdeas) {
  const byColumn = { ideas: [], plan: [], itinerary: [] };
  visibleIdeas.forEach((idea) => byColumn[columnKeyForIdea(idea)].push(idea));
  const board = KANBAN_COLUMN_ORDER.map((key) => kanbanColumnHtml(trip, key, byColumn[key])).join("");
  return `<div class="kanban-board">${board}</div>`;
}

// <option> tags for the stage filter, built from the same
// KANBAN_COLUMN_ORDER/KANBAN_COLUMN_LABELS the board itself uses, so
// there's exactly one place ("The Ideas" / "The Plan" / "The
// Itinerary" wording) to change if that ever changes.
function stageOptionsHtml(selectedValue) {
  return KANBAN_COLUMN_ORDER.map(
    (key) => `<option value="${key}" ${key === selectedValue ? "selected" : ""}>${KANBAN_COLUMN_LABELS[key]}</option>`
  ).join("");
}

// Checkboxes are clustered together in one order - Reservation needed,
// Urgent, Already reserved - with their related free-text fields after
// all three, rather than interleaved. Urgent/Already reserved/their
// notes fields all start disabled (matching a freshly-unchecked
// Reservation needed) and handleAddFormReservationToggle() below keeps
// them in sync as you check/uncheck it, so you can never submit
// "urgent" or "reserved" without "reservation needed" also being true -
// the same rule storage.js's addIdea() already enforces server-side,
// just visible here too instead of silently corrected after the fact.
function ideaFormHtml(trip) {
  return `
    <form class="card form" onsubmit="handleAddIdea(event, '${trip.id}')">
      <h2>Add an idea</h2>
      <label>Title
        <input name="title" type="text" placeholder="e.g. Table Mountain cable car" required />
      </label>
      <label>Description
        <textarea name="description" placeholder="Why it's interesting, where you saw it..."></textarea>
      </label>
      <label>Link
        <input name="link" type="text" placeholder="e.g. airbnb.com/rooms/123 or https://..." />
      </label>
      <div class="row">
        <label>Region
          <input name="region" type="text" placeholder="e.g. Cape Town" />
        </label>
        <label>Exact location
          <input name="location" type="text" placeholder="e.g. Table Mountain, Cape Town" />
          <span class="muted small">For the map (once built). Not shown on the card until this idea is in The Plan or The Itinerary - Region is what shows on the board.</span>
        </label>
      </div>
      <div class="row">
        <label>Category
          <select name="activityType" onchange="handleAddFormActivityTypeChange(this)">${activityTypeOptionsHtml()}</select>
        </label>
        <label>Style
          <select name="style">${ideaStyleOptionsHtml()}</select>
        </label>
      </div>
      <div class="row" data-activity-fields="flight,transport" style="display:none">
        <label>From
          <input name="from" type="text" placeholder="e.g. JFK or Cape Town" />
        </label>
        <label>To
          <input name="to" type="text" placeholder="e.g. CPT or Kruger" />
        </label>
      </div>
      <div class="row" data-activity-fields="flight,transport" style="display:none">
        <label>Departure date
          <input name="departureDate" type="date" />
        </label>
        <label>Departure time
          <input name="departureTime" type="time" />
        </label>
      </div>
      <div class="row" data-activity-fields="flight,transport" style="display:none">
        <label>Arrival date
          <input name="arrivalDate" type="date" />
        </label>
        <label>Arrival time
          <input name="arrivalTime" type="time" />
        </label>
      </div>
      <div class="row" data-activity-fields="lodging" style="display:none">
        <label>Check-in date
          <input name="checkInDate" type="date" />
        </label>
        <label>Check-out date
          <input name="checkOutDate" type="date" />
        </label>
      </div>
      <label class="form-checkbox-row">
        <input type="checkbox" name="reservationNeeded" onchange="handleAddFormReservationToggle(this)" />
        <span>Reservation needed</span>
      </label>
      <label class="form-checkbox-row">
        <input type="checkbox" name="urgent" disabled />
        <span>Urgent / limited availability</span>
      </label>
      <label class="form-checkbox-row">
        <input type="checkbox" name="reserved" disabled />
        <span>Already reserved</span>
      </label>
      <label>Urgency notes
        <textarea name="urgencyNotes" placeholder="Why it's urgent (e.g. sells out fast)" disabled></textarea>
      </label>
      <label>Confirmation details
        <textarea name="confirmationInfo" placeholder="Confirmation #, phone number, pickup instructions..." disabled></textarea>
      </label>
      <button class="primary" type="submit">Add idea</button>
    </form>
  `;
}

// Keeps Urgent/Already reserved/their notes fields in lockstep with
// Reservation needed inside the add-idea form: unchecking it disables
// and clears all four (so nothing inconsistent can be typed in while
// they're grayed out); re-checking it just re-enables them empty,
// matching how the real card resets rather than restores these values
// (see handleToggleReservationNeeded).
function handleAddFormReservationToggle(checkbox) {
  const form = checkbox.form;
  const enabled = checkbox.checked;
  [form.urgent, form.reserved].forEach((el) => {
    el.disabled = !enabled;
    if (!enabled) el.checked = false;
  });
  [form.urgencyNotes, form.confirmationInfo].forEach((el) => {
    el.disabled = !enabled;
    if (!enabled) el.value = "";
  });
}

// Shows only the logistics fields relevant to the selected Category -
// Flight/Transport share one set (From/To + departure/arrival date+time),
// Lodging gets its own (check-in/check-out date). Fields for a
// different category stay in the DOM (hidden, not removed) so nothing
// typed into one group is lost if you flip Category back and forth
// before submitting - same "don't discard what's typed" spirit as the
// reservation-toggle fields above, just keyed off a select instead of
// a checkbox.
function handleAddFormActivityTypeChange(select) {
  const form = select.form;
  form.querySelectorAll("[data-activity-fields]").forEach((group) => {
    const relevantTypes = group.dataset.activityFields.split(",");
    group.style.display = relevantTypes.includes(select.value) ? "" : "none";
  });
}

// The filter bar shown above the board - a slim single row of plain
// selects (no card box, no field labels above them), matching the
// layout from the kanban mockup rather than the app's usual boxed
// .card.form styling. Every control calls handleIdeaFilterChange() on
// change - there's no separate "Apply" step, filtering happens live.
function ideaFilterBarHtml(allIdeas) {
  return `
    <div class="idea-filter-bar">
      <select onchange="handleIdeaFilterChange('activityType', this.value)">
        <option value="all">All categories</option>
        ${activityTypeOptionsHtml(ideaFilters.activityType)}
      </select>
      <select onchange="handleIdeaFilterChange('style', this.value)">
        <option value="all">All styles</option>
        ${ideaStyleOptionsHtml(ideaFilters.style)}
      </select>
      <select onchange="handleIdeaFilterChange('region', this.value)">
        <option value="all">All regions</option>
        ${regionOptionsHtml(allIdeas, ideaFilters.region)}
      </select>
      <select onchange="handleIdeaFilterChange('stage', this.value)">
        <option value="all">All stages</option>
        ${stageOptionsHtml(ideaFilters.stage)}
      </select>
      <select onchange="handleIdeaFilterChange('reservation', this.value)">
        <option value="all" ${ideaFilters.reservation === "all" ? "selected" : ""}>All reservation statuses</option>
        <option value="not_needed" ${ideaFilters.reservation === "not_needed" ? "selected" : ""}>No reservation needed</option>
        <option value="needs_reservation" ${ideaFilters.reservation === "needs_reservation" ? "selected" : ""}>Needs reservation</option>
        <option value="reserved" ${ideaFilters.reservation === "reserved" ? "selected" : ""}>Reserved</option>
      </select>
      <label class="idea-filter-checkbox">
        <input type="checkbox" onchange="handleIdeaFilterChange('urgentOnly', this.checked)" ${ideaFilters.urgentOnly ? "checked" : ""} />
        <span>Urgent only</span>
      </label>
      ${isAnyIdeaFilterActive() ? `<button type="button" class="link-btn" onclick="handleClearIdeaFilters()">Clear filters</button>` : ""}
    </div>
  `;
}

function toggleAddIdeaForm() {
  isAddIdeaFormOpen = !isAddIdeaFormOpen;
  renderTabContent(getActiveTrip());
}

// Distinct region values currently in use, alphabetized - the Region
// filter's options come from your own data instead of a fixed list,
// since region is freeform text (see product-decisions.md).
function regionOptionsHtml(allIdeas, selectedValue) {
  const regions = Array.from(new Set(allIdeas.map((i) => i.region).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  return regions
    .map((r) => `<option value="${escapeHtml(r)}" ${r === selectedValue ? "selected" : ""}>${escapeHtml(r)}</option>`)
    .join("");
}

function isAnyIdeaFilterActive() {
  return (
    ideaFilters.activityType !== "all" ||
    ideaFilters.style !== "all" ||
    ideaFilters.region !== "all" ||
    ideaFilters.stage !== "all" ||
    ideaFilters.reservation !== "all" ||
    ideaFilters.urgentOnly
  );
}

function applyIdeaFilters(ideas) {
  return ideas.filter((idea) => {
    if (ideaFilters.activityType !== "all" && idea.activityType !== ideaFilters.activityType) return false;
    if (ideaFilters.style !== "all" && idea.style !== ideaFilters.style) return false;
    if (ideaFilters.region !== "all" && idea.region !== ideaFilters.region) return false;
    if (ideaFilters.stage !== "all" && columnKeyForIdea(idea) !== ideaFilters.stage) return false;
    if (ideaFilters.reservation === "not_needed" && idea.reservationNeeded) return false;
    if (ideaFilters.reservation === "needs_reservation" && !(idea.reservationNeeded && !idea.reserved)) return false;
    if (ideaFilters.reservation === "reserved" && !(idea.reservationNeeded && idea.reserved)) return false;
    if (ideaFilters.urgentOnly && !idea.urgent) return false;
    return true;
  });
}

function handleIdeaFilterChange(key, value) {
  ideaFilters[key] = value;
  renderTabContent(getActiveTrip());
}

function handleClearIdeaFilters() {
  ideaFilters = defaultIdeaFilters();
  renderTabContent(getActiveTrip());
}

function kanbanColumnHtml(trip, columnKey, columnIdeas) {
  const cards = columnIdeas.map((idea) => kanbanCardHtml(trip, idea, columnKey)).join("");
  return `
    <div class="kanban-column">
      <div class="kanban-column-header">
        <h2>${KANBAN_COLUMN_LABELS[columnKey]}</h2>
        <span class="kanban-column-count">${columnIdeas.length}</span>
      </div>
      <div class="kanban-dropzone" data-column="${columnKey}"
           ondragover="handleDropzoneDragOver(event)"
           ondragleave="handleDropzoneDragLeave(event)"
           ondrop="handleDropzoneDrop(event, '${trip.id}', '${columnKey}')">
        ${cards || `<p class="muted small" style="padding: 8px;">Nothing here yet.</p>`}
      </div>
    </div>
  `;
}

// Turns whatever was typed into the link field into a real, clickable
// URL. The field itself no longer forces a scheme to be typed (see the
// input above) - this is where that gets patched up, only for the
// href, so what's stored/shown as typed is never silently rewritten.
function normalizedLinkHref(link) {
  const trimmed = (link || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Type-specific logistics fields, editable inline like every other
// field in the card - shown only when Category is Flight/Transport
// (shared From/To + departure/arrival date+time) or Lodging
// (check-in/check-out date only, no time). Field labels match the
// confirmed calendar-mockup.html edit popover exactly, so the same
// fields look the same wherever they're edited. Every other category
// renders nothing here - storage.js already keeps these fields as
// empty strings for non-logistics cards, so there's nothing to show.
function logisticsFieldsHtml(trip, idea) {
  if (idea.activityType === "flight" || idea.activityType === "transport") {
    return `
      <div class="idea-edit-row">
        <label class="idea-edit-field">
          <span>From</span>
          <input type="text" placeholder="e.g. JFK or Cape Town" value="${escapeHtml(idea.from)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'from', this.value.trim())" />
        </label>
        <label class="idea-edit-field">
          <span>To</span>
          <input type="text" placeholder="e.g. CPT or Kruger" value="${escapeHtml(idea.to)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'to', this.value.trim())" />
        </label>
      </div>
      <div class="idea-edit-row">
        <label class="idea-edit-field">
          <span>Departure date</span>
          <input type="date" value="${escapeHtml(idea.departureDate)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'departureDate', this.value)" />
        </label>
        <label class="idea-edit-field">
          <span>Departure time</span>
          <input type="time" value="${escapeHtml(idea.departureTime)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'departureTime', this.value)" />
        </label>
      </div>
      <div class="idea-edit-row">
        <label class="idea-edit-field">
          <span>Arrival date</span>
          <input type="date" value="${escapeHtml(idea.arrivalDate)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'arrivalDate', this.value)" />
        </label>
        <label class="idea-edit-field">
          <span>Arrival time</span>
          <input type="time" value="${escapeHtml(idea.arrivalTime)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'arrivalTime', this.value)" />
        </label>
      </div>
    `;
  }
  if (idea.activityType === "lodging") {
    return `
      <div class="idea-edit-row">
        <label class="idea-edit-field">
          <span>Check-in date</span>
          <input type="date" value="${escapeHtml(idea.checkInDate)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'checkInDate', this.value)" />
        </label>
        <label class="idea-edit-field">
          <span>Check-out date</span>
          <input type="date" value="${escapeHtml(idea.checkOutDate)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'checkOutDate', this.value)" />
        </label>
      </div>
    `;
  }
  return "";
}

// One card. See product-decisions.md for what each field means and
// mockup/kanban-mockup.html (now retired) for how this layout was
// reviewed before being built for real.
function kanbanCardHtml(trip, idea, columnKey) {
  const idx = KANBAN_COLUMN_ORDER.indexOf(columnKey);
  const isExpanded = expandedIdeaIds.has(idea.id);
  const needsReservationFlag = idea.reservationNeeded && !idea.reserved;
  const isReserved = idea.reservationNeeded && idea.reserved;

  const backBtn = idx > 0
    ? `<button class="kanban-move-btn" type="button" title="Move back to ${KANBAN_COLUMN_LABELS[KANBAN_COLUMN_ORDER[idx - 1]]}" onclick="moveIdeaToColumn('${trip.id}', '${idea.id}', '${KANBAN_COLUMN_ORDER[idx - 1]}')">&larr;</button>`
    : "";
  const forwardBtn = idx < KANBAN_COLUMN_ORDER.length - 1
    ? `<button class="kanban-move-btn" type="button" title="Move to ${KANBAN_COLUMN_LABELS[KANBAN_COLUMN_ORDER[idx + 1]]}" onclick="moveIdeaToColumn('${trip.id}', '${idea.id}', '${KANBAN_COLUMN_ORDER[idx + 1]}')">&rarr;</button>`
    : "";

  // Region is coarse and always visible - it's what orients you while
  // browsing the board. Exact location is collected the whole time (the
  // map needs it for every candidate) but only DISPLAYED once an idea
  // has left The Ideas, when it becomes useful as reference info rather
  // than clutter next to the near-identical Region line.
  const exactLocationLine = columnKey !== "ideas" && idea.location.placeName
    ? `<div class="kanban-card-exact-location">&#128204; Exact location: ${escapeHtml(idea.location.placeName)}</div>`
    : "";

  return `
    <div class="kanban-card ${isExpanded ? "is-expanded" : ""}"
         draggable="${isExpanded ? "false" : "true"}"
         ondragstart="handleDragStart(event, '${idea.id}')"
         ondragend="handleDragEnd(event)">
      <div class="kanban-card-header">
        <div class="kanban-card-title-row" onclick="toggleExpanded('${idea.id}')">
          <span class="kanban-chevron ${isExpanded ? "is-expanded" : ""}">&#9656;</span>
          <span class="kanban-card-title">${escapeHtml(idea.title)}</span>
        </div>
        <div class="kanban-card-actions">
          ${idea.urgent ? `<span class="badge-flag badge-urgent">Urgent</span>` : ""}
          ${needsReservationFlag ? `<span class="badge-flag badge-reservation-needed">Needs reservation</span>` : ""}
          ${backBtn}
          ${forwardBtn}
          <button class="icon-btn danger" type="button" onclick="handleDeleteIdea('${trip.id}', '${idea.id}')" aria-label="Delete idea">&times;</button>
        </div>
      </div>

      <div class="kanban-card-collapsed-meta">
        ${idea.region ? `<span class="kanban-card-region">&#128205; ${escapeHtml(idea.region)}</span>` : ""}
        <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
        ${isReserved ? `<span class="badge-flag badge-reserved">&#10003; Reserved</span>` : ""}
      </div>

      <div class="kanban-card-body">
        <div class="idea-edit-fields">
          <div class="idea-edit-row">
            <label class="idea-edit-field">
              <span>Category</span>
              <select onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'activityType', this.value)">${activityTypeOptionsHtml(idea.activityType)}</select>
            </label>
            <label class="idea-edit-field">
              <span>Style</span>
              <select onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'style', this.value)">${ideaStyleOptionsHtml(idea.style)}</select>
            </label>
          </div>
          ${logisticsFieldsHtml(trip, idea)}
          <label class="idea-edit-field">
            <span>Region</span>
            <input type="text" placeholder="e.g. Cape Town" value="${escapeHtml(idea.region)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'region', this.value.trim())" />
          </label>
          ${columnKey !== "ideas" ? `
            <label class="idea-edit-field">
              <span>Exact location</span>
              <input type="text" placeholder="e.g. Table Mountain, Cape Town" value="${escapeHtml(idea.location.placeName)}" onchange="handleUpdateIdeaLocation('${trip.id}', '${idea.id}', this.value.trim())" />
            </label>
          ` : ""}
          <label class="idea-edit-field">
            <span>Description</span>
            <textarea placeholder="Why it's interesting, where you saw it..." onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'description', this.value.trim())">${escapeHtml(idea.description)}</textarea>
          </label>
          <label class="idea-edit-field">
            <span>Link</span>
            <div class="idea-edit-link-row">
              <input type="text" placeholder="e.g. airbnb.com/rooms/123 or https://..." value="${escapeHtml(idea.link)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'link', this.value.trim())" />
              ${idea.link ? `<a class="kanban-card-link" href="${escapeHtml(normalizedLinkHref(idea.link))}" target="_blank" rel="noopener">Open &#8599;</a>` : ""}
            </div>
          </label>
        </div>

        <div class="kanban-card-controls">
          <button class="toggle-pill ${idea.reservationNeeded ? "is-on" : ""}" type="button"
            onclick="handleToggleReservationNeeded('${trip.id}', '${idea.id}', ${idea.reservationNeeded})">
            Reservation needed: ${idea.reservationNeeded ? "Yes" : "No"}
          </button>
          ${idea.reservationNeeded ? `
            <button class="toggle-pill ${idea.reserved ? "is-on" : ""}" type="button"
              onclick="handleToggleReserved('${trip.id}', '${idea.id}', ${idea.reserved})">
              Reserved: ${idea.reserved ? "Yes" : "No"}
            </button>
          ` : ""}
          <button class="badge-urgent-toggle ${idea.urgent ? "is-urgent" : ""}" type="button"
            ${idea.reservationNeeded ? `onclick="handleToggleIdeaUrgent('${trip.id}', '${idea.id}', ${idea.urgent})"` : "disabled"}>
            ${idea.urgent ? "Urgent" : "Mark urgent"}
          </button>
        </div>

        ${idea.urgent ? `
          <label class="confirmation-info-field">
            <span>Urgency notes</span>
            <textarea placeholder="Why it's urgent (e.g. sells out fast)" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'urgencyNotes', this.value.trim())">${escapeHtml(idea.urgencyNotes)}</textarea>
          </label>
        ` : ""}

        ${idea.reservationNeeded ? `
          <label class="confirmation-info-field">
            <span>Confirmation details</span>
            <textarea placeholder="Confirmation #, phone number, pickup instructions..." onchange="handleUpdateConfirmationInfo('${trip.id}', '${idea.id}', this.value)">${escapeHtml(idea.confirmationInfo)}</textarea>
          </label>
          ${idea.reserved && !idea.confirmationInfo ? `<div class="confirmation-nudge">Add confirmation details so it's easy to find while you're traveling.</div>` : ""}
        ` : ""}
      </div>
    </div>
  `;
}

function toggleExpanded(ideaId) {
  if (expandedIdeaIds.has(ideaId)) expandedIdeaIds.delete(ideaId);
  else expandedIdeaIds.add(ideaId);
  renderTabContent(getActiveTrip());
}

// Generic inline-edit setter for the plain fields on a card (title,
// description, link, region, category, style, urgency notes) - all
// wired the same way Confirmation details already was: change the
// field, save, re-render. One function instead of one per field since
// they're all a single top-level property update.
function handleUpdateIdeaField(tripId, ideaId, field, value) {
  updateIdea(tripId, ideaId, { [field]: value });
  renderTabContent(getActiveTrip());
}

// Exact location is nested under idea.location and, unlike the plain
// fields above, has a real second concern: once real geocoding exists,
// an edited place name invalidates whatever lat/lng was previously
// looked up for the old text. Resetting geocodeStatus back to
// "pending" (and clearing lat/lng) here means an edited idea always
// gets re-geocoded rather than silently keeping a stale pin position.
function handleUpdateIdeaLocation(tripId, ideaId, placeName) {
  setIdeaLocation(tripId, ideaId, { placeName, lat: null, lng: null, geocodeStatus: "pending" });
  renderTabContent(getActiveTrip());
}

// Moving a card sets the fields that together define its column
// (selected, finalized) - the column itself is never stored directly.
// Leaving The Itinerary while a reservation is actually in place
// (reservationNeeded && reserved) is treated as canceling that
// reservation, so it's gated behind a confirm() - the same
// are-you-sure pattern the app already uses for confirmDeleteTrip().
// Declining leaves everything untouched; this check runs for BOTH the
// move buttons and drag-and-drop, since both funnel through here.
function moveIdeaToColumn(tripId, ideaId, columnKey) {
  const idea = getIdeas(tripId).find((i) => i.id === ideaId);
  if (!idea) return;

  const currentColumn = columnKeyForIdea(idea);
  if (currentColumn === columnKey) return; // dropped back where it started

  const hasLiveReservation = idea.reservationNeeded && idea.reserved;
  const updates = {
    selected: columnKey !== "ideas",
    finalized: columnKey === "itinerary"
  };

  if (currentColumn === "itinerary" && columnKey !== "itinerary" && hasLiveReservation) {
    const confirmed = confirm(
      `"${idea.title}" has an active reservation. Moving it out of The Itinerary means this reservation needs to be canceled - continue?`
    );
    if (!confirmed) return;
    updates.reserved = false;
  }

  updateIdea(tripId, ideaId, updates);
  renderTabContent(getActiveTrip());
}

function handleDropzoneDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
}

function handleDropzoneDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleDropzoneDrop(event, tripId, columnKey) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  if (draggedIdeaId) moveIdeaToColumn(tripId, draggedIdeaId, columnKey);
}

function handleDragStart(event, ideaId) {
  draggedIdeaId = ideaId;
  event.currentTarget.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
  draggedIdeaId = null;
}

// Builds <option> tags from storage.js's fixed lists, so the labels only
// live in one place (storage.js) instead of being typed out again here.
function activityTypeOptionsHtml(selectedValue) {
  return ACTIVITY_TYPES.map(
    (t) => `<option value="${t.value}" ${t.value === selectedValue ? "selected" : ""}>${escapeHtml(t.label)}</option>`
  ).join("");
}

function ideaStyleOptionsHtml(selectedValue) {
  return IDEA_STYLES.map(
    (s) => `<option value="${s.value}" ${s.value === selectedValue ? "selected" : ""}>${escapeHtml(s.label)}</option>`
  ).join("");
}

function activityTypeLabel(value) {
  const match = ACTIVITY_TYPES.find((t) => t.value === value);
  return match ? match.label : value;
}

function ideaStyleLabel(value) {
  const match = IDEA_STYLES.find((s) => s.value === value);
  return match ? match.label : value;
}

function handleAddIdea(event, tripId) {
  event.preventDefault();
  const form = event.target;
  addIdea(tripId, {
    title: form.title.value.trim(),
    description: form.description.value.trim(),
    link: form.link.value.trim(),
    region: form.region.value.trim(),
    activityType: form.activityType.value,
    style: form.style.value,
    reservationNeeded: form.reservationNeeded.checked,
    reserved: form.reserved.checked,
    confirmationInfo: form.confirmationInfo.value.trim(),
    urgent: form.urgent.checked,
    urgencyNotes: form.urgencyNotes.value.trim(),
    location: { placeName: form.location.value.trim() },
    // Only meaningful when Category is Flight/Transport/Lodging - see
    // handleAddFormActivityTypeChange above for how the form shows/hides
    // these. Reading them unconditionally here is safe either way: a
    // hidden group's inputs are still just empty strings, and addIdea()
    // already defaults every one of these to "" if not passed.
    from: form.from.value.trim(),
    to: form.to.value.trim(),
    departureDate: form.departureDate.value,
    departureTime: form.departureTime.value,
    arrivalDate: form.arrivalDate.value,
    arrivalTime: form.arrivalTime.value,
    checkInDate: form.checkInDate.value,
    checkOutDate: form.checkOutDate.value
  });
  isAddIdeaFormOpen = false;
  renderTabContent(getActiveTrip());
}

function handleDeleteIdea(tripId, ideaId) {
  deleteIdea(tripId, ideaId);
  expandedIdeaIds.delete(ideaId);
  renderTabContent(getActiveTrip());
}

function handleToggleIdeaUrgent(tripId, ideaId, currentlyUrgent) {
  updateIdea(tripId, ideaId, { urgent: !currentlyUrgent });
  renderTabContent(getActiveTrip());
}

// Turning reservations off also resets urgent and reserved back to
// false - both only mean something when a reservation is actually
// needed, so there's no such thing as "urgent, but no reservation
// needed" or "reserved, but no reservation needed" left lying around.
function handleToggleReservationNeeded(tripId, ideaId, currentlyNeeded) {
  const turningOff = currentlyNeeded;
  const updates = { reservationNeeded: !currentlyNeeded };
  if (turningOff) {
    updates.urgent = false;
    updates.reserved = false;
  }
  updateIdea(tripId, ideaId, updates);
  renderTabContent(getActiveTrip());
}

function handleToggleReserved(tripId, ideaId, currentlyReserved) {
  updateIdea(tripId, ideaId, { reserved: !currentlyReserved });
  renderTabContent(getActiveTrip());
}

function handleUpdateConfirmationInfo(tripId, ideaId, value) {
  updateIdea(tripId, ideaId, { confirmationInfo: value.trim() });
  renderTabContent(getActiveTrip());
}

/* ------------------------------- Map view -------------------------------- */
// The "Map" half of the Board/Map toggle above. Reviewed first as a
// mockup (mockup/map-table-mockup.html) - see product-decisions.md's
// "Map view" section for the full review history and what was decided
// at each step.
//
// Deliberately built strictly from real data: an idea only counts as
// really "plotted" once geocode() has actually succeeded for it. Real
// geocoding (Leaflet + Nominatim, behind a geocode()/renderMap()
// abstraction) hasn't been wired up yet, so every idea's
// location.geocodeStatus is still "pending" today.
//
// The pin rendering + hover/click sync with the list (the interaction
// from the Zillow reference this feature is modeled on) WAS originally
// deferred entirely, on the theory that there was nothing real to sync
// with yet. On review, the call was made to build that interaction now
// against deliberately fake positions (the "demo pins" toggle below),
// specifically so the feel of it can be evaluated before real
// geocoding exists - not to fake real results. See the
// mapDemoPinsEnabled block above and everything marked TEMPORARY below.
function mapViewHtml(visibleIdeas) {
  const realPlotted = visibleIdeas.filter((idea) => idea.location.geocodeStatus === "success");
  const notYetLocated = visibleIdeas.filter((idea) => idea.location.geocodeStatus !== "success");

  // TEMPORARY: when the demo toggle is on, every not-yet-located idea
  // gets a fake position and moves into the interactive demo-pin
  // rendering instead of the plain "not shown on map" list. Delete
  // this branching (and go back to always using notYetLocated as
  // "unplotted") once Phase 2 makes real positions available.
  const demoPlotted = mapDemoPinsEnabled
    ? notYetLocated.map((idea) => ({ idea, ...fakeDemoPosition(idea.id) }))
    : [];
  const unplotted = mapDemoPinsEnabled ? [] : notYetLocated;

  const emptyNote = realPlotted.length === 0
    ? `No ideas have a confirmed location yet. Toggle "Preview with demo positions" below to try the pin interaction with placeholder positions.`
    : `${realPlotted.length} idea(s) have a confirmed location, but real pin rendering isn't wired up yet - that lands with the Leaflet/Nominatim work.`;

  return `
    <div class="map-view-controls">
      <label class="demo-pins-toggle">
        <input type="checkbox" ${mapDemoPinsEnabled ? "checked" : ""} onchange="toggleMapDemoPins()" />
        Preview with demo positions
      </label>
      ${mapDemoPinsEnabled
        ? `<span class="demo-pins-banner">Demo positions - not real locations. Temporary, for evaluating the pin interaction only; removed once real geocoding lands.</span>`
        : ""}
    </div>
    <div class="map-view">
      <div class="map-list-pane" id="map-list-pane">
        ${mapPlottedCardsHtml(realPlotted)}
        ${mapDemoPlottedCardsHtml(demoPlotted)}
        ${mapUnplottedHtml(unplotted)}
      </div>
      <div class="map-pane">
        <div class="map-legend">
          ${KANBAN_COLUMN_ORDER.map((key) => `
            <div class="map-legend-row">
              <span class="map-legend-dot" style="background:var(--stage-${key});"></span> ${KANBAN_COLUMN_LABELS[key]}
            </div>
          `).join("")}
        </div>
        <div class="map-pins" id="map-pins">${mapPinsHtml(demoPlotted)}</div>
        ${realPlotted.length === 0 && demoPlotted.length === 0 ? `<p class="muted small map-empty-note">${emptyNote}</p>` : ""}
        <div class="map-caption">Real Leaflet/OpenStreetMap rendering + real pin positions go here once geocode()/renderMap() are wired up - see product-decisions.md.</div>
      </div>
    </div>
  `;
}

// TEMPORARY: deterministic fake pin position for the demo-pin preview
// only. Hashes the idea's id to a repeatable (but arbitrary) spot
// within the map pane, away from the very edges. Never derived from,
// or written back to, idea.location - purely a rendering-layer
// stand-in. Delete alongside the rest of the demo-pin block once
// Phase 2's real geocode()/renderMap() positioning lands.
function fakeDemoPosition(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const x = 15 + (hash % 71); // 15-85
  const y = 15 + (Math.floor(hash / 71) % 71); // 15-85
  return { x, y };
}

// TEMPORARY: flips the demo-pin preview on/off. Clears any hover/click
// state so switching modes never leaves a stale pin or card looking
// "active" for an idea that's no longer plotted.
function toggleMapDemoPins() {
  mapDemoPinsEnabled = !mapDemoPinsEnabled;
  mapActiveIdeaId = null;
  mapClickedIdeaId = null;
  renderTabContent(getActiveTrip());
}

// Hover sync: entering either a list card or a pin lights up both.
// Leaving clears the hover UNLESS that idea is "clicked active"
// (toggleMapClicked), which persists until something else is clicked.
// Same pattern confirmed in the mockup review.
function setMapActive(id) {
  mapActiveIdeaId = id || mapClickedIdeaId;
  document.querySelectorAll(".maplist-card.is-demo").forEach((el) => el.classList.toggle("is-active", el.dataset.id === mapActiveIdeaId));
  document.querySelectorAll(".map-pin").forEach((el) => el.classList.toggle("is-active", el.dataset.id === mapActiveIdeaId));
}

function toggleMapClicked(id) {
  mapClickedIdeaId = mapClickedIdeaId === id ? null : id;
  setMapActive(mapClickedIdeaId);
}

// Only scrolls the list pane if the matching card isn't already fully
// visible, and does it smoothly - confirmed in the mockup review.
function scrollMapListIntoViewIfNeeded(id) {
  const pane = document.getElementById("map-list-pane");
  if (!pane) return;
  const el = pane.querySelector(`.maplist-card[data-id="${id}"]`);
  if (!el) return;
  const paneRect = pane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const fullyVisible = elRect.top >= paneRect.top && elRect.bottom <= paneRect.bottom;
  if (!fullyVisible) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Pin-specific handlers (vs. the plain hover/click used by list cards)
// - only pins need the scroll-catch-up behavior, since a list card
// you're already hovering is by definition already visible.
function handleMapPinHover(id) {
  setMapActive(id);
  scrollMapListIntoViewIfNeeded(id);
}

function handleMapPinLeave() {
  setMapActive(null);
}

function handleMapPinClick(id) {
  toggleMapClicked(id);
  if (mapClickedIdeaId === id) scrollMapListIntoViewIfNeeded(id);
}

function handleMapCardHover(id) {
  setMapActive(id);
}

function handleMapCardLeave() {
  setMapActive(null);
}

function handleMapCardClick(id) {
  toggleMapClicked(id);
}

// Plain read-only cards for ideas that DO have a *real* confirmed
// location - no hover/click behavior yet, since real pin positions
// aren't built (only the demo-pin preview has positions to sync
// with). Just enough to see the data flowing correctly once some real
// geocoding succeeds. See mapDemoPlottedCardsHtml() for the
// interactive demo-pin equivalent.
function mapPlottedCardsHtml(plotted) {
  if (!plotted.length) return "";
  return plotted.map((idea) => `
    <div class="maplist-card" data-id="${idea.id}">
      <div class="maplist-card-top">
        <div>
          <div class="maplist-card-title">${escapeHtml(idea.title)}</div>
          <div class="maplist-card-region">${escapeHtml(idea.region)} &middot; ${KANBAN_COLUMN_LABELS[columnKeyForIdea(idea)]}</div>
        </div>
        <span class="maplist-stage-dot" style="background:var(--stage-${columnKeyForIdea(idea)});"></span>
      </div>
      <div class="maplist-card-pills">
        <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
        <span class="pill pill-style">${escapeHtml(ideaStyleLabel(idea.style))}</span>
        ${idea.urgent ? `<span class="badge-flag badge-urgent">Urgent</span>` : ""}
        ${idea.reservationNeeded && !idea.reserved ? `<span class="badge-flag badge-reservation-needed">Needs reservation</span>` : ""}
        ${idea.reservationNeeded && idea.reserved ? `<span class="badge-flag badge-reserved">Reserved</span>` : ""}
      </div>
    </div>
  `).join("");
}

// TEMPORARY: interactive cards for ideas plotted with a fake demo
// position (see mapDemoPinsEnabled / fakeDemoPosition). Structurally
// the same as mapPlottedCardsHtml's real cards, but wired for
// hover/click sync with a pin and visually flagged as "demo" so it's
// never mistaken for a real result. Delete alongside the rest of the
// demo-pin block once Phase 2 wires up real pin positions for real
// plotted ideas too (at which point mapPlottedCardsHtml gets this
// interactivity instead).
function mapDemoPlottedCardsHtml(demoPlotted) {
  if (!demoPlotted.length) return "";
  return demoPlotted.map(({ idea }) => `
    <div class="maplist-card is-demo ${idea.id === mapActiveIdeaId ? "is-active" : ""}" data-id="${idea.id}"
         onmouseenter="handleMapCardHover('${idea.id}')" onmouseleave="handleMapCardLeave()" onclick="handleMapCardClick('${idea.id}')">
      <div class="maplist-card-top">
        <div>
          <div class="maplist-card-title">${escapeHtml(idea.title)} <span class="demo-tag">demo</span></div>
          <div class="maplist-card-region">${escapeHtml(idea.region)} &middot; ${KANBAN_COLUMN_LABELS[columnKeyForIdea(idea)]}</div>
        </div>
        <span class="maplist-stage-dot" style="background:var(--stage-${columnKeyForIdea(idea)});"></span>
      </div>
      <div class="maplist-card-pills">
        <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
        <span class="pill pill-style">${escapeHtml(ideaStyleLabel(idea.style))}</span>
        ${idea.urgent ? `<span class="badge-flag badge-urgent">Urgent</span>` : ""}
        ${idea.reservationNeeded && !idea.reserved ? `<span class="badge-flag badge-reservation-needed">Needs reservation</span>` : ""}
        ${idea.reservationNeeded && idea.reserved ? `<span class="badge-flag badge-reserved">Reserved</span>` : ""}
      </div>
    </div>
  `).join("");
}

// TEMPORARY: pins for demo-positioned ideas only (see
// mapDemoPinsEnabled). Delete alongside the rest of the demo-pin block
// once Phase 2 wires up real pin positions.
function mapPinsHtml(demoPlotted) {
  if (!demoPlotted.length) return "";
  return demoPlotted.map(({ idea, x, y }) => `
    <div class="map-pin is-demo ${idea.id === mapActiveIdeaId ? "is-active" : ""}" data-id="${idea.id}"
         style="left:${x}%; top:${y}%;"
         onmouseenter="handleMapPinHover('${idea.id}')" onmouseleave="handleMapPinLeave()" onclick="handleMapPinClick('${idea.id}')">
      <span class="map-pin-label">${escapeHtml(idea.title)}</span>
      <span class="map-pin-dot" style="background:var(--stage-${columnKeyForIdea(idea)});"></span>
    </div>
  `).join("");
}

// Ideas with no confirmed location yet - either still pending (never
// geocoded) or the lookup failed. Shown separately rather than hidden,
// with a different message for each reason, per the mockup review.
// (When the demo-pin toggle is on, this list is empty - those ideas
// moved into the interactive demo section above instead.)
function mapUnplottedHtml(unplotted) {
  if (!unplotted.length) return "";
  return `
    <div class="not-on-map">
      <h4>Not shown on map (${unplotted.length})</h4>
      ${unplotted.map((idea) => `
        <div class="not-on-map-card">
          <strong>${escapeHtml(idea.title)}</strong> &middot; ${escapeHtml(idea.region)}
          <div class="not-on-map-reason ${idea.location.geocodeStatus === "failed" ? "is-failed" : ""}">
            ${idea.location.geocodeStatus === "failed"
              ? "Location not found - edit the idea to try a different search term."
              : "Still looking up this location&hellip;"}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

/* ---------------------------- Itinerary tab ---------------------------- */
// The old generic type/title/date/time itinerary list + form lived here.
// Removed 2026-09-09 (Phase 3, Step 1 of the calendar port) - Flight/Lodging/
// Transport now flow through idea cards (see the kanban/ideas system), and
// this tab is being rebuilt as the real Building-view month calendar
// (LUV-6). This stub is a placeholder until that grid lands.

function itineraryTabHtml(trip) {
  return emptyStateHtml("The Building-view calendar is under construction - check back soon.");
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
