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
  direct reflection of whatever data storage.js is holding.
*/

// ---- View state (kept in memory only, never saved or synced) ----
// Which bottom-nav tab is currently showing, while inside a trip.
// A trip always opens on Ideas (LUV-47), whether it's new or reopened:
// planning starts from ideas, and a new trip has no itinerary to show
// yet. It deliberately doesn't remember the last tab you used.
const TRIP_START_TAB = "ideas";
let currentTab = TRIP_START_TAB;

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

// Which placed calendar card (if any) currently has its click-to-edit
// popover open. Same in-memory, view-only treatment as expandedIdeaIds
// above - it resets on trip switch and doesn't survive a reload, which
// is fine since it's just "what's open right now," not saved data.
let openCalendarPopoverIdeaId = null;

// Which specific rendered DOM element the open popover is anchored
// to - needed because a single idea can now render in TWO places at
// once (a cross-day flight's real departure card, plus its derived
// arrival echo - see calendarArrivalEchoHtml() below). Positioning by
// idea id alone would always find the FIRST matching element in the
// DOM regardless of which one was actually clicked.
let openCalendarPopoverAnchorKey = null;

// Which amber transport warning (LUV-29), if any, has its popover open,
// by its gap key ("<fromLodgingId>__<toLodgingId>"). It shares the
// card popover's slot on screen, so at most one of this and
// openCalendarPopoverIdeaId is ever set.
let openTransportGapKey = null;

function isCalendarPopoverOpen() {
  return !!(openCalendarPopoverIdeaId || openTransportGapKey);
}

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

// ---- Sign-in state (LUV-40) ----
// Who's signed in on this device, as reported by auth.js. In memory
// only - Firebase itself remembers the sign-in between launches.
//   "checking"  start-up, before Firebase has answered (a split second,
//               even offline) - nothing is drawn yet, so the sign-in
//               screen never flashes up for someone already signed in
//   "signedOut" show the sign-in screen
//   "signedIn"  show the app
let authState = "checking";
let signedInEmail = null;
// What the sign-in screen is doing: "idle", "waiting" (Google's window
// is open) or "failed" (it closed or errored before finishing).
let signInStatus = "idle";

// ---- Sync status and the account panel (LUV-43) ----
// What the small status label says, as reported by sync.js:
// "synced", "syncing", "waiting" or "offline". unsyncedChanges is true
// whenever anything on this device hasn't reached the server yet, even
// for the split second before the label would change - it's what the
// sign-out check uses. isAccountOpen: the "Sync and account" panel.
let syncStatus = "synced";
let unsyncedChanges = false;
let isAccountOpen = false;

// Grabs the single element we render everything into.
function appRoot() {
  return document.getElementById("app");
}

// The main entry point. Decides which top-level screen to show, based
// on currentScreen. Home is deliberately NOT gated on whether a trip
// exists - it's always reachable, and its hero banner is what shows/
// hides depending on trip state (see renderHomeScreen below).
function render() {
  // Nothing in the app shows until someone is signed in on this device.
  if (authState === "checking") {
    appRoot().innerHTML = "";
    return;
  }
  if (authState === "signedOut") {
    renderSignInScreen();
    return;
  }
  // Signed in, but trips haven't finished loading from the device's
  // copy yet (usually a split second). Drawing now would flash an
  // empty "no trips" Home before the real ones arrive.
  if (!isSyncReady()) {
    appRoot().innerHTML = "";
    return;
  }

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

  // The account panel can open from any screen, so it's added here, on
  // top of whichever one was just drawn.
  if (isAccountOpen) appRoot().insertAdjacentHTML("beforeend", accountPanelHtml());
}

/* ---------------------------- Sign-in (LUV-40) --------------------------- */
// The sign-in screen and the handlers around it. auth.js does the
// actual talking to Firebase; these only decide what to show. Reviewed
// first as mockup/sign-in-mockup.html.

// Called by auth.js at start-up and whenever someone signs in or out.
function handleAuthChange(user) {
  authState = user ? "signedIn" : "signedOut";
  signedInEmail = user ? user.email : null;
  signInStatus = "idle";
  if (!user) {
    // A fresh sign-in always starts from Home, not wherever the last
    // person left off.
    currentScreen = "home";
    isMenuOpen = false;
    isAccountOpen = false;
  }
  render();
}

// If auth.js couldn't load at all (e.g. the very first launch with no
// signal, before the service worker has a copy of Firebase), show the
// sign-in screen rather than a blank page. It will say it's offline.
function handleAuthLoadFailed() {
  if (authState !== "checking") return;
  authState = "signedOut";
  render();
}

async function handleSignIn() {
  if (!window.setoutAuth || !navigator.onLine) return;
  signInStatus = "waiting";
  render();
  try {
    // On success there's nothing to do here: auth.js reports the new
    // user through handleAuthChange(), which draws the app.
    await window.setoutAuth.signIn();
  } catch (err) {
    // Closed the window, pop-up blocked, network dropped... all mean the
    // same thing to the person: nothing changed, try again.
    console.warn("Sign-in didn't finish:", err.code || err);
    signInStatus = "failed";
    render();
  }
}

// Signs out on THIS device only. Trips live in the account, so nothing
// is lost - signing back in brings everything back.
// Changes still waiting to sync can't be sent once signed out (the
// server only accepts them from the person who made them), so in that
// case it asks first. Used by the menu, the account panel, and Home's
// "Switch account" - switching is signing out, because the sign-in
// screen always asks which Google account to use.
async function handleSignOut() {
  if (unsyncedChanges && !confirm("Some changes on this device haven't synced yet. If you sign out now, they'll be lost.\n\nSign out anyway?")) {
    return;
  }
  isMenuOpen = false;
  isAccountOpen = false;
  if (window.setoutAuth) await window.setoutAuth.signOut();
}

function renderSignInScreen() {
  const offline = !navigator.onLine;
  const waiting = signInStatus === "waiting";

  let message = "";
  if (offline) {
    message = `<div class="signin-msg">You're offline. The first sign-in on a device needs a connection. After that, SetOut works without one.</div>`;
  } else if (signInStatus === "failed") {
    message = `<div class="signin-msg">Sign-in didn't finish, so nothing changed. Try again.</div>`;
  }

  const help = offline || signInStatus === "failed"
    ? ""
    : `<p class="signin-help">${waiting
        ? "Finish signing in on Google's screen. Google always asks which account to use."
        : "Use the Google account you'll plan with. Trips are shared with the people you invite."}</p>`;

  appRoot().innerHTML = `
    <main class="signin-screen">
      <h1 class="signin-lockup" aria-label="SetOut">${brandLockupSvg()}</h1>
      <p class="signin-tagline">Plan the trip together. Take it with you.</p>
      <button class="google-btn" type="button" onclick="handleSignIn()" ${offline || waiting ? "disabled" : ""}>
        ${googleMarkSvg()}${waiting ? "Signing in&hellip;" : "Sign in with Google"}
      </button>
      ${message}
      ${help}
    </main>
  `;
}

// Google's "G" mark for the sign-in button, per Google's own sign-in
// button guidance.
function googleMarkSvg() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
}

/* ------------------------ Live updates (LUV-41) ------------------------- */
// sync.js calls these. handleSyncReady() once, when a signed-in
// person's trips have finished loading; handleRemoteChange() whenever
// trip data changes because of ANOTHER device (Dave's phone, your
// laptop). Changes made on this device are already on screen, so
// sync.js doesn't call it for those.

function handleSyncReady() {
  markSyncReady();
  render();
}

// Called by sync.js whenever the sync status changes (LUV-43). Only the
// status label and the panel's status card are swapped out, not the
// whole screen, so this can never interrupt typing or a drag.
function handleSyncStatus(status, unsent) {
  unsyncedChanges = unsent;
  if (status === syncStatus) return;
  syncStatus = status;
  document.querySelectorAll("[data-sync-status]").forEach((el) => { el.outerHTML = syncStatusHtml(); });
  document.querySelectorAll("[data-sync-card]").forEach((el) => { el.outerHTML = syncCardHtml(); });
}

// Redraws to show the other device's change - but never while you're
// typing in a field or dragging a card. Redrawing replaces the whole
// screen, which would wipe half-typed text or drop the card mid-drag.
// In those cases it waits: until you leave the field, or the drag ends.
let remoteRedrawWaiting = false;
function handleRemoteChange() {
  if (authState !== "signedIn" || !isSyncReady()) return;

  const focused = document.activeElement;
  const typing = focused && appRoot().contains(focused) && focused.matches("input, textarea, select");
  if (typing) {
    // Check again every half second until the field is let go. (A
    // "focus left the field" event would be neater, but browsers don't
    // fire it reliably in every case, and a missed one would leave the
    // screen stale.) If focus moved into another field, it keeps waiting.
    if (!remoteRedrawWaiting) {
      remoteRedrawWaiting = true;
      setTimeout(() => {
        remoteRedrawWaiting = false;
        handleRemoteChange();
      }, 500);
    }
    return;
  }
  if (draggedIdeaId) {
    setTimeout(handleRemoteChange, 300);
    return;
  }
  render();
}

// Going on/offline only changes what the sign-in screen says, so only
// redraw while it's showing (redrawing the app itself could interrupt
// someone typing).
window.addEventListener("online", () => { if (authState === "signedOut") render(); });
window.addEventListener("offline", () => { if (authState === "signedOut") render(); });

/* ------------------------- Navigation helpers ------------------------- */
// Every screen change goes through one of these three, so there's a
// single place that closes the hamburger menu and re-renders - no
// screen-switching code path can forget to do either.

function goHome() {
  currentScreen = "home";
  isMenuOpen = false;
  isShareOpen = false;
  isEditTripOpen = false;
  isAccountOpen = false;
  render();
}

function goToScreen(screen) {
  currentScreen = screen;
  isMenuOpen = false;
  isShareOpen = false;
  isEditTripOpen = false;
  isAccountOpen = false;
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
   product-decisions.md for why Home is the one exception.
   Under the title: the sync status (LUV-43), after any extra buttons
   the screen passes in (the trip screen's Share). */
function subpageHeaderHtml(titleHtml, extraHtml = "") {
  return `
    <div class="header-left">
      <div class="brand-lockup" onclick="goHome()" role="button" tabindex="0" aria-label="SetOut - go to Home">${brandLockupSvg(true)}</div>
      ${titleHtml}
      <div class="header-meta-row">
        ${extraHtml}
        <button class="sync-btn" type="button" onclick="openAccountPanel()" aria-label="Sync status and account">${syncStatusHtml()}</button>
      </div>
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
        ${signedInEmail ? `
          <div class="menu-divider"></div>
          <div class="menu-item muted menu-account">Signed in as<small>${escapeHtml(signedInEmail)}</small></div>
          <div class="menu-item" onclick="event.stopPropagation(); handleSignOut()">Sign out</div>
        ` : ""}
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

/* ---------------------- Sync status and account (LUV-43) ------------------ */
// The status label, Home's account button, and the "Sync and account"
// panel either one opens. Reviewed first as mockup/sync-status-mockup.html.

const SYNC_STATUS_LABELS = {
  synced: "Synced",
  syncing: "Syncing&hellip;",
  waiting: "Waiting to sync",
  offline: "Offline"
};

// The panel's longer explanation of each state.
const SYNC_STATUS_DETAILS = {
  synced: "Every change on this device has reached the server, so everyone on your trips sees the same thing.",
  syncing: "Sending your latest changes now.",
  waiting: "Your latest changes are saved on this device. They'll sync on their own when there's signal, and then the others on your trips will see them.",
  offline: "No signal right now. Everything still works, and your changes and everyone else's swap when you're back online."
};

function syncIconSvg(status) {
  const paths = {
    synced: `<path d="M20 6 9 17l-5-5" stroke-width="2.4" stroke-linejoin="round"/>`,
    syncing: `<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18.5 2.5v3.7h-3.7M5.5 21.5v-3.7h3.7" stroke-linejoin="round"/>`,
    waiting: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linejoin="round"/>`,
    offline: `<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 7.2 8.6 4.7 4.7 0 0 0 7 18z" stroke-linejoin="round"/><line x1="3" y1="3" x2="21" y2="21"/>`
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">${paths[status]}</svg>`;
}

// data-sync-status marks it for handleSyncStatus() to swap in place.
function syncStatusHtml() {
  return `<span class="sync-status ${syncStatus}" data-sync-status>${syncIconSvg(syncStatus)}${SYNC_STATUS_LABELS[syncStatus]}</span>`;
}

function syncCardHtml() {
  return `
    <div class="account-status-card ${syncStatus}" data-sync-card>
      ${syncIconSvg(syncStatus)}
      <div>
        <div class="status-title">${SYNC_STATUS_LABELS[syncStatus]}</div>
        <p>${SYNC_STATUS_DETAILS[syncStatus]}</p>
      </div>
    </div>`;
}

// The email in two parts so that, if it's too long for the space, the
// part before the @ gets cut short and the domain stays visible. The
// domain is what tells a work account from a personal one.
function accountEmailHtml(email) {
  const at = (email || "").lastIndexOf("@");
  if (at < 0) return `<span class="account-email"><span class="email-local">${escapeHtml(email || "")}</span></span>`;
  return `<span class="account-email"><span class="email-local">${escapeHtml(email.slice(0, at))}</span><span class="email-domain">${escapeHtml(email.slice(at))}</span></span>`;
}

function accountPanelHtml() {
  // Clicking the shaded area (but not the panel itself) closes it.
  return `
    <div class="share-overlay" onclick="if (event.target === this) closeAccountPanel()">
      <div class="share-panel" role="dialog" aria-label="Sync and account">
        <div class="share-panel-head">
          <h2>Sync and account</h2>
          <button class="share-close" type="button" aria-label="Close" onclick="closeAccountPanel()">&times;</button>
        </div>
        ${syncCardHtml()}
        <div class="account-label">Signed in as</div>
        <div class="account-panel-email">${escapeHtml(signedInEmail || "")}</div>
        <p class="share-hint">You only see trips shared with this email. Missing a trip? It may be on a different Google account.</p>
        <button class="account-signout" type="button" onclick="handleSignOut()">Sign out</button>
      </div>
    </div>`;
}

function openAccountPanel() {
  isMenuOpen = false;
  isAccountOpen = true;
  render();
}

function closeAccountPanel() {
  isAccountOpen = false;
  render();
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

// Which trip Home's banner offers to continue on a device that hasn't
// opened one yet (LUV-45). Which trip is open is saved per device, so
// since sync a brand new device - or Dave's phone - can have trips
// without an open one. Rather than say "No trip in progress", offer the
// trip coming up soonest: one happening now, then the next upcoming one;
// if every trip has ended, the one that ended most recently; trips with
// no dates last. Only DISPLAYS the choice - tapping the banner is what
// opens it and makes it this device's open trip.
// (Dates are "YYYY-MM-DD" strings, which sort correctly as plain text.)
function soonestTrip(trips) {
  const today = isoDateKey(new Date());
  const startOf = (t) => t.startDate || t.endDate;
  const endOf = (t) => t.endDate || t.startDate;
  const dated = trips.filter((t) => startOf(t));

  // A trip in progress has the earliest start of all trips that haven't
  // ended yet, so sorting those by start date puts it first.
  const notEnded = dated
    .filter((t) => endOf(t) >= today)
    .sort((a, b) => startOf(a).localeCompare(startOf(b)));
  if (notEnded.length) return notEnded[0];

  const ended = dated.slice().sort((a, b) => endOf(b).localeCompare(endOf(a)));
  if (ended.length) return ended[0];

  return trips[0] || null;
}

function renderHomeScreen() {
  const trips = getTrips();
  const trip = getActiveTrip() || soonestTrip(trips);

  const banner = trip
    ? `
      <div class="hero-banner" onclick="openTrip('${trip.id}')">
        <div class="eyebrow">Continue</div>
        <div class="trip-name">${escapeHtml(trip.name)}</div>
        <div class="muted small">${escapeHtml(trip.destination || "")} ${formatDateRange(trip.startDate, trip.endDate)}</div>
      </div>`
    : `
      <div class="hero-banner empty">
        <div class="eyebrow">No trips on this account</div>
        <div class="trip-name">Ready to plan your next one?</div>
        <p class="banner-account">Signed in as <b>${escapeHtml(signedInEmail || "")}</b>. Expecting trips? They may be on a different Google account.</p>
        <button class="banner-link" type="button" onclick="handleSignOut()">Switch account</button>
      </div>`;

  appRoot().innerHTML = `
    <header class="app-header">
      <h1 class="brand-lockup" onclick="goHome()" aria-label="SetOut">${brandLockupSvg()}</h1>
      <button class="account-btn" type="button" onclick="openAccountPanel()" aria-label="Signed in as ${escapeHtml(signedInEmail || "")}. Sync status and account">
        ${accountEmailHtml(signedInEmail)}
        ${syncStatusHtml()}
      </button>
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
      ${trips.length ? tripRows : `<p class="muted empty-state">No trips on this account yet. <a href="#" onclick="event.preventDefault(); goToScreen('newTrip')">Start your first one</a>.</p>`}
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
  currentTab = TRIP_START_TAB;
  currentScreen = "trip";
  render();
}

function openTrip(tripId) {
  setActiveTrip(tripId);
  currentTab = TRIP_START_TAB;
  currentScreen = "trip";
  isShareOpen = false;
  isEditTripOpen = false;
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
      ${subpageHeaderHtml(`<h1 class="page-title">${escapeHtml(trip.name)}</h1><div class="muted small">${escapeHtml(trip.destination || "")} ${formatDateRange(trip.startDate, trip.endDate)}</div>`, editTripChipHtml() + shareChipHtml(trip))}
    </header>
    <main class="screen" id="tab-content"></main>
    <nav class="tab-bar">
      <button class="tab-btn ${currentTab === "ideas" ? "active" : ""}" onclick="showTab('ideas')">Ideas</button>
      <button class="tab-btn ${currentTab === "itinerary" ? "active" : ""}" onclick="showTab('itinerary')">Itinerary</button>
      <button class="tab-btn ${currentTab === "packing" ? "active" : ""}" onclick="showTab('packing')">Packing</button>
      <button class="tab-btn ${currentTab === "budget" ? "active" : ""}" onclick="showTab('budget')">Budget</button>
      <button class="tab-btn ${currentTab === "notes" ? "active" : ""}" onclick="showTab('notes')">Notes</button>
    </nav>
    ${isShareOpen ? sharePanelHtml(trip) : ""}
    ${isEditTripOpen ? editTripPanelHtml(trip) : ""}
  `;
  renderTabContent(trip);
}

/* ------------------------- Sharing a trip (LUV-42) ------------------------ */
// The Share button under a trip's name, and the panel it opens: who's on
// the trip, and a box to add someone by email. Anyone added can see and
// edit the whole trip once they sign in with Google using that email.
// Reviewed first as mockup/share-trip-mockup.html.

// Panel state, in memory only. shareDraft keeps a half-typed email if
// the screen redraws (say, an edit arrives from Dave) while it's open.
let isShareOpen = false;
let shareDraft = "";
let shareMessage = "";

function shareChipHtml(trip) {
  const others = (trip.memberEmails || []).length - 1;
  return `
    <button class="share-chip" type="button" onclick="openSharePanel()">
      ${peopleIconSvg()}${others > 0 ? `Shared with ${others}` : "Share"}
    </button>`;
}

function peopleIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 13.6c2.6.3 4.5 2.3 4.5 5"/></svg>`;
}

function sharePanelHtml(trip) {
  const me = getCurrentUserEmail();
  const rows = getTripMembers(trip.id).map((email) => `
    <div class="member-row">
      <span class="member-email">${escapeHtml(email)}${email === me ? ` <span class="member-you">(you)</span>` : ""}</span>
      ${email === me ? "" : `<button class="member-remove" type="button" data-email="${escapeHtml(email)}" onclick="handleRemoveMember('${trip.id}', this.dataset.email)">Remove</button>`}
    </div>`).join("");

  // Clicking the shaded area (but not the panel itself) closes it.
  return `
    <div class="share-overlay" onclick="if (event.target === this) closeSharePanel()">
      <div class="share-panel" role="dialog" aria-label="Share ${escapeHtml(trip.name)}">
        <div class="share-panel-head">
          <h2>Share ${escapeHtml(trip.name)}</h2>
          <button class="share-close" type="button" aria-label="Close" onclick="closeSharePanel()">&times;</button>
        </div>
        <p class="share-intro">People on this trip can see and edit all of it: ideas, itinerary, packing, budget and notes.</p>
        <div class="member-list">${rows}</div>
        <!-- novalidate: the browser's own "please enter an email" bubble
             would replace the app's message below. type="email" stays,
             for the email keyboard on phones. -->
        <form class="share-add-row" novalidate onsubmit="handleAddMember(event, '${trip.id}')">
          <input name="email" type="email" placeholder="Their Google email" autocomplete="off" value="${escapeHtml(shareDraft)}" oninput="shareDraft = this.value" />
          <button class="primary" type="submit">Add</button>
        </form>
        ${shareMessage ? `<p class="share-msg">${escapeHtml(shareMessage)}</p>` : ""}
        <p class="share-hint">They'll see it the next time they open SetOut, signed in with Google using this email.</p>
      </div>
    </div>`;
}

function openSharePanel() {
  isShareOpen = true;
  isEditTripOpen = false;
  shareDraft = "";
  shareMessage = "";
  render();
}

function closeSharePanel() {
  isShareOpen = false;
  shareMessage = "";
  render();
}

// Deliberately loose: something@something.something. Google decides
// what's a real account; this only catches obvious typos.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function handleAddMember(event, tripId) {
  event.preventDefault();
  const email = event.target.email.value.trim().toLowerCase();
  if (!LOOKS_LIKE_EMAIL.test(email)) {
    shareMessage = "That doesn't look like an email address.";
  } else if (getTripMembers(tripId).includes(email)) {
    shareMessage = `${email} is already on this trip.`;
  } else {
    addTripMember(tripId, email);
    shareDraft = "";
    shareMessage = "";
  }
  render();
}

function handleRemoveMember(tripId, email) {
  const trip = getTrips().find((t) => t.id === tripId);
  const ok = confirm(`Remove ${email} from ${trip ? trip.name : "this trip"}? They'll lose access to the whole trip on all their devices. You can add them back any time.`);
  if (!ok) return;
  removeTripMember(tripId, email);
  render();
}

/* ------------------------- Editing a trip (LUV-50) ------------------------ */
// The Edit button beside Share, and the sheet it opens: the New Trip
// form's four fields, filled in. Uses the Share panel's slide-up sheet
// styles. Reviewed first as mockup/edit-trip-mockup.html.

// Sheet state, in memory only. The draft keeps what's been typed if the
// screen redraws while the sheet is open (say, an edit arrives from
// Dave), the same way shareDraft does. editTripOriginal is what each
// field held when the sheet opened, so Save can tell which fields YOU
// changed - see handleSaveTrip().
let isEditTripOpen = false;
let editTripDraft = null;
let editTripOriginal = null;
const EDIT_TRIP_FIELDS = ["name", "destination", "startDate", "endDate"];

function pencilIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`;
}

// Reuses the Share chip's look, so the two sit as a matching pair.
function editTripChipHtml() {
  return `<button class="share-chip" type="button" onclick="openEditTripPanel()">${pencilIconSvg()}Edit</button>`;
}

function openEditTripPanel() {
  const trip = getActiveTrip();
  if (!trip) return;
  editTripDraft = {};
  EDIT_TRIP_FIELDS.forEach((f) => { editTripDraft[f] = trip[f] || ""; });
  editTripOriginal = { ...editTripDraft };
  isEditTripOpen = true;
  isShareOpen = false;
  render();
}

function closeEditTripPanel() {
  isEditTripOpen = false;
  editTripDraft = null;
  editTripOriginal = null;
  render();
}

// What's stopping a save, or "" when nothing is. Dates are both-or-
// neither: the calendar needs a start AND an end, and a half-dated trip
// would look dated in the header while its Itinerary stayed empty.
function editTripProblem(draft) {
  if (!draft.name.trim()) return "Give the trip a name.";
  if (!draft.startDate !== !draft.endDate) return "Add both dates, or leave both blank.";
  if (draft.startDate && draft.endDate < draft.startDate) return "The end date is before the start date.";
  return "";
}

// The note under the dates: which placed cards would end up outside
// the new dates. Shown only when the dates are being changed. A note,
// not an "are you sure?" pop-up, because nothing is lost - see
// isPlacedOutsideTrip().
function editTripFeedbackHtml(trip, draft) {
  const problem = editTripProblem(draft);
  if (problem) return `<div class="edit-notice error">${escapeHtml(problem)}</div>`;
  const datesChanged = draft.startDate !== (trip.startDate || "") || draft.endDate !== (trip.endDate || "");
  if (!datesChanged || !draft.startDate) return "";
  const outside = getIdeas(trip.id)
    .filter((i) => columnKeyForIdea(i) === "itinerary")
    .filter((i) => isPlacedOutsideTrip(i, draft.startDate, draft.endDate));
  if (!outside.length) return "";
  const count = outside.length === 1 ? "1 card on the calendar falls" : `${outside.length} cards on the calendar fall`;
  return `
    <div class="edit-notice info">
      ${count} outside these dates. ${outside.length === 1 ? "It'll keep its day and wait" : "They'll keep their day and wait"} under <b>Outside the trip dates</b> in Itinerary Building Blocks:
      <ul>${outside.map((i) => `<li>${escapeHtml(i.title)} (${outsidePlacementLabel(i)})</li>`).join("")}</ul>
    </div>`;
}

function editTripPanelHtml(trip) {
  // If Dave changed a field while this sheet was open, show his new
  // value in any field you haven't touched, so the sheet never shows
  // (or saves) something older than the header behind it.
  EDIT_TRIP_FIELDS.forEach((f) => {
    const now = trip[f] || "";
    if (editTripDraft[f] === editTripOriginal[f]) editTripDraft[f] = now;
    editTripOriginal[f] = now;
  });
  const d = editTripDraft;
  // Clicking the shaded area (but not the sheet itself) closes it.
  return `
    <div class="share-overlay" onclick="if (event.target === this) closeEditTripPanel()">
      <div class="share-panel" role="dialog" aria-label="Edit trip">
        <div class="share-panel-head">
          <h2>Edit trip</h2>
          <button class="share-close" type="button" aria-label="Close" onclick="closeEditTripPanel()">&times;</button>
        </div>
        <form class="form edit-panel-form" novalidate onsubmit="handleSaveTrip(event, '${trip.id}')">
          <label>Trip name
            <input name="name" type="text" value="${escapeHtml(d.name)}" oninput="handleEditTripInput(this)" />
          </label>
          <label>Destination
            <input name="destination" type="text" value="${escapeHtml(d.destination)}" oninput="handleEditTripInput(this)" />
          </label>
          <div class="row">
            <label>Start date
              <input name="startDate" type="date" value="${escapeHtml(d.startDate)}" oninput="handleEditTripInput(this)" />
            </label>
            <label>End date
              <input name="endDate" type="date" value="${escapeHtml(d.endDate)}" oninput="handleEditTripInput(this)" />
            </label>
          </div>
          <div id="edit-trip-feedback">${editTripFeedbackHtml(trip, d)}</div>
          <div class="form-actions">
            <button type="button" onclick="closeEditTripPanel()">Cancel</button>
            <button class="primary" type="submit" id="edit-trip-save"${editTripProblem(d) ? " disabled" : ""}>Save</button>
          </div>
        </form>
      </div>
    </div>`;
}

// Typing only refreshes the note and the Save button, not the whole
// screen: a full redraw would rebuild the inputs and drop the cursor
// out of the field being typed in.
function handleEditTripInput(input) {
  const trip = getActiveTrip();
  if (!trip || !editTripDraft) return;
  editTripDraft[input.name] = input.value;
  document.getElementById("edit-trip-feedback").innerHTML = editTripFeedbackHtml(trip, editTripDraft);
  document.getElementById("edit-trip-save").disabled = !!editTripProblem(editTripDraft);
}

function handleSaveTrip(event, tripId) {
  event.preventDefault();
  const d = editTripDraft;
  if (!d || editTripProblem(d)) return;
  // Only the fields you changed in this sheet. A field you left alone
  // is never sent, even if it now differs from the trip (Dave may have
  // just changed it on his phone), so his edit isn't undone by yours.
  const changes = {};
  EDIT_TRIP_FIELDS.forEach((f) => {
    if (d[f] !== editTripOriginal[f]) changes[f] = f === "name" || f === "destination" ? d[f].trim() : d[f];
  });
  updateTripDetails(tripId, changes);
  isEditTripOpen = false;
  editTripDraft = null;
  editTripOriginal = null;
  render();
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

  // The calendar popover is a fixed-position element whose coordinates
  // are computed in JS against its anchor card's real position - every
  // full re-render recreates that anchor as a new DOM node, so this has
  // to re-run every time, not just when the popover first opens. A
  // no-op on every other tab / whenever nothing's open (see the early
  // return in positionCalendarPopover()).
  if (currentTab === "itinerary" && isCalendarPopoverOpen()) positionCalendarPopover();
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
        <input name="title" type="text" maxlength="25" placeholder="e.g. Table Mountain cable car" required />
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
        <label>Address or meeting point
          <input name="location" type="text" placeholder="e.g. ferry pier, hotel street address" />
          <span class="muted small">Where you actually go. The map pins this spot. Shows on the card once it's in The Plan or The Itinerary.</span>
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
          <input name="departureDate" type="date" oninput="refreshAddFormDateNotes(this.form)" />
        </label>
        <label>Departure time
          <input name="departureTime" type="time" />
        </label>
      </div>
      <div data-activity-fields="flight,transport" data-date-note style="display:none"></div>
      <div class="row" data-activity-fields="flight,transport" style="display:none">
        <label>Arrival date
          <input name="arrivalDate" type="date" oninput="refreshAddFormDateNotes(this.form)" />
        </label>
        <label>Arrival time
          <input name="arrivalTime" type="time" />
        </label>
      </div>
      <div class="row" data-activity-fields="lodging" style="display:none">
        <label>Check-in date
          <input name="checkInDate" type="date" oninput="refreshAddFormDateNotes(this.form)" />
        </label>
        <label>Check-out date
          <input name="checkOutDate" type="date" oninput="refreshAddFormDateNotes(this.form)" />
        </label>
      </div>
      <div data-activity-fields="lodging" data-date-note style="display:none"></div>
      <div class="row" data-activity-fields="lodging" style="display:none">
        <label>Check-in time <span class="muted small">(optional)</span>
          <input name="checkInTime" type="time" />
        </label>
        <label>Check-out time <span class="muted small">(optional)</span>
          <input name="checkOutTime" type="time" />
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
      <label>Reservation time <span class="muted small">(optional - not every reservation has a fixed time)</span>
        <input name="reservationTime" type="time" disabled />
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
  [form.urgencyNotes, form.confirmationInfo, form.reservationTime].forEach((el) => {
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
  refreshAddFormDateNotes(form);
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

/* ---- Card dates outside the trip (LUV-24) ---- */
// A Flight/Transport/Lodging date outside the trip's start..end gets an
// amber note under it. It's a note, not a block: an overnight flight
// can leave the day before the trip's first day, and a booking can be
// recorded before the trip's dates are final. The note links to the
// Edit trip sheet (LUV-50) for when it's the trip's dates that are off.

const TRIP_DATE_FIELDS = {
  flight: [["departureDate", "Departure"], ["arrivalDate", "Arrival"]],
  transport: [["departureDate", "Departure"], ["arrivalDate", "Arrival"]],
  lodging: [["checkInDate", "Check-in"], ["checkOutDate", "Check-out"]]
};

function shortDate(isoDate) {
  return parseLocalDate(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// `values` is the card, or the add form's fields in the same shape.
// Returns "" when there's nothing to say.
function dateRangeNoteHtml(trip, values) {
  const fields = TRIP_DATE_FIELDS[values.activityType];
  if (!fields || !trip.startDate || !trip.endDate) return "";

  // ISO dates compare correctly as plain strings.
  const sentences = [];
  fields.forEach(([key, label]) => {
    const date = values[key];
    if (!date) return;
    if (date < trip.startDate) sentences.push(`${label} (${shortDate(date)}) is before this trip starts (${shortDate(trip.startDate)})`);
    else if (date > trip.endDate) sentences.push(`${label} (${shortDate(date)}) is after this trip ends (${shortDate(trip.endDate)})`);
  });
  if (!sentences.length) return "";

  // Where the card would sit on the calendar, by the same rule the
  // calendar uses (a Flight/Transport on its departure day, a Lodging
  // stay across check-in..check-out), so the note can say whether it
  // will still show there.
  let placement = null;
  if (values.activityType === "lodging" && values.checkInDate && values.checkOutDate && values.checkOutDate >= values.checkInDate) {
    placement = { date: values.checkInDate, slot: "lodging", span: daysBetweenDates(values.checkInDate, values.checkOutDate) + 1 };
  } else if (values.activityType !== "lodging" && values.departureDate) {
    placement = { date: values.departureDate, slot: "morning", span: 1 };
  }
  let text;
  if (placement && isPlacedOutsideTrip({ scheduled: placement }, trip.startDate, trip.endDate)) {
    text = sentences.length === 1
      ? `${sentences[0]}, so this card won't show on the calendar.`
      : `${sentences.join(". ")}. This card won't show on the calendar.`;
  } else {
    text = `${sentences.join(". ")}.`;
    if (values.activityType === "lodging" && placement) text += " The nights inside the trip still show on the calendar.";
  }

  return `
    <div class="date-range-note">
      <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-warn"/></svg>
      <span>${escapeHtml(text)} <button class="link-btn" type="button" onclick="openEditTripPanel()">Change trip dates</button></span>
    </div>`;
}

// The add form isn't redrawn while you type, so its notes are filled
// in here whenever a date (or the category) changes.
function refreshAddFormDateNotes(form) {
  const trip = getActiveTrip();
  if (!trip) return;
  const values = { activityType: form.activityType.value };
  ["departureDate", "arrivalDate", "checkInDate", "checkOutDate"].forEach((key) => { values[key] = form[key].value; });
  const html = dateRangeNoteHtml(trip, values);
  form.querySelectorAll("[data-date-note]").forEach((slot) => { slot.innerHTML = html; });
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
      ${dateRangeNoteHtml(trip, idea)}
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
      ${dateRangeNoteHtml(trip, idea)}
      <div class="idea-edit-row">
        <label class="idea-edit-field">
          <span>Check-in time <span class="muted small">(optional)</span></span>
          <input type="time" value="${escapeHtml(idea.checkInTime)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'checkInTime', this.value)" />
        </label>
        <label class="idea-edit-field">
          <span>Check-out time <span class="muted small">(optional)</span></span>
          <input type="time" value="${escapeHtml(idea.checkOutTime)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'checkOutTime', this.value)" />
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
  // browsing the board. The address (location.placeName) is collected
  // the whole time (the map needs it for every candidate) but only
  // DISPLAYED once an idea has left The Ideas, when it becomes useful
  // as reference info rather than clutter next to the Region line.
  //
  // "Address or meeting point" means the place you physically go, not
  // the attraction's name - the ferry pier rather than the island. The
  // card title already says what it is. See LUV-36 in the Product
  // Decisions Log for why this is one field rather than two.
  const exactLocationLine = columnKey !== "ideas" && idea.location.placeName
    ? `<div class="kanban-card-exact-location">&#128204; Address: ${escapeHtml(idea.location.placeName)}</div>`
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
        <!-- Only buttons up here. Badges live on the line below (LUV-46):
             on a phone, a badge in this row squeezed the title to nothing. -->
        <div class="kanban-card-actions">
          ${backBtn}
          ${forwardBtn}
          <button class="icon-btn danger" type="button" onclick="handleDeleteIdea('${trip.id}', '${idea.id}')" aria-label="Delete idea">&times;</button>
        </div>
      </div>

      <div class="kanban-card-collapsed-meta">
        ${idea.urgent ? `<span class="badge-flag badge-urgent">Urgent</span>` : ""}
        ${idea.region ? `<span class="kanban-card-region">&#128205; ${escapeHtml(idea.region)}</span>` : ""}
        <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
        ${needsReservationFlag ? `<span class="badge-flag badge-reservation-needed">Needs reservation</span>` : ""}
        ${isReserved ? `<span class="badge-flag badge-reserved">&#10003; Reserved</span>` : ""}
      </div>
      ${exactLocationLine}

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
              <span>Address or meeting point</span>
              <input type="text" placeholder="e.g. ferry pier, hotel street address" value="${escapeHtml(idea.location.placeName)}" onchange="handleUpdateIdeaLocation('${trip.id}', '${idea.id}', this.value.trim())" />
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
          <label class="idea-edit-field">
            <span>Reservation time <span class="muted small">(optional - not every reservation has a fixed time)</span></span>
            <input type="time" value="${escapeHtml(idea.reservationTime)}" onchange="handleUpdateIdeaField('${trip.id}', '${idea.id}', 'reservationTime', this.value)" />
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

// The address (location.placeName) is nested under idea.location and, unlike the plain
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

  // Fixed 2026-09-12 (LUV-7 Step 2): leaving The Itinerary used to
  // leave the card's calendar placement (scheduled) untouched - it
  // just became invisible, filtered out of the calendar view, rather
  // than actually clearing. A card moved back in later would then
  // start from a stale placement instead of a clean slate.
  if (currentColumn === "itinerary" && columnKey !== "itinerary") {
    unscheduleIdea(tripId, ideaId);
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
    checkOutDate: form.checkOutDate.value,
    checkInTime: form.checkInTime.value,
    checkOutTime: form.checkOutTime.value,
    reservationTime: form.reservationTime.value
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
// Building-view calendar (LUV-6). Phase 3, Step 3: drag-and-drop
// placement plus extend/shrink, for both regular slots and the All Day
// row - full parity with the confirmed calendar mockup for these two
// mechanics. Deliberately NOT in this step: click-to-edit, collision
// warning flags, and auto-scheduling from confirmed flight/lodging
// dates - those are Phase 4 (see product-decisions.md's "Lodging/
// flight editing + auto-scheduling" section).
//
// The Lodging row stays fully inert here on purpose - dragging
// something onto it was never actually part of the confirmed mockup
// (its Lodging bars are hand-built HTML illustrating what AUTO
// placement from checkInDate/checkOutDate will look like once Phase 4
// wires that up). Building drag-and-drop for it now would mean
// inventing an interaction nobody has reviewed.
//
// Grid rules (confirmed in the calendar mockup, product-decisions.md):
// weeks start Sunday regardless of the trip's own start day, days
// outside the trip's date range are grayed out and non-interactive,
// each day has an All Day row, four regular slots, and a Lodging row.

const CALENDAR_SLOTS = [
  { key: "allday", label: "All day" },
  { key: "morning", label: "Morning" },
  { key: "midday", label: "Midday" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
  { key: "lodging", label: "Lodging" }
];

// Row each slot lands on inside .cal-grid's CSS grid (row 1 is the
// header row, built from document order - see calendarWeekBlockHtml).
// Kept explicit here because placed items are now positioned with an
// inline grid-row instead of being nested inside one specific cell div
// - that's what lets an item's box actually stretch across several
// rows/columns for extend/shrink instead of being trapped in one cell.
const CALENDAR_SLOT_ROWS = { allday: 2, morning: 3, midday: 4, afternoon: 5, evening: 6, lodging: 7 };

// Only these four slots support the "stretch across contiguous slots
// in one day" extend/shrink mechanic - All Day stretches across DAYS
// instead (a different axis, handled separately below), and Lodging
// has no interactivity at all this pass.
const REGULAR_SLOT_KEYS = ["morning", "midday", "afternoon", "evening"];

/* ---- Auto-scheduling (LUV-7 Step 2) ---- */
// "Confirmed date/time always wins" (product-decisions.md, 2026-09-12)
// - Flight/Transport/Lodging cards with a real, confirmed date auto-
// place onto the calendar rather than requiring a manual drag. Scoped
// to these three types only: a plain activity's reservationTime has
// no paired date field, so there's structurally nothing to place it
// against (see "Phase 4, Step 2" in product-decisions.md).
const AUTO_SCHEDULE_TYPES = ["flight", "transport", "lodging"];

// Time-of-day cutoffs for placing a Flight/Transport departure/arrival
// into a slot (confirmed 2026-09-12 - the mockup's own cutoffs were
// explicitly illustrative, not locked). "HH:MM" 24hr, from
// <input type="time">.
function slotForTime(timeStr) {
  const match = /^(\d{1,2}):(\d{2})/.exec(timeStr || "");
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  return "evening";
}

function daysBetweenDates(startIso, endIso) {
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso);
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

// Computes where an idea SHOULD sit on the calendar right now, purely
// from its own confirmed fields - never reads or depends on its
// current idea.scheduled value. Returns null if this idea's type
// doesn't auto-schedule, or if it does but the required fields aren't
// filled in yet (in which case syncAutoScheduledIdeas() below
// unschedules it rather than leaving a stale placement).
function computeAutoSchedule(idea) {
  if (idea.activityType === "lodging") {
    if (!idea.checkInDate || !idea.checkOutDate) return null;
    // Span is inclusive of BOTH the check-in and check-out calendar
    // days (a 3-night stay, check in Mon/check out Thu, shows as a
    // 4-day-wide bar) - matches the display logic already written for
    // which segment shows checkInTime vs checkOutTime (see
    // placedCardTimeLabel below), confirmed in product-decisions.md.
    const span = daysBetweenDates(idea.checkInDate, idea.checkOutDate) + 1;
    if (span < 1) return null; // checkout on/before checkin - invalid range, nothing sensible to place
    return { date: idea.checkInDate, slot: "lodging", span };
  }

  if (idea.activityType === "flight" || idea.activityType === "transport") {
    if (!idea.departureDate || !idea.departureTime) return null;
    const departureSlot = slotForTime(idea.departureTime);
    if (!departureSlot) return null;

    // Same-day arrival with a known time: a real spanning bar from
    // departure slot through arrival slot, reusing the existing
    // regular-slot extend mechanic directly (cheap - see
    // product-decisions.md's "Phase 4, Step 2"). Cross-day arrivals
    // are NOT handled here - see crossDayArrivalEchoes() below for why
    // that's a derived echo instead of a second real placement.
    if (idea.arrivalDate && idea.arrivalTime && idea.arrivalDate === idea.departureDate) {
      const arrivalSlot = slotForTime(idea.arrivalTime);
      if (arrivalSlot) {
        const depIdx = REGULAR_SLOT_KEYS.indexOf(departureSlot);
        const arrIdx = REGULAR_SLOT_KEYS.indexOf(arrivalSlot);
        const span = Math.max(1, arrIdx - depIdx + 1);
        return { date: idea.departureDate, slot: departureSlot, span };
      }
    }

    return { date: idea.departureDate, slot: departureSlot, span: 1 };
  }

  return null;
}

// Corrects drift between what's stored (idea.scheduled) and what the
// confirmed fields actually say, for every Flight/Transport/Lodging
// card in The Itinerary. Deliberately called from itineraryTabHtml()
// itself (a render function) rather than hunting down every place a
// relevant field could change - the kanban card's inline-edit body,
// the calendar popover, AND moving a card into The Itinerary all could
// change these fields, and a render-time sync guarantees "confirmed
// data always wins" stays true no matter which path caused the
// change, without needing a hook at each one individually. This is a
// deliberate, narrow exception to "render functions only read data,
// they don't write it" (see this file's header comment) - flagged
// here so it doesn't look like an oversight if it's ever ported
// elsewhere.
//
// Never touches a plain activity's manually-set idea.scheduled -
// computeAutoSchedule() only returns non-null for the three
// auto-schedule types, so anything else is filtered out before this
// function ever looks at it.
//
// Runs the same overlap-eviction check a manual drag/extend already
// uses (fixed 2026-09-12, found during Step 3 testing): without this,
// an auto-placed spanning bar (e.g. a same-day flight spanning
// Midday+Afternoon) could genuinely, partially overlap a different
// card without evicting OR grouping it - the multi-item-stacking/
// collision-flag path above only fires on an EXACT footprint match,
// and a partial overlap was silently falling through both mechanisms,
// rendering as two overlapping boxes with no relationship to each
// other. Lodging isn't included here - it has no eviction mechanism
// at all yet (see LUV-26).
//
// Note on processing order: this loop can, in principle, evict a
// LATER-processed item in the same pass before this loop reaches it,
// in which case that item's cached `current` (read before the evict)
// is briefly stale. Not specially handled - the very next render
// (which the app's re-render-on-every-change architecture triggers
// immediately after any interaction) re-runs this sync against fresh
// data and self-corrects. A real inconsistency surviving more than one
// render would be worth revisiting; a one-frame one isn't.
function syncAutoScheduledIdeas(tripId, itineraryIdeas) {
  itineraryIdeas
    .filter((idea) => AUTO_SCHEDULE_TYPES.includes(idea.activityType))
    .forEach((idea) => {
      const target = computeAutoSchedule(idea);
      const current = idea.scheduled;
      const isScheduled = !!(current && current.date);

      if (!target) {
        // Required confirmed fields are missing (or got cleared) - if
        // this was previously auto-placed, send it back to the
        // sidebar rather than leaving a stale placement.
        if (isScheduled) unscheduleIdea(tripId, idea.id);
        return;
      }

      const changed =
        !isScheduled ||
        current.date !== target.date ||
        current.slot !== target.slot ||
        current.span !== target.span;
      if (!changed) return;

      if (REGULAR_SLOT_KEYS.includes(target.slot)) {
        const startRow = REGULAR_SLOT_KEYS.indexOf(target.slot);
        const rows = [];
        for (let i = 0; i < target.span; i++) rows.push(startRow + i);
        evictOverlappingRegularSlotIdeas(tripId, idea.id, target.date, rows);
      }

      scheduleIdea(tripId, idea.id, target);
    });
}

// Cross-day Flight/Transport arrivals: NOT a second real placement
// (see computeAutoSchedule above and product-decisions.md's "Phase 4,
// Step 2" for why - the calendar's grid can't express a bar bending
// across both a day boundary and a slot boundary without a rebuild).
// Instead, a derived, read-only visual echo on the arrival day -
// computed live here from arrivalDate/arrivalTime, never persisted,
// never draggable, never part of collision/eviction/extend-shrink.
// Only shown when arrivalDate differs from departureDate (same-day
// arrivals already get the real spanning bar above) and arrivalTime
// is set (no time means no slot to place it in).
function crossDayArrivalEchoes(itineraryIdeas) {
  return itineraryIdeas
    .filter(
      (i) =>
        (i.activityType === "flight" || i.activityType === "transport") &&
        i.arrivalDate &&
        i.arrivalTime &&
        i.arrivalDate !== i.departureDate
    )
    .map((idea) => {
      const slot = slotForTime(idea.arrivalTime);
      return slot ? { idea, date: idea.arrivalDate, slot } : null;
    })
    .filter(Boolean);
}

/* ---- Lodging and transport gap flags (LUV-29) ---- */
// Two ambient flags on the bottom (Lodging) row, never a dialog:
//   - Red stop sign, "No lodging": a trip night that no Lodging card
//     covers. Must be fixed - the only way to clear it is a Lodging
//     card for that night. Looks ONLY at Lodging cards, never at a
//     multi-day activity above it (a 3-day tour doesn't say where you
//     sleep - product-decisions.md, 2026-09-06).
//   - Amber warning, "Transport": two stays in a row in different
//     regions, with no dated Flight or Transport card between them.
//     Often nothing needs booking (rental car, local train), so it can
//     be marked sorted with a note (saved per trip - see
//     getTransportGapNotes() in storage.js).
// Both are worked out fresh on every render from the cards themselves,
// so they disappear the moment the missing card is added.

// Lodging cards on the calendar, as { idea, checkIn, checkOut } (ISO
// day keys), oldest check-in first. Reads the auto-scheduled placement
// rather than the raw fields, so the flags always agree with the bars
// actually drawn (a stay with a missing or backwards date isn't drawn,
// so it doesn't count either).
function calendarStays(scheduledIdeas) {
  return scheduledIdeas
    .filter((i) => i.scheduled.slot === "lodging")
    .map((idea) => {
      const range = scheduledDateRange(idea.scheduled.date, idea.scheduled.span || 1);
      return { idea, checkIn: range[0], checkOut: range[range.length - 1] };
    })
    .sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.checkOut < b.checkOut ? -1 : 1))
    .map(assignStayLanes());
}

// Do two stays share at least one night? Back-to-back stays (one checks
// out the morning the other checks in) don't: they share a day, not a
// night, and the half-day row already shows them side by side.
function staysShareANight(a, b) {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

// Two stays in The Itinerary on the same night would otherwise sit in
// the same half-day columns and hide each other. Each stay gets a lane
// (its line within the Lodging row): the first lane where it doesn't
// share a night with anything already there. Lane 1 is the normal
// case; a second lane only appears when something is double-booked.
// Also records which other stays share a night with it, for the red
// "Pick one" sign. Lanes are worked out over the whole trip, so a stay
// keeps the same line across a week boundary. Used as a .map() callback
// over stays sorted by check-in.
function assignStayLanes() {
  const lanes = []; // lanes[n] = stays already placed on line n+1
  return (stay, i, all) => {
    let lane = lanes.findIndex((laneStays) => !laneStays.some((other) => staysShareANight(other, stay)));
    if (lane === -1) { lanes.push([]); lane = lanes.length - 1; }
    lanes[lane].push(stay);
    const overlaps = all.filter((other) => other !== stay && staysShareANight(other, stay)).map((o) => o.idea);
    return { ...stay, lane: lane + 1, overlaps };
  };
}

// Runs of nights with no Lodging card, as { start, end } where start
// is the first night with no bed and end is the morning after the last
// one - the same "check-in evening to check-out morning" shape a real
// stay has, so the night track can draw a gap exactly like a stay.
// "The night of Jul 9" belongs to Jul 9; the trip's last day has no
// night (you're heading home), so it's never flagged.
function lodgingGapRuns(trip, stays) {
  const nights = scheduledDateRange(trip.startDate, daysBetweenDates(trip.startDate, trip.endDate));
  // ISO day keys sort as plain strings, so comparisons work directly.
  const covered = (night) => stays.some((s) => s.checkIn <= night && night < s.checkOut);
  const runs = [];
  nights.forEach((night) => {
    if (covered(night)) return;
    const last = runs[runs.length - 1];
    if (last && last.end === night) {
      last.end = scheduledDateRange(night, 2)[1];
    } else {
      runs.push({ start: night, end: scheduledDateRange(night, 2)[1] });
    }
  });
  return runs;
}

// Hotels still being debated live in The Plan, not on the calendar
// (Luvean's call, 2026-11-15: she'll have several per region, and the
// calendar should stay a picture of the actual trip). Only dated ones
// count - a Lodging card with no check-in/check-out can't be matched to
// a night. Each night with no bed then says how many are waiting.
function planLodgingOptions(tripId) {
  return getIdeas(tripId).filter(
    (i) => i.activityType === "lodging" && columnKeyForIdea(i) === "plan" &&
      i.checkInDate && i.checkOutDate && i.checkInDate < i.checkOutDate
  );
}

// Amber transport warnings, one per pair of back-to-back stays whose
// regions differ (ignoring capitals and stray spaces). A stay with no
// region can't be compared, so it never triggers one. Cleared by any
// Flight or Transport card in The Itinerary whose departure date falls
// between the first stay's check-out and the next one's check-in,
// inclusive. Undated cards don't count: the warning means "this isn't
// actually sorted yet".
function transportGaps(stays, itineraryIdeas, notes) {
  const regionKey = (idea) => (idea.region || "").trim().toLowerCase();
  const travel = itineraryIdeas.filter(
    (i) => (i.activityType === "flight" || i.activityType === "transport") && i.departureDate
  );
  const gaps = [];
  for (let n = 1; n < stays.length; n++) {
    const from = stays[n - 1];
    const to = stays[n];
    // Two stays on the same night are alternatives to pick between, not
    // a trip from one to the other - the red "Pick one" covers that.
    if (staysShareANight(from, to)) continue;
    if (!regionKey(from.idea) || !regionKey(to.idea)) continue;
    if (regionKey(from.idea) === regionKey(to.idea)) continue;
    const windowStart = from.checkOut < to.checkIn ? from.checkOut : to.checkIn;
    const windowEnd = from.checkOut < to.checkIn ? to.checkIn : from.checkOut;
    if (travel.some((t) => t.departureDate >= windowStart && t.departureDate <= windowEnd)) continue;
    const key = `${from.idea.id}__${to.idea.id}`;
    gaps.push({
      key,
      fromRegion: from.idea.region.trim(),
      toRegion: to.idea.region.trim(),
      toIdeaId: to.idea.id,
      sortedNote: notes[key] ? (notes[key].note || "") : null
    });
  }
  return gaps;
}

function itineraryTabHtml(trip) {
  if (!trip.startDate || !trip.endDate) {
    // LUV-50: a trip created without dates used to be stuck here, with
    // no way to add them. The button opens the same Edit trip sheet.
    return `
      <div class="empty-state-action">
        ${emptyStateHtml("Add a start and end date to this trip before building its calendar.")}
        <button class="primary" type="button" onclick="openEditTripPanel()">Add dates</button>
      </div>`;
  }

  // Corrects any Flight/Transport/Lodging card's placement against its
  // own confirmed fields before anything below reads it - see
  // syncAutoScheduledIdeas() above for why this runs here rather than
  // at each individual edit path. scheduleIdea()/unscheduleIdea() do
  // their own separate loadState()/saveState() round trip, so
  // itineraryIdeas has to be (re)fetched AFTER this call to see
  // whatever it just corrected - re-using the pre-sync array here
  // would silently render stale placements for a render or two.
  syncAutoScheduledIdeas(trip.id, getIdeas(trip.id).filter((i) => columnKeyForIdea(i) === "itinerary"));

  const itineraryIdeas = getIdeas(trip.id).filter((i) => columnKeyForIdea(i) === "itinerary");
  // A card placed on days that are no longer in the trip (the dates got
  // shorter - LUV-50) keeps its placement but is drawn in the sidebar's
  // "Outside the trip dates" group instead of on the calendar. Before
  // this, such a card was in neither place and simply vanished.
  const placedIdeas = itineraryIdeas.filter((i) => i.scheduled && i.scheduled.date);
  const scheduledIdeas = placedIdeas.filter((i) => !isPlacedOutsideTrip(i, trip.startDate, trip.endDate));
  const outsideIdeas = placedIdeas.filter((i) => isPlacedOutsideTrip(i, trip.startDate, trip.endDate));
  const unscheduledIdeas = itineraryIdeas.filter((i) => !(i.scheduled && i.scheduled.date));

  const weeks = calendarWeeksForTrip(trip.startDate, trip.endDate);

  // Gap flags (LUV-29) - worked out once here, then each week draws
  // whatever part of them falls inside it.
  const stays = calendarStays(scheduledIdeas);
  const gaps = {
    stays,
    lodgingRuns: lodgingGapRuns(trip, stays),
    planLodging: planLodgingOptions(trip.id),
    transport: transportGaps(stays, itineraryIdeas, getTransportGapNotes(trip.id))
  };

  // The click-to-edit popover is rendered as a sibling of the grid,
  // not nested inside whichever cell its card sits in - a grid cell
  // clips overflow, so a popover nested inside one would get cut off
  // rather than floating freely. Its position on screen is computed
  // separately, in JS, after this HTML lands in the DOM (see
  // positionCalendarPopover(), called from renderTabContent()).
  const openPopoverIdea = openCalendarPopoverIdeaId
    ? itineraryIdeas.find((i) => i.id === openCalendarPopoverIdeaId)
    : null;

  const openTransportGap = openTransportGapKey
    ? gaps.transport.find((g) => g.key === openTransportGapKey)
    : null;

  return `
    <div class="calendar-layout">
      <div class="calendar-sidebar"
           ondragover="handleSidebarDragOver(event)"
           ondragleave="handleSidebarDragLeave(event)"
           ondrop="handleSidebarDrop(event, '${trip.id}')">
        <h2>Itinerary Building Blocks</h2>
        <div class="muted small">Cards in The Itinerary column without a day yet. Drag one onto the calendar, or drag a placed card back here to unschedule it.</div>
        ${unscheduledIdeas.length
          ? unscheduledIdeas.map(calendarSidebarCardHtml).join("")
          : emptyStateHtml("Nothing waiting to be scheduled.")}
        ${outsideIdeas.length ? `
          <div class="sidebar-outside-head">Outside the trip dates</div>
          <div class="muted small">Still saved on their day. Drag one onto the calendar, or change the trip's dates.</div>
          ${outsideIdeas.map(calendarOutsideCardHtml).join("")}` : ""}
      </div>
      <div class="calendar-grid-wrap">
        ${weeks.map((week) => calendarWeekBlockHtml(week, trip, scheduledIdeas, itineraryIdeas, gaps)).join("")}
      </div>
      ${openPopoverIdea ? calendarEditPopoverHtml(trip, openPopoverIdea) : ""}
      ${openTransportGap ? transportGapPopoverHtml(trip, openTransportGap) : ""}
    </div>
  `;
}

// Fields shown: the address / meeting point first (where to go is the
// most-needed on-trip lookup - LUV-36, from the South Africa debrief),
// then type-specific logistics (flight/transport/lodging,
// reusing the exact same fields/labels as the kanban card's expanded
// body via logisticsFieldsHtml()), then confirmationInfo (find booking
// details fast). Deliberately does NOT include reservationNeeded/
// reserved/urgent - those are ideation-stage decisions already made
// by the time something's on the calendar, and editing them from a
// second place risks them drifting from the kanban card's own state.
//
// Title is shown read-only (titles aren't editable after creation -
// see product-decisions.md's "Idea cards - inline editing").
//
// Deliberately does NOT show an "auto-scheduled" badge/hint yet -
// that only becomes true once Phase 4's auto-scheduling step ships;
// every card on the calendar today got there by manual drag.
function calendarEditPopoverHtml(trip, idea) {
  const logisticsHtml = logisticsFieldsHtml(trip, idea);
  return `
    <div class="cal-edit-popover" id="cal-edit-popover">
      <div class="cal-edit-popover-head">
        <span class="cal-edit-popover-title">
          ${activityTypeIconHtml(idea.activityType)}
          ${escapeHtml(idea.title)}
        </span>
        <button type="button" class="cal-edit-popover-close" title="Close" onclick="handleCloseCalendarPopover()">&times;</button>
      </div>
      <div class="idea-edit-fields">
        <label class="idea-edit-field">
          <span>Address or meeting point</span>
          <input type="text" placeholder="e.g. ferry pier, hotel street address" value="${escapeHtml(idea.location.placeName)}" onchange="handleUpdateIdeaLocation('${trip.id}', '${idea.id}', this.value.trim())" />
        </label>
        ${logisticsHtml}
        <label class="confirmation-info-field">
          <span>Confirmation details</span>
          <textarea placeholder="Confirmation #, phone number, pickup instructions..." onchange="handleUpdateConfirmationInfo('${trip.id}', '${idea.id}', this.value)">${escapeHtml(idea.confirmationInfo)}</textarea>
        </label>
      </div>
    </div>
  `;
}

function handleOpenCalendarPopover(event, tripId, ideaId, anchorKey) {
  event.stopPropagation();
  openCalendarPopoverIdeaId = ideaId;
  openCalendarPopoverAnchorKey = anchorKey;
  openTransportGapKey = null;
  renderTabContent(getActiveTrip());
}

function handleCloseCalendarPopover() {
  openCalendarPopoverIdeaId = null;
  openCalendarPopoverAnchorKey = null;
  openTransportGapKey = null;
  renderTabContent(getActiveTrip());
}

// Positions the (already-rendered) popover relative to its anchor
// card - always starts below the anchor, then clamps so it never
// flows off the right edge or above the top of the viewport.
//
// Uses pure viewport-relative coordinates throughout, matching
// .cal-edit-popover's `position: fixed` (fixed positions relative to
// the viewport, not the document) - getBoundingClientRect() already
// gives viewport-relative numbers that account for any scrolling
// (including .screen's own internal overflow-y: auto scroll), so no
// scrollX/scrollY offset gets added on top of that. The confirmed
// calendar-mockup.html popover added window.scrollX/scrollY because
// IT used position: absolute (document-relative) - copying that math
// verbatim while using position: fixed here was a real bug (caught
// 2026-09-12 during Step 1 testing): the two positioning models don't
// mix, and the mismatch could push the popover off-screen depending
// on scroll position. Called from renderTabContent().
function positionCalendarPopover() {
  const pop = document.getElementById("cal-edit-popover");
  if (!pop) return;
  const anchor = document.querySelector(`[data-popover-anchor="${openCalendarPopoverAnchorKey}"]`);
  // No anchor means whatever it was attached to is gone (e.g. Dave
  // added the Transport card that cleared a warning) - close quietly.
  if (!anchor) { openCalendarPopoverIdeaId = null; openCalendarPopoverAnchorKey = null; openTransportGapKey = null; return; }

  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 8;
  let left = r.left;
  pop.style.top = top + "px";
  pop.style.left = left + "px";

  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 12) {
      left = window.innerWidth - pr.width - 12;
    }
    if (left < 12) left = 12;

    const minTop = 8;
    const fitsAbove = (r.top - pr.height - 8) >= 8;
    if (pr.bottom > window.innerHeight - 12 && fitsAbove) {
      top = r.top - pr.height - 8;
    }
    // Neither "stay below" nor "flip above" necessarily fits when the
    // popover is tall (e.g. Lodging's 4 fields) and the anchor sits
    // near the top of a short window - the check above only handles
    // the flip-above case, so a too-tall popover with nowhere to flip
    // to was previously left exactly where it started, running past
    // the bottom of the viewport with no way to scroll it into view
    // (position:fixed doesn't respond to page scroll). This clamps the
    // bottom edge to stay on-screen as a second pass - down to minTop,
    // at which point .cal-edit-popover's own max-height + overflow-y:
    // auto (added earlier) takes over for anything still too tall to
    // fully fit, so the rest becomes reachable by scrolling INSIDE the
    // popover instead.
    if (top + pr.height > window.innerHeight - 12) {
      top = Math.max(minTop, window.innerHeight - 12 - pr.height);
    }
    if (top < minTop) top = minTop;

    pop.style.top = top + "px";
    pop.style.left = left + "px";
  });
}

function calendarSidebarCardHtml(idea) {
  return `
    <div class="calendar-sidebar-card"
         draggable="true"
         ondragstart="handleDragStart(event, '${idea.id}')"
         ondragend="handleDragEnd(event)">
      <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
      <div class="row-title">${escapeHtml(idea.title)}</div>
    </div>
  `;
}

/* ---- Cards outside the trip dates (LUV-50) ---- */
// Shrinking a trip's dates never moves or deletes a placed card: it
// keeps its day and slot, so widening the dates again puts it straight
// back. Until then it's listed in the sidebar instead of the calendar.

// Every day a placed card covers: one day for a regular slot, several
// for All Day bars and Lodging stays (span counts days there).
function placedDayKeys(idea) {
  const { date, slot, span } = idea.scheduled;
  if (slot === "allday" || slot === "lodging") return scheduledDateRange(date, span || 1);
  return [date];
}

// True when none of a placed card's days fall inside start..end. A
// card with even one day inside still draws on the calendar, clipped.
// ISO date strings ("2027-07-29") sort the same as the dates they name,
// so plain string comparison is enough here.
function isPlacedOutsideTrip(idea, startDate, endDate) {
  if (!idea.scheduled || !idea.scheduled.date || !startDate || !endDate) return false;
  return !placedDayKeys(idea).some((day) => day >= startDate && day <= endDate);
}

// "Aug 8 · Morning" for a slot card, "Aug 8 - Aug 10" for a multi-day one.
function outsidePlacementLabel(idea) {
  const days = placedDayKeys(idea);
  const short = (key) => parseLocalDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (days.length > 1) return `${short(days[0])} - ${short(days[days.length - 1])}`;
  const slot = CALENDAR_SLOTS.find((s) => s.key === idea.scheduled.slot);
  return `${short(days[0])}${slot ? ` &middot; ${slot.label}` : ""}`;
}

// Flight, Transport and Lodging cards place themselves from their own
// dates (syncAutoScheduledIdeas), so dragging one would just snap back:
// they aren't draggable here, and say what moves them instead.
function calendarOutsideCardHtml(idea) {
  if (AUTO_SCHEDULE_TYPES.includes(idea.activityType)) {
    const from = idea.activityType === "lodging" ? "its check-in date" : "its departure date";
    return `
      <div class="calendar-sidebar-card outside auto">
        <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
        <div class="row-title">${escapeHtml(idea.title)}</div>
        <div class="outside-date">${outsidePlacementLabel(idea)} &middot; places itself from ${from}</div>
      </div>`;
  }
  return `
    <div class="calendar-sidebar-card outside"
         draggable="true"
         ondragstart="handleDragStart(event, '${idea.id}')"
         ondragend="handleDragEnd(event)">
      <span class="pill pill-activity">${activityTypeIconHtml(idea.activityType)}${escapeHtml(activityTypeLabel(idea.activityType))}</span>
      <div class="row-title">${escapeHtml(idea.title)}</div>
      <div class="outside-date">${outsidePlacementLabel(idea)}</div>
    </div>`;
}

// Returns an array of weeks (Sunday-Saturday) covering the trip's full
// date range, padded at both ends to a full week the same way a real
// month-view calendar does.
function calendarWeeksForTrip(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const weeks = [];
  let cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// "2026-10-12" -> local Date at midnight, without the UTC-shift bug you
// get from `new Date("2026-10-12")` in some timezones.
function parseLocalDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Given a scheduled item's start date + how many days it spans, returns
// the array of ISO day keys it covers. Only meaningful for All Day
// items (span there means calendar days) - a regular slot item's span
// means slots-within-one-day, so it never needs this.
function scheduledDateRange(startDateKey, spanDays) {
  const start = parseLocalDate(startDateKey);
  const days = [];
  for (let i = 0; i < spanDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(isoDateKey(d));
  }
  return days;
}

function calendarWeekBlockHtml(week, trip, scheduledIdeas, itineraryIdeas, gaps) {
  const tripStart = parseLocalDate(trip.startDate);
  const tripEnd = parseLocalDate(trip.endDate);
  const inTrip = (date) => date >= tripStart && date <= tripEnd;

  // Every cell below gets an EXPLICIT grid-row/grid-column, not just the
  // placed items further down. This isn't optional styling - as soon as
  // one grid child has an explicit position, CSS reserves that cell
  // first and then auto-places every other (position-less) child around
  // it, which silently shifts the whole rest of the grid sideways. That
  // caused a real bug: dropping one card onto the calendar pushed every
  // cell after it in the document by one column. Explicit positions for
  // every cell removes the auto-placement step entirely, so nothing can
  // shift regardless of how many placed items get layered in.
  const headerCells = week
    .map((date, i) => `
      <div class="cal-day-header${inTrip(date) ? "" : " outside-trip"}" style="grid-row:1; grid-column:${2 + i};">
        ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        <span class="dow">${date.toLocaleDateString(undefined, { weekday: "short" })}</span>
      </div>`)
    .join("");

  // Backdrop cells only, one per (slot, day) - these are the real drop
  // targets. Placed items are no longer nested inside them; see
  // calendarPlacedItemsHtml below for why.
  const backdropRows = CALENDAR_SLOTS
    .map((slot) => {
      const row = CALENDAR_SLOT_ROWS[slot.key];
      const cells = week
        .map((date, i) => {
          const col = 2 + i;
          if (!inTrip(date)) return `<div class="cal-cell outside-trip" style="grid-row:${row}; grid-column:${col};"></div>`;
          const dayKey = isoDateKey(date);
          // Lodging is deliberately not a drop target this pass - see
          // the note at the top of this section.
          const dropAttrs = slot.key === "lodging"
            ? ""
            : ` ondragover="handleCalendarDragOver(event)" ondragleave="handleCalendarDragLeave(event)" ondrop="handleCalendarDrop(event, '${trip.id}', '${dayKey}', '${slot.key}')"`;
          return `<div class="cal-cell" data-slot="${slot.key}" data-day="${dayKey}" style="grid-row:${row}; grid-column:${col};"${dropAttrs}></div>`;
        })
        .join("");
      return `<div class="cal-row-label" style="grid-row:${row}; grid-column:1;">${slot.label}</div>${cells}`;
    })
    .join("");

  const weekDayKeys = week.map(isoDateKey);
  const placedHtml = calendarPlacedItemsHtml(scheduledIdeas, weekDayKeys, trip, itineraryIdeas)
    + calendarNightTrackHtml(weekDayKeys, trip, gaps);

  return `
    <div class="cal-week-block">
      <div class="cal-grid">
        <div class="cal-corner" style="grid-row:1; grid-column:1;"></div>
        ${headerCells}
        ${backdropRows}
        ${placedHtml}
      </div>
    </div>
  `;
}

// Placed items are rendered as their OWN grid children (siblings of the
// backdrop cells above, appearing after them in the markup so they
// paint on top), each positioned with an explicit grid-row/grid-column
// rather than nested inside one specific .cal-cell - that's what lets a
// stretched item's box actually span multiple rows (a regular slot item
// extended across e.g. Morning+Midday) or multiple columns (an All Day
// item extended across several days). CSS grid items stretch to fill
// their assigned area by default, so this "just works" with no extra
// sizing rules.
function calendarPlacedItemsHtml(scheduledIdeas, weekDayKeys, trip, itineraryIdeas) {
  const parts = [];

  // Regular slot items: grouped by their exact (day, slot, span)
  // footprint, so more than one item landing in the identical spot
  // stacks inside one wrapper instead of overlapping - per the
  // multi-item-stacking decision (product-decisions.md, 2026-09-10).
  const bySlotFootprint = {};
  scheduledIdeas
    .filter((i) => REGULAR_SLOT_KEYS.includes(i.scheduled.slot) && weekDayKeys.includes(i.scheduled.date))
    .forEach((i) => {
      const span = i.scheduled.span || 1;
      const key = `${i.scheduled.date}|${i.scheduled.slot}|${span}`;
      (bySlotFootprint[key] = bySlotFootprint[key] || []).push(i);
    });

  Object.keys(bySlotFootprint).forEach((key) => {
    const [dayKey, slotKey, spanStr] = key.split("|");
    const span = parseInt(spanStr, 10);
    const col = 2 + weekDayKeys.indexOf(dayKey);
    const row = CALENDAR_SLOT_ROWS[slotKey];
    const items = bySlotFootprint[key];
    // LUV-7 Step 3: two (or more) DIFFERENT ideas sharing the exact
    // same footprint is the deliberate stacking case (never evicted -
    // see the multi-item-stacking decision above), but it's still
    // worth flagging visibly in case it's an accidental double-booking
    // rather than an intentional pairing. Ambient warning, not a
    // block - matches the confirmed collision-handling decision
    // (product-decisions.md, 2026-09-07).
    const hasConflict = items.length > 1;
    // This group sits on top of its backdrop .cal-cell (later in the
    // markup, same grid area), so it's what's actually under the
    // cursor once a cell holds anything - without its own drop
    // handlers here, a drop on an occupied cell fell through and did
    // nothing (no stacking, no eviction). Same target info as the
    // backdrop cell underneath it.
    parts.push(`
      <div class="cal-placed-group"
           style="grid-column:${col}; grid-row:${row} / span ${span};"
           ondragover="handleCalendarDragOver(event)"
           ondragleave="handleCalendarDragLeave(event)"
           ondrop="handleCalendarDrop(event, '${trip.id}', '${dayKey}', '${slotKey}')">
        ${items.map((idea) => calendarPlacedCardHtml(idea, trip, span, undefined, undefined, undefined, hasConflict)).join("")}
      </div>
    `);
  });

  // All Day items: each one's full date range gets clipped to whatever
  // part of it falls inside THIS week, so a bar spanning the week-1/
  // week-2 boundary draws as two connected segments, one per week -
  // matching a real month-view calendar and the confirmed mockup. The
  // live +/-/x controls only render on the chronologically-last
  // segment (the "growing edge").
  scheduledIdeas
    .filter((i) => i.scheduled.slot === "allday")
    .forEach((idea) => {
      const span = idea.scheduled.span || 1;
      const fullRange = scheduledDateRange(idea.scheduled.date, span);
      const segmentDays = fullRange.filter((d) => weekDayKeys.includes(d));
      if (!segmentDays.length) return;
      const col = 2 + weekDayKeys.indexOf(segmentDays[0]);
      const isFirstSegment = fullRange[0] === segmentDays[0];
      const isLastSegment = fullRange[fullRange.length - 1] === segmentDays[segmentDays.length - 1];
      // Same reasoning as the regular-slot groups above - a drop
      // anywhere on this bar targets the first day of THIS segment,
      // same as dropping on the backdrop cell there would.
      parts.push(`
        <div class="cal-placed-group allday-group"
             style="grid-column:${col} / span ${segmentDays.length}; grid-row:2;"
             ondragover="handleCalendarDragOver(event)"
             ondragleave="handleCalendarDragLeave(event)"
             ondrop="handleCalendarDrop(event, '${trip.id}', '${segmentDays[0]}', 'allday')">
          ${calendarPlacedCardHtml(idea, trip, span, isLastSegment, isFirstSegment)}
        </div>
      `);
    });

  // Lodging bars aren't drawn here: the bottom row has its own
  // half-day track - see calendarNightTrackHtml() below (LUV-29).

  // Cross-day Flight/Transport arrival echoes - derived, read-only
  // markers on the arrival day (see crossDayArrivalEchoes() and
  // product-decisions.md's "Phase 4, Step 2"). Deliberately grouped
  // separately from the real scheduled items above rather than merged
  // into bySlotFootprint - an echo never evicts or gets evicted, and
  // in the rare case its slot exactly coincides with a differently-
  // spanned real item, the two can visually overlap. Known, accepted
  // edge case - cheap to revisit once real trip data shows whether
  // it's actually a problem in practice.
  const echoesByFootprint = {};
  crossDayArrivalEchoes(itineraryIdeas)
    .filter((e) => weekDayKeys.includes(e.date))
    .forEach((e) => {
      const key = `${e.date}|${e.slot}`;
      (echoesByFootprint[key] = echoesByFootprint[key] || []).push(e.idea);
    });
  Object.keys(echoesByFootprint).forEach((key) => {
    const [dayKey, slotKey] = key.split("|");
    const col = 2 + weekDayKeys.indexOf(dayKey);
    const row = CALENDAR_SLOT_ROWS[slotKey];
    const ideas = echoesByFootprint[key];
    parts.push(`
      <div class="cal-placed-group echo-group" style="grid-column:${col}; grid-row:${row};">
        ${ideas.map((idea) => calendarArrivalEchoHtml(idea, trip)).join("")}
      </div>
    `);
  });

  return parts.join("");
}

// The bottom (Lodging) row, one week at a time (LUV-29).
//
// Each day in this row is split in half: the morning you wake up (left)
// and where you sleep tonight (right). A stay runs from the evening of
// its check-in day to the morning of its check-out day, so on a
// changeover day you see both the place you check out of and the place
// you sleep that night - Luvean's ask once she saw a full-day bar make
// a no-bed night look covered.
//
// Drawn as ONE child of the week's grid (row 7, spanning all seven day
// columns) holding its own inner grid of 14 half-day columns. With the
// same 6px gap as .cal-grid, two halves plus the gap between them come
// out exactly one day wide, so the halves line up with the days above.
// Every child of the inner grid gets an explicit grid-row/grid-column
// too, for the same reason the outer grid's children do (Hard-to-Change
// entry 8: mixing explicit and auto-placed children shifts things).
//
// The stored placement (scheduled.span, check-in through check-out
// day inclusive) is unchanged - this is purely how it's drawn.
function calendarNightTrackHtml(weekDayKeys, trip, gaps) {
  const weekFirst = weekDayKeys[0];
  const weekLast = weekDayKeys[weekDayKeys.length - 1];

  // Inner columns for something shaped like a stay: from the evening
  // of `start` to the morning of `end`, clipped to this week. Day d
  // (0 = Sunday) has its morning at column 2d+1 and its evening at
  // 2d+2. Returns null when none of it falls in this week.
  function placement(start, end) {
    if (end < weekFirst || start > weekLast) return null;
    const startsEarlier = start < weekFirst;
    const continues = end > weekLast;
    let from = startsEarlier ? 1 : 2 * weekDayKeys.indexOf(start) + 2;
    let to = continues ? 14 : 2 * weekDayKeys.indexOf(end) + 1;
    // Checking in and out on the same day means no night at all, which
    // would leave nothing to draw - give it that whole day instead.
    if (start === end) {
      from = 2 * weekDayKeys.indexOf(start) + 1;
      to = from + 1;
    }
    return { column: `${from} / ${to + 1}`, startsEarlier, continues };
  }

  const clipClasses = (p) => `${p.startsEarlier ? " stay-starts-earlier" : ""}${p.continues ? " stay-continues" : ""}`;
  const parts = [];

  gaps.stays.forEach((stay) => {
    const p = placement(stay.checkIn, stay.checkOut);
    if (!p) return;
    // The transport warning rides on the stay you're travelling TO,
    // on the segment where that stay begins.
    const gap = p.startsEarlier ? null : gaps.transport.find((g) => g.toIdeaId === stay.idea.id);
    const chips = (stay.overlaps.length ? overlapChipHtml(stay) : "") + (gap ? transportChipHtml(trip, gap) : "");
    parts.push(calendarLodgingBarHtml(stay, trip, p, clipClasses(p), chips));
  });

  gaps.lodgingRuns.forEach((run) => {
    const p = placement(run.start, run.end);
    if (!p) return;
    const nights = daysBetweenDates(run.start, run.end);
    const lastNightKey = scheduledDateRange(run.start, nights)[nights - 1];
    const when = nights === 1
      ? `the night of ${shortDateLabel(run.start)}`
      : `the nights of ${shortDateLabel(run.start)} to ${shortDateLabel(lastNightKey)}`;
    // Options in The Plan whose stay overlaps any night of this gap.
    const options = gaps.planLodging.filter((o) => o.checkInDate < run.end && o.checkOutDate > run.start);
    if (options.length) {
      const names = options.map((o) => o.title).join(", ");
      parts.push(`
        <div class="cal-gap-flag gap-pick${clipClasses(p)}" style="grid-row:1; grid-column:${p.column};"
             title="${escapeHtml(`No lodging chosen for ${when}. Options in The Plan: ${names}. Move one into The Itinerary.`)}">
          ${flagIconHtml("i-stop")}<span class="gap-lines"><span>Pick one</span><span class="gap-sub">${options.length} ${options.length === 1 ? "option" : "options"} in The Plan</span></span>
        </div>`);
      return;
    }
    parts.push(`
      <div class="cal-gap-flag${clipClasses(p)}" style="grid-row:1; grid-column:${p.column};"
           title="No lodging booked for ${when}. Add a Lodging card to fix it.">
        ${flagIconHtml("i-stop")}<span>No lodging</span>
      </div>`);
  });

  if (!parts.length) return "";
  return `
    <div class="cal-night-track" style="grid-row:${CALENDAR_SLOT_ROWS.lodging}; grid-column:2 / span 7;">
      ${parts.join("")}
    </div>`;
}

// "2027-07-09" -> "Jul 9", matching the calendar's own day headers.
function shortDateLabel(isoDate) {
  return parseLocalDate(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The red stop sign and amber warning icons are filled (unlike the
// line icons for activity types) so they read as signs at 14px.
function flagIconHtml(id) {
  return `<svg class="flag-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
}

// One stay's bar (or the part of it in this week). Not draggable - the
// Lodging row has always been placed automatically from the card's
// check-in/check-out dates - but clickable to open the same edit
// popover as every other placed card.
function calendarLodgingBarHtml(stay, trip, place, clipClasses, chipHtml) {
  const idea = stay.idea;
  const times = [];
  if (!place.startsEarlier && idea.checkInTime) times.push(`In ${formatTimeShort(idea.checkInTime)}`);
  if (!place.continues && idea.checkOutTime) times.push(`Out ${formatTimeShort(idea.checkOutTime)}`);
  return `
    <div class="cal-placed-card allday-bar lodging-bar${clipClasses}${stay.overlaps.length ? " has-overlap" : ""}"
         style="grid-row:${stay.lane}; grid-column:${place.column};"
         data-popover-anchor="${idea.id}"
         draggable="false"
         onclick="handleOpenCalendarPopover(event, '${trip.id}', '${idea.id}', '${idea.id}')">
      <div class="placed-top-row">
        <span class="placed-label"><span class="placed-title">${escapeHtml(idea.title)}</span></span>
      </div>
      ${times.length ? `<div class="placed-time-row">${times.join(" &middot; ")}</div>` : ""}
      ${chipHtml}
    </div>`;
}

// Red "Pick one" on a stay that shares a night with another stay in
// The Itinerary. Must be fixed, like "No lodging" - keep one and move
// the other out of The Itinerary - so it's not clickable or dismissible.
function overlapChipHtml(stay) {
  const others = stay.overlaps.map((o) => o.title).join(", ");
  return `
    <span class="overlap-chip" title="${escapeHtml(`Also booked for some of the same nights: ${others}. Keep one and move the other out of The Itinerary.`)}">
      ${flagIconHtml("i-stop")}<span>Pick one</span>
    </span>`;
}

// The amber transport warning, or - once marked sorted - a calm grey
// chip showing the note. A real <button> so it's reachable by keyboard;
// it sits inside the clickable stay bar, so its handler stops the click
// from also opening the stay's own popover.
function transportChipHtml(trip, gap) {
  const sorted = gap.sortedNote !== null;
  const label = sorted
    ? (gap.sortedNote || "Transport sorted")
    : `Transport: ${gap.fromRegion} → ${gap.toRegion}`;
  const title = sorted
    ? `${gap.fromRegion} to ${gap.toRegion}: sorted.${gap.sortedNote ? " " + gap.sortedNote : ""}`
    : `${gap.fromRegion} to ${gap.toRegion}: no dated Flight or Transport card yet. Click to mark it sorted or add one.`;
  return `
    <button type="button" class="transport-chip${sorted ? " sorted" : ""}"
            data-popover-anchor="transport-${gap.key}"
            title="${escapeHtml(title)}"
            onclick="handleOpenTransportGap(event, '${gap.key}')">
      ${sorted ? "&#10003;" : flagIconHtml("i-warn")}<span>${escapeHtml(label)}</span>
    </button>`;
}

// Shares the card popover's id (#cal-edit-popover) on purpose: only one
// is ever open, and that lets it reuse the same positioning and
// click-outside-to-close code.
function transportGapPopoverHtml(trip, gap) {
  const sorted = gap.sortedNote !== null;
  const hint = sorted
    ? "Marked as sorted. Everyone on this trip sees this note."
    : `No dated Flight or Transport card between ${escapeHtml(gap.fromRegion)} and ${escapeHtml(gap.toRegion)}. If it doesn't need booking (rental car, local train), mark it sorted. If it does, add a Transport card so the booking has somewhere to live.`;
  return `
    <div class="cal-edit-popover transport-popover" id="cal-edit-popover">
      <div class="cal-edit-popover-head">
        <span class="cal-edit-popover-title">
          ${flagIconHtml("i-warn")}
          ${escapeHtml(gap.fromRegion)} &rarr; ${escapeHtml(gap.toRegion)}
        </span>
        <button type="button" class="cal-edit-popover-close" title="Close" onclick="handleCloseCalendarPopover()">&times;</button>
      </div>
      <p class="popover-hint">${hint}</p>
      <label class="confirmation-info-field">
        <span>How are you getting there?</span>
        <textarea id="transport-gap-note" placeholder="e.g. rental car, train (no booking needed)">${escapeHtml(gap.sortedNote || "")}</textarea>
      </label>
      <div class="popover-actions">
        <button type="button" class="btn-primary" onclick="handleMarkTransportSorted('${trip.id}', '${gap.key}')">${sorted ? "Save note" : "Mark as sorted"}</button>
        ${sorted ? `<button type="button" class="btn-secondary" onclick="handleUnmarkTransportSorted('${trip.id}', '${gap.key}')">Flag it again</button>` : ""}
        <button type="button" class="btn-secondary" onclick="handleAddTransportCardForGap('${trip.id}', '${gap.key}')">+ Add a Transport card</button>
      </div>
    </div>`;
}

function handleOpenTransportGap(event, key) {
  event.stopPropagation();
  openTransportGapKey = key;
  openCalendarPopoverIdeaId = null;
  openCalendarPopoverAnchorKey = `transport-${key}`;
  renderTabContent(getActiveTrip());
}

function handleMarkTransportSorted(tripId, key) {
  const field = document.getElementById("transport-gap-note");
  setTransportGapNote(tripId, key, field ? field.value.trim() : "");
  handleCloseCalendarPopover();
}

function handleUnmarkTransportSorted(tripId, key) {
  clearTransportGapNote(tripId, key);
  handleCloseCalendarPopover();
}

// Creates a Transport card in The Plan (selected, not yet finalized),
// with from/to filled in from the two stays' regions and "needs a
// reservation" on - the reason to add one is that something needs
// booking. The warning stays until that card is moved into The
// Itinerary with a date, exactly like any other card.
function handleAddTransportCardForGap(tripId, key) {
  const [fromId, toId] = key.split("__");
  const ideas = getIdeas(tripId);
  const fromStay = ideas.find((i) => i.id === fromId);
  const toStay = ideas.find((i) => i.id === toId);
  if (!fromStay || !toStay) { handleCloseCalendarPopover(); return; }
  const from = fromStay.region.trim();
  const to = toStay.region.trim();
  addIdea(tripId, {
    title: `${from} → ${to}`,
    activityType: "transport",
    from,
    to,
    reservationNeeded: true,
    selected: true
  });
  handleCloseCalendarPopover();
  showToast(`Added "${from} → ${to}" to The Plan. The warning clears once it's in The Itinerary with a date.`);
}

// A short message at the bottom of the screen that fades by itself.
// Lives outside #app (which is redrawn wholesale) so a re-render can't
// wipe it mid-message.
let toastTimer = null;
function showToast(message) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 4000);
}

// isLastSegment defaults to true (the normal case: a regular slot
// item, or the only/last segment of a multi-day bar). An earlier
// week's segment of a bar that continues past the week boundary
// passes false explicitly, since the confirmed mockup keeps the live
// +/-/x controls on the chronologically-last segment only.
//
// interactive defaults to true. Lodging bars used to pass false; since
// LUV-29 they're drawn by calendarLodgingBarHtml() on their own
// half-day track instead, so no caller passes false today. The
// parameter stays so a future non-draggable card type can reuse it.
function calendarPlacedCardHtml(idea, trip, span, isLastSegment, isFirstSegment, interactive, hasConflict) {
  const slotKey = idea.scheduled.slot;
  const isMultiDayBar = slotKey === "allday" || slotKey === "lodging";
  const lastSegment = isLastSegment === undefined ? true : isLastSegment;
  const firstSegment = isFirstSegment === undefined ? true : isFirstSegment;
  const isInteractive = interactive === undefined ? true : interactive;
  const timeLabel = placedCardTimeLabel(idea, firstSegment, lastSegment);

  const controlsVisible = isInteractive && lastSegment;
  const canExtend = controlsVisible
    ? (slotKey === "allday" ? canExtendAllDay(idea, parseLocalDate(trip.endDate)) : canExtendSlot(idea))
    : false;
  const canShrink = controlsVisible && span > 1;

  const controls = controlsVisible
    ? `
      <div class="placed-controls">
        <button type="button" draggable="false" class="shrink-btn" title="Shrink" ${canShrink ? "" : "disabled"}
          onclick="event.stopPropagation(); handleShrinkScheduled('${trip.id}', '${idea.id}')">&minus;</button>
        <button type="button" draggable="false" class="extend-btn" title="Extend" ${canExtend ? "" : "disabled"}
          onclick="event.stopPropagation(); handleExtendScheduled('${trip.id}', '${idea.id}')">+</button>
        <button type="button" draggable="false" class="remove-btn" title="Remove from calendar"
          onclick="event.stopPropagation(); handleUnscheduleIdea('${trip.id}', '${idea.id}')">&times;</button>
      </div>
    `
    : isMultiDayBar && !lastSegment
      ? `<span class="allday-continues">&rarr;</span>`
      : "";

  const dragAttrs = isInteractive
    ? `draggable="true" ondragstart="handleDragStart(event, '${idea.id}')" ondragend="handleDragEnd(event)"`
    : `draggable="false"`;

  const conflictBadge = hasConflict
    ? `<span class="conflict-badge" title="Another item is scheduled in this same slot">&#9888;</span>`
    : "";

  return `
    <div class="cal-placed-card${isMultiDayBar ? " allday-bar" : ""}${slotKey === "lodging" ? " lodging-bar" : ""}${hasConflict ? " has-conflict" : ""}"
         data-popover-anchor="${idea.id}"
         ${dragAttrs}
         onclick="handleOpenCalendarPopover(event, '${trip.id}', '${idea.id}', '${idea.id}')">
      <div class="placed-top-row">
        <span class="placed-label">
          ${activityTypeIconHtml(idea.activityType)}
          <span class="placed-title">${escapeHtml(idea.title)}</span>
          ${conflictBadge}
        </span>
        ${controls}
      </div>
      ${timeLabel ? `<div class="placed-time-row">${escapeHtml(formatTimeShort(timeLabel))}</div>` : ""}
    </div>
  `;
}

// A cross-day flight/transport's derived arrival echo (see
// crossDayArrivalEchoes above) - deliberately its own, much simpler
// render function rather than another branch of calendarPlacedCardHtml
// above, since it shares almost nothing with a real placed card: no
// scheduled.slot/span to read (it's not stored), no controls, no
// drag. Still clickable to open the same idea's popover - the anchor
// key is idea.id + "-echo" (see openCalendarPopoverAnchorKey above) so
// positioning finds THIS element specifically, not the departure
// card's, even though both share the same idea.id.
function calendarArrivalEchoHtml(idea, trip) {
  const anchorKey = `${idea.id}-echo`;
  return `
    <div class="cal-placed-card cal-arrival-echo" data-popover-anchor="${anchorKey}"
         onclick="handleOpenCalendarPopover(event, '${trip.id}', '${idea.id}', '${anchorKey}')">
      <div class="placed-top-row">
        <span class="placed-label">
          ${activityTypeIconHtml(idea.activityType)}
          <span class="placed-title">Arrives: ${escapeHtml(idea.title)}</span>
        </span>
      </div>
      <div class="placed-time-row">${escapeHtml(formatTimeShort(idea.arrivalTime))}</div>
    </div>
  `;
}

// "HH:MM" (24hr, from <input type="time">) -> a short 12-hour label like
// "9:30am". Falls back to the raw value if it doesn't parse (shouldn't
// happen from a real time input, but keeps a bad/legacy value visible
// rather than silently disappearing).
function formatTimeShort(timeStr) {
  if (!timeStr) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(timeStr);
  if (!match) return timeStr;
  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const suffix = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute}${suffix}`;
}

// Which time (if any) a placed card shows - see product-decisions.md's
// "Placed-card tag display + time label" (2026-09-11). Time is scoped
// to hard commitments only, since the slot row itself already conveys
// rough time-of-day for everything else:
//   - Flight/Transport: departureTime. (Only one point in time is ever
//     placed on the calendar for these today - a separate
//     arrival-day placement is Phase 4 auto-scheduling territory.)
//   - Lodging: not handled here - stay bars are drawn by
//     calendarLodgingBarHtml(), which shows "In <checkInTime>" and
//     "Out <checkOutTime>" on the segments where the stay starts and
//     ends (LUV-29).
//   - Anything else: reservationTime, only if a reservation is
//     actually needed AND a time was actually given (always optional -
//     see the decision above).
function placedCardTimeLabel(idea, isFirstSegment, isLastSegment) {
  if (idea.activityType === "flight" || idea.activityType === "transport") {
    return idea.departureTime || "";
  }
  if (idea.reservationNeeded && idea.reservationTime) return idea.reservationTime;
  return "";
}

function canExtendSlot(idea) {
  const rowIndex = REGULAR_SLOT_KEYS.indexOf(idea.scheduled.slot);
  const span = idea.scheduled.span || 1;
  return rowIndex !== -1 && rowIndex + span < REGULAR_SLOT_KEYS.length;
}

function canExtendAllDay(idea, tripEndDate) {
  const span = idea.scheduled.span || 1;
  const range = scheduledDateRange(idea.scheduled.date, span + 1);
  return parseLocalDate(range[range.length - 1]) <= tripEndDate;
}

// Rows (indices into REGULAR_SLOT_KEYS) a regular-slot-scheduled idea
// currently covers. Empty for anything not on a regular slot (All Day,
// Lodging, or unscheduled).
function regularSlotRowsCovered(idea) {
  if (!idea.scheduled.date || !REGULAR_SLOT_KEYS.includes(idea.scheduled.slot)) return [];
  const start = REGULAR_SLOT_KEYS.indexOf(idea.scheduled.slot);
  const span = idea.scheduled.span || 1;
  const rows = [];
  for (let i = 0; i < span; i++) rows.push(start + i);
  return rows;
}

// Two footprints "collide" if they share at least one row but aren't
// identical. An identical footprint (same date, same start slot, same
// span) is the deliberate two-activities-share-one-block stacking case
// (see the multi-item stacking decision, product-decisions.md,
// 2026-09-10) and must never be evicted - only a genuine partial
// overlap should be.
function rowsOverlapButDiffer(rowsA, rowsB) {
  if (!rowsA.length || !rowsB.length) return false;
  const sameSet = rowsA.length === rowsB.length && rowsA.every((r) => rowsB.includes(r));
  if (sameSet) return false;
  return rowsA.some((r) => rowsB.includes(r));
}

// Finds every OTHER regular-slot idea on the same date whose footprint
// overlaps (but doesn't exactly match) the given rows, and unschedules
// each one - back to the Itinerary Building Blocks sidebar, rather
// than leaving it sitting invisibly underneath whatever now covers its
// slot. See the 2026-09-12 "evict on overlap" decision (product-
// decisions.md) - this replaced silently hiding one card behind the
// other, which is what extending into an occupied neighbor used to do.
function evictOverlappingRegularSlotIdeas(tripId, exceptIdeaId, dateKey, rows) {
  getIdeas(tripId).forEach((other) => {
    if (other.id === exceptIdeaId) return;
    if (other.scheduled.date !== dateKey) return;
    const otherRows = regularSlotRowsCovered(other);
    if (rowsOverlapButDiffer(rows, otherRows)) {
      unscheduleIdea(tripId, other.id);
    }
  });
}

// Same idea, for All Day items - "rows" become calendar days instead
// of slot rows.
function evictOverlappingAllDayIdeas(tripId, exceptIdeaId, days) {
  getIdeas(tripId).forEach((other) => {
    if (other.id === exceptIdeaId) return;
    if (other.scheduled.slot !== "allday" || !other.scheduled.date) return;
    const otherDays = scheduledDateRange(other.scheduled.date, other.scheduled.span || 1);
    const sameSet = days.length === otherDays.length && days.every((d) => otherDays.includes(d));
    if (sameSet) return;
    if (days.some((d) => otherDays.includes(d))) {
      unscheduleIdea(tripId, other.id);
    }
  });
}

/* ---- Calendar drag-and-drop + extend/shrink handlers ---- */
// Reuses the same draggedIdeaId / handleDragStart / handleDragEnd
// already defined above for the kanban board - the Ideas and Itinerary
// tabs are never both on screen at once, so there's no risk of the two
// drag systems colliding, and it's one less thing to keep in sync.

function handleCalendarDragOver(event) {
  if (!draggedIdeaId) return;
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
}

function handleCalendarDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleCalendarDrop(event, tripId, dayKey, slotKey) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  if (!draggedIdeaId) return;

  const idea = getIdeas(tripId).find((i) => i.id === draggedIdeaId);
  if (!idea) return;

  const wasPlaced = !!idea.scheduled.date;
  const wasAllDay = idea.scheduled.slot === "allday";
  const droppingOnAllDay = slotKey === "allday";

  // An already-placed All Day bar can only move to another All Day
  // cell - dropping it onto a single slot doesn't mean anything and is
  // ignored outright, matching the confirmed mockup.
  if (wasPlaced && wasAllDay && !droppingOnAllDay) return;

  let span = 1;
  if (wasPlaced && wasAllDay && droppingOnAllDay) {
    // Moving an existing All Day bar to a new start day keeps its
    // length, as long as the trip has enough days left from that point
    // - otherwise this is a silent no-op. (Auto-shrink-to-fit instead
    // of no-op is still an open question - see product-decisions.md.)
    const trip = getActiveTrip();
    const existingSpan = idea.scheduled.span || 1;
    const range = scheduledDateRange(dayKey, existingSpan);
    if (parseLocalDate(range[range.length - 1]) > parseLocalDate(trip.endDate)) return;
    span = existingSpan;
  }
  // Any other case - a fresh sidebar card, a regular-slot placed card
  // being moved to a new slot/day, or a placed card being moved onto
  // All Day - always starts fresh at span 1. Re-extend afterward if
  // needed, matching the confirmed mockup.

  // Landing on a slot that's already (partly) covered by a DIFFERENT
  // idea evicts that idea back to the sidebar, unless its footprint is
  // an exact match (two activities sharing one block on purpose). See
  // the 2026-09-12 "evict on overlap" decision.
  if (droppingOnAllDay) {
    evictOverlappingAllDayIdeas(tripId, draggedIdeaId, scheduledDateRange(dayKey, span));
  } else {
    evictOverlappingRegularSlotIdeas(tripId, draggedIdeaId, dayKey, [REGULAR_SLOT_KEYS.indexOf(slotKey)]);
  }

  scheduleIdea(tripId, draggedIdeaId, { date: dayKey, slot: slotKey, span });
  renderTabContent(getActiveTrip());
}

function handleSidebarDragOver(event) {
  if (!draggedIdeaId) return;
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
}

function handleSidebarDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleSidebarDrop(event, tripId) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  if (!draggedIdeaId) return;
  unscheduleIdea(tripId, draggedIdeaId);
  renderTabContent(getActiveTrip());
}

function handleExtendScheduled(tripId, ideaId) {
  const idea = getIdeas(tripId).find((i) => i.id === ideaId);
  const trip = getActiveTrip();
  if (!idea || !trip || !idea.scheduled.date) return;
  const span = idea.scheduled.span || 1;

  if (idea.scheduled.slot === "allday") {
    if (!canExtendAllDay(idea, parseLocalDate(trip.endDate))) return;
    const newDays = scheduledDateRange(idea.scheduled.date, span + 1);
    evictOverlappingAllDayIdeas(tripId, ideaId, newDays);
    scheduleIdea(tripId, ideaId, { date: idea.scheduled.date, slot: "allday", span: span + 1 });
  } else {
    if (!canExtendSlot(idea)) return;
    const startRow = REGULAR_SLOT_KEYS.indexOf(idea.scheduled.slot);
    const newRows = [];
    for (let i = 0; i < span + 1; i++) newRows.push(startRow + i);
    evictOverlappingRegularSlotIdeas(tripId, ideaId, idea.scheduled.date, newRows);
    scheduleIdea(tripId, ideaId, { date: idea.scheduled.date, slot: idea.scheduled.slot, span: span + 1 });
  }
  renderTabContent(getActiveTrip());
}

function handleShrinkScheduled(tripId, ideaId) {
  const idea = getIdeas(tripId).find((i) => i.id === ideaId);
  if (!idea || !idea.scheduled.date) return;
  const span = idea.scheduled.span || 1;
  if (span <= 1) return;
  scheduleIdea(tripId, ideaId, { date: idea.scheduled.date, slot: idea.scheduled.slot, span: span - 1 });
  renderTabContent(getActiveTrip());
}

function handleUnscheduleIdea(tripId, ideaId) {
  unscheduleIdea(tripId, ideaId);
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

// Clicking anywhere outside an open calendar popover closes it.
// Clicks on the card that opened it already stopPropagation()'d
// before this can fire. Clicks INSIDE the popover itself (typing into
// a field, clicking a label) must NOT close it - only the explicit
// close button, or a genuine click elsewhere, should.
document.addEventListener("click", (event) => {
  if (!isCalendarPopoverOpen()) return;
  if (event.target.closest("#cal-edit-popover")) return;
  handleCloseCalendarPopover();
});

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
