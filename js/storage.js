/*
  storage.js
  ----------
  This file is the ONLY place the rest of the app goes for trip data.
  app.js calls functions like getTrips() or addPackingItem() and trusts
  this file to handle the details.

  Where the data lives (changed in LUV-41, 2026-11):
  Trips used to be one JSON blob in this browser's localStorage, which
  meant a trip planned on the laptop never reached the phone, and Dave
  could never see it. Now trips live in Firestore, a shared database,
  and each device keeps its own offline copy of them. That's what lets
  Luvean and Dave both edit the same trip, with or without signal.

  How this file fits in:
  - It keeps an IN-MEMORY copy of every trip the signed-in person can
    see (the `synced` object below). Every get...() function reads from
    it, so reads are instant, exactly as they were with localStorage.
  - Every change updates that copy first (so the screen changes right
    away), then hands just the changed document to sync.js to save.
  - sync.js listens to Firestore and calls applyRemoteTrips() /
    applyRemoteList() below whenever data changes, here or on another
    device, which refreshes the in-memory copy.

  sync.js is the only file that talks to Firestore, and this file is
  its only caller. It's separate only because Firebase's SDK comes as
  JavaScript modules and this is a plain script.

  What's still in localStorage: one small per-device setting (which
  trip is open), under DEVICE_KEY. It deliberately doesn't sync - your
  phone and laptop can have different trips open. The old trip blob
  under "groundworkData" is left where it is and no longer read (no real
  trips were ever stored there, so nothing is migrated).
*/

const DEVICE_KEY = "setoutDevice";

// The shape of the in-memory copy. Same shape the app always used, so
// app.js doesn't need to know anything changed.
function emptyState() {
  return {
    trips: [],          // [{ id, name, destination, startDate, endDate, memberEmails, createdBy, schemaVersion }]
    activeTripId: null,  // which trip is open on THIS device (from DEVICE_KEY, not synced)
    packing: {},          // { [tripId]: [ {id, text, checked, category} ] }
    budget: {},            // { [tripId]: [ {id, description, amount, currency, category, date} ] }
    notes: {},               // { [tripId]: [ {id, title, body} ] }  <- confirmations, doc numbers, etc.
    ideas: {}                // { [tripId]: [ <idea card - see the Ideas section below> ] }  <- ideation board
  };
}

let synced = emptyState();
// Who's signed in, as { uid, email } - set by sync.js. New trips are
// created with this person as their first member.
let syncUser = null;
let syncReady = false;

function loadDeviceSettings() {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
  } catch (err) {
    return {};
  }
}

function saveDeviceSettings(settings) {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(settings));
}

// Kept as the name the rest of this file always used: "give me the
// current data". It's now the in-memory copy rather than a fresh read
// from localStorage.
function loadState() {
  return synced;
}

// A tiny helper for generating unique-enough IDs without any library.
// IDs start with the current time, so sorting by ID keeps things in the
// order they were added - which is the order Firestore hands them back.
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Sends one change to sync.js. If sync.js isn't loaded (it always is
// once someone's signed in), the change still shows in memory; it just
// can't be saved, and says so.
function remote(method, ...args) {
  if (window.setoutSync) window.setoutSync[method](...args);
  else console.warn(`Not saved (sync isn't running): ${method}`);
}

/* ----------------------- Called by sync.js ----------------------- */

function setSyncUser(user) {
  syncUser = user;
}

// Fresh, signed-in start: an empty copy, with this device's open trip
// restored from its own settings.
function clearSyncedData() {
  synced = emptyState();
  synced.activeTripId = loadDeviceSettings().activeTripId || null;
  syncReady = false;
  syncUser = null;
}

function applyRemoteTrips(trips) {
  synced.trips = trips;
  const ids = new Set(trips.map((t) => t.id));
  // Drop the lists of any trip that's gone (deleted, or unshared).
  ["packing", "budget", "notes", "ideas"].forEach((list) => {
    Object.keys(synced[list]).forEach((tripId) => {
      if (!ids.has(tripId)) delete synced[list][tripId];
    });
  });
}

function applyRemoteList(tripId, list, docs) {
  if (list === "ideas") {
    // Run the same migrations as before on anything read in, as a
    // safety net, so a card saved by an older version of the app on
    // some other device still has every field the screens expect.
    const temp = { ideas: { [tripId]: docs } };
    migrateIdeasInState(temp);
    docs = temp.ideas[tripId];
  }
  synced[list][tripId] = docs;
}

function markSyncReady() {
  syncReady = true;
}

function isSyncReady() {
  return syncReady;
}

/* ---------------------------- Trips ---------------------------- */

function getTrips() {
  return loadState().trips;
}

function getActiveTrip() {
  const state = loadState();
  return state.trips.find((t) => t.id === state.activeTripId) || null;
}

// Which trip is open is a per-device choice, so it's saved on this
// device only, never synced.
function setActiveTrip(tripId) {
  synced.activeTripId = tripId;
  saveDeviceSettings({ ...loadDeviceSettings(), activeTripId: tripId });
}

function createTrip({ name, destination, startDate, endDate }) {
  const state = loadState();
  const trip = {
    id: makeId(),
    name,
    destination,
    startDate,
    endDate,
    // Who can see and edit this trip. The creator is the first member;
    // sharing adds more (LUV-42). The security rules check this list.
    memberEmails: syncUser ? [syncUser.email] : [],
    createdBy: syncUser ? syncUser.uid : null,
    // Lets a future version of the app tell which shape a trip was
    // saved in, if the shape ever has to change.
    schemaVersion: 1
  };
  state.trips.push(trip);
  // Set up empty lists for this trip in every category.
  state.packing[trip.id] = [];
  state.budget[trip.id] = [];
  state.notes[trip.id] = [];
  state.ideas[trip.id] = [];
  setActiveTrip(trip.id);
  remote("setTrip", trip.id, trip);
  return trip;
}

function deleteTrip(tripId) {
  const state = loadState();
  // Everything inside the trip has to be deleted along with it -
  // Firestore won't do that on its own (see sync.js).
  const children = [];
  ["packing", "budget", "notes", "ideas"].forEach((list) => {
    (state[list][tripId] || []).forEach((item) => children.push({ list, id: item.id }));
    delete state[list][tripId];
  });
  state.trips = state.trips.filter((t) => t.id !== tripId);
  if (state.activeTripId === tripId) {
    setActiveTrip(state.trips.length ? state.trips[0].id : null);
  }
  remote("deleteTrip", tripId, children);
}

/* --------------------------- Packing ----------------------------- */

function getPackingItems(tripId) {
  const state = loadState();
  return state.packing[tripId] || [];
}

function addPackingItem(tripId, text, category) {
  const state = loadState();
  if (!state.packing[tripId]) state.packing[tripId] = [];
  const item = {
    id: makeId(),
    text,
    category: category || "General",
    checked: false
  };
  state.packing[tripId].push(item);
  remote("setItem", tripId, "packing", item);
}

function togglePackingItem(tripId, itemId) {
  const state = loadState();
  const item = (state.packing[tripId] || []).find((i) => i.id === itemId);
  if (!item) return;
  item.checked = !item.checked;
  remote("updateItem", tripId, "packing", itemId, { checked: item.checked });
}

function deletePackingItem(tripId, itemId) {
  const state = loadState();
  state.packing[tripId] = (state.packing[tripId] || []).filter(
    (i) => i.id !== itemId
  );
  remote("deleteItem", tripId, "packing", itemId);
}

/* ---------------------------- Budget ------------------------------ */

function getBudgetItems(tripId) {
  const state = loadState();
  return state.budget[tripId] || [];
}

function addBudgetItem(tripId, entry) {
  const state = loadState();
  if (!state.budget[tripId]) state.budget[tripId] = [];
  const item = { id: makeId(), ...entry };
  state.budget[tripId].push(item);
  remote("setItem", tripId, "budget", item);
}

function deleteBudgetItem(tripId, itemId) {
  const state = loadState();
  state.budget[tripId] = (state.budget[tripId] || []).filter(
    (i) => i.id !== itemId
  );
  remote("deleteItem", tripId, "budget", itemId);
}

/* ----------------------------- Notes ------------------------------- */
// "Notes" is where confirmation numbers, passport/visa reminders, and
// other free-text info live in phase 1 (no file/photo attachments yet).

function getNotes(tripId) {
  const state = loadState();
  return state.notes[tripId] || [];
}

function addNote(tripId, note) {
  const state = loadState();
  if (!state.notes[tripId]) state.notes[tripId] = [];
  const item = { id: makeId(), ...note };
  state.notes[tripId].push(item);
  remote("setItem", tripId, "notes", item);
}

function deleteNote(tripId, noteId) {
  const state = loadState();
  state.notes[tripId] = (state.notes[tripId] || []).filter(
    (n) => n.id !== noteId
  );
  remote("deleteItem", tripId, "notes", noteId);
}

/* ---------------------------- Ideas ------------------------------- */
// The ideation board: candidate things to do, before they're scheduled
// into the real itinerary. Card shape is finalized in
// product-decisions.md - keep this in sync with that doc if it changes.
//
// A card's column on the kanban board (The Ideas / The Plan / The
// Itinerary) is never stored directly - it's always worked out from
// `selected` and `finalized` (see columnKeyForIdea() in app.js), the
// same way currentTab/ideaFilters in app.js are kept out of storage
// because they're just a way of LOOKING at data, not the data itself.

// activityType and style are both fixed lists (per product-decisions.md).
// Defined once here, as { value, label } pairs, so app.js can build
// <select> options and render pill labels from the same source instead
// of typing the label strings out twice and letting them drift apart.
const ACTIVITY_TYPES = [
  { value: "land", label: "Land Activities" },
  { value: "water", label: "Water & Diving" },
  { value: "historical", label: "Historical & Cultural" },
  { value: "food", label: "Food & Wine" },
  { value: "exploring", label: "Exploring & Sightseeing" },
  { value: "flight", label: "Flight" },
  { value: "lodging", label: "Lodging" },
  { value: "transport", label: "Transport (train, car, ferry, etc.)" },
  { value: "other", label: "Other" }
];

const IDEA_STYLES = [
  { value: "guided", label: "Guided" },
  { value: "self_guided", label: "Self-guided" },
  { value: "official_route", label: "Official route" },
  { value: "casual", label: "Casual" },
  { value: "none", label: "None/not applicable" }
];

function getIdeas(tripId) {
  const state = loadState();
  return state.ideas[tripId] || [];
}

// `input` carries whatever the user typed into the add-idea form -
// title, description, link, region, activityType, style, location's
// placeName, and optionally urgent/urgencyNotes/reservationNeeded/
// reserved/confirmationInfo (a card can start out already urgent or
// already reserved - see the Milan "Last Supper" case in
// product-decisions.md). Anything not passed in falls back to a
// sensible default here (not urgent, no reservation needed, not yet
// selected, geocode still pending), so app.js never has to remember to
// set every field by hand every time it adds a card.
//
// `urgent` and `reserved` are only meaningful when a reservation is
// actually needed at all, so both are forced back to false here if
// `reservationNeeded` is false - even if the form somehow sent true for
// either. That keeps "urgent with no reservation needed" and "reserved
// with no reservation needed" from ever existing as real states.
function addIdea(tripId, input) {
  const state = loadState();
  if (!state.ideas[tripId]) state.ideas[tripId] = [];

  const rawLocation = input.location || {};
  const reservationNeeded = input.reservationNeeded || false;

  const idea = {
    id: makeId(),
    title: input.title || "",
    description: input.description || "",
    link: input.link || "",
    region: input.region || "",
    activityType: input.activityType || "other",
    style: input.style || "none",
    urgent: reservationNeeded ? (input.urgent || false) : false,
    urgencyNotes: input.urgencyNotes || "",
    reservationNeeded,
    reserved: reservationNeeded ? (input.reserved || false) : false,
    // Free-text place to paste a confirmation #, phone number, pickup
    // instructions, etc. - so it's easy to find while traveling instead
    // of hunting through email folders. See product-decisions.md.
    confirmationInfo: input.confirmationInfo || "",
    // Type-specific logistics fields. Only meaningful when activityType is
    // "flight", "transport", or "lodging" - left as empty strings for
    // every other type. Flight/transport use a separate date+time for
    // departure and arrival; a real departure date/time is what makes a
    // flight card eligible for auto-scheduling onto the calendar (see
    // product-decisions.md).
    from: input.from || "",
    to: input.to || "",
    departureDate: input.departureDate || "",
    departureTime: input.departureTime || "",
    arrivalDate: input.arrivalDate || "",
    arrivalTime: input.arrivalTime || "",
    // Lodging uses a date range instead of a single date/time. checkInTime/
    // checkOutTime are separate, optional time-of-day fields (added Phase 3
    // close-out, 2026-09-11) - a placed lodging bar shows checkInTime on the
    // day it starts and checkOutTime on the day it ends. See
    // product-decisions.md "Placed-card tag display + time label".
    checkInDate: input.checkInDate || "",
    checkOutDate: input.checkOutDate || "",
    checkInTime: input.checkInTime || "",
    checkOutTime: input.checkOutTime || "",
    // Optional time for a reservation-needed item of ANY activityType (a
    // dinner reservation, a timed museum-tour slot, etc.) - independent of
    // the flight/transport/lodging logistics fields above. Deliberately
    // always optional, even when reservationNeeded is true: a reservation
    // can exist without a specific time attached (e.g. a same-day-any-time
    // booking). Added Phase 3 close-out, 2026-09-11.
    reservationTime: input.reservationTime || "",
    // Where this card sits on the Building-mode calendar, once it has a
    // spot there - either because it auto-placed itself (a confirmed
    // departure or check-in date) or because it was manually dragged into
    // a slot. slot is one of morning/midday/afternoon/evening/allday/
    // lodging. date/slot stay null until the card is actually placed.
    // span is how many contiguous slots (regular slot items) or days
    // (All Day items) it stretches across via the extend/shrink controls
    // - added Phase 3 Step 3 of the calendar port; always at least 1.
    scheduled: {
      date: (input.scheduled && input.scheduled.date) || null,
      slot: (input.scheduled && input.scheduled.slot) || null,
      span: (input.scheduled && input.scheduled.span) || 1
    },
    selected: input.selected || false,
    // A brand new idea always starts outside The Itinerary, even if
    // it's already reserved (the Milan case) - moving it into The
    // Itinerary is still a deliberate drag/click, same as selecting it
    // into The Plan at all.
    finalized: false,
    // placeName is shown as "Address or meeting point": the place you
    // physically go (the ferry pier, not the island), which is also what
    // the map geocodes and pins. The key keeps its original name because
    // renaming a saved field would need a migration (LUV-36).
    location: {
      placeName: rawLocation.placeName || "",
      lat: null,
      lng: null,
      geocodeStatus: "pending"
    },
    createdAt: new Date().toISOString()
  };

  state.ideas[tripId].push(idea);
  remote("setItem", tripId, "ideas", idea);
  return idea;
}

// General-purpose edit for everything on a card EXCEPT location - e.g.
// updateIdea(tripId, id, { reserved: true }) or
// updateIdea(tripId, id, { urgent: true, urgencyNotes: "Sells out fast" }).
//
// Why location is excluded: this does a shallow merge with
// Object.assign(idea, updates). That's fine for flat fields, but if you
// passed a partial location object through here - say
// { location: { placeName: "..." } } - it would REPLACE the whole
// location object and silently wipe out lat/lng that a geocode lookup
// already found. Use setIdeaLocation() below for anything touching
// location instead, so lat/lng/geocodeStatus/placeName can each be
// updated independently without clobbering the others.
function updateIdea(tripId, ideaId, updates) {
  const state = loadState();
  const idea = (state.ideas[tripId] || []).find((i) => i.id === ideaId);
  if (!idea) return;
  Object.assign(idea, updates);
  // Only the fields that changed are sent, so if Dave edits a different
  // field of the same card at the same time, neither edit is lost.
  remote("updateItem", tripId, "ideas", ideaId, updates);
}

// Dedicated setter for the location sub-object. Pass only what changed,
// e.g. setIdeaLocation(tripId, id, { lat: -33.9, lng: 18.4, geocodeStatus: "success" })
// after a Nominatim lookup succeeds, without touching placeName.
function setIdeaLocation(tripId, ideaId, locationUpdates) {
  const state = loadState();
  const idea = (state.ideas[tripId] || []).find((i) => i.id === ideaId);
  if (!idea) return;
  idea.location = { ...idea.location, ...locationUpdates };
  // Dotted paths ("location.lat") change just those parts of the saved
  // location, keeping the same "never wipe the rest" promise remotely.
  const fields = {};
  Object.keys(locationUpdates).forEach((key) => { fields[`location.${key}`] = locationUpdates[key]; });
  remote("updateItem", tripId, "ideas", ideaId, fields);
}

function deleteIdea(tripId, ideaId) {
  const state = loadState();
  state.ideas[tripId] = (state.ideas[tripId] || []).filter(
    (i) => i.id !== ideaId
  );
  remote("deleteItem", tripId, "ideas", ideaId);
}

// Dedicated setter for the scheduled sub-object - same reasoning as
// setIdeaLocation() above: always pass the full { date, slot, span }
// triple rather than a partial update through updateIdea(), so dragging
// a card to a brand new spot never accidentally keeps a stale span left
// over from wherever it was placed before.
function scheduleIdea(tripId, ideaId, { date, slot, span }) {
  const state = loadState();
  const idea = (state.ideas[tripId] || []).find((i) => i.id === ideaId);
  if (!idea) return;
  idea.scheduled = { date, slot, span: span || 1 };
  remote("updateItem", tripId, "ideas", ideaId, { scheduled: idea.scheduled });
}

// Drag a placed card back to the sidebar, or hit its remove (x) button
// - either way it goes back to being an unscheduled Itinerary Building
// Block, not off The Itinerary column entirely.
function unscheduleIdea(tripId, ideaId) {
  const state = loadState();
  const idea = (state.ideas[tripId] || []).find((i) => i.id === ideaId);
  if (!idea) return;
  idea.scheduled = { date: null, slot: null, span: 1 };
  remote("updateItem", tripId, "ideas", ideaId, { scheduled: idea.scheduled });
}

// One-time migration: earlier versions of this app stored a single
// "bookingStatus" field (not_required / needed / booked) on each idea
// instead of the current reservationNeeded/reserved/finalized fields.
// This converts any idea it finds in the old shape the first time it's
// loaded, so existing trip data doesn't just disappear when the fields
// change underneath it. Called automatically on every list of ideas
// read in from sync (applyRemoteList) - nothing else needs to call this
// directly.
function migrateIdeasInState(state) {
  let changed = false;
  Object.keys(state.ideas || {}).forEach((tripId) => {
    state.ideas[tripId] = (state.ideas[tripId] || []).map((idea) => {
      let migrated = idea;

      // Migration 1: earlier versions stored a single "bookingStatus" enum
      // (not_required / needed / booked) instead of the current
      // reservationNeeded/reserved/finalized fields.
      if (migrated.reservationNeeded === undefined) {
        changed = true;
        const reservationNeeded = !!migrated.bookingStatus && migrated.bookingStatus !== "not_required";
        const reserved = migrated.bookingStatus === "booked";
        migrated = {
          ...migrated,
          reservationNeeded,
          reserved,
          confirmationInfo: migrated.confirmationInfo || "",
          // Old "Booked" cards land in the new Itinerary column; old
          // "Decided" cards land in The Plan - matches how they already
          // looked before this migration ran.
          finalized: reserved,
          urgent: !!migrated.urgent && reservationNeeded
        };
        delete migrated.bookingStatus;
      }

      // Migration 2: cards saved before Flight/Lodging/Transport existed
      // don't have the logistics fields or the calendar `scheduled` slot
      // yet. Backfill them with empty/null defaults so older trips don't
      // break when the rest of the app starts expecting these fields.
      if (migrated.scheduled === undefined) {
        changed = true;
        migrated = {
          ...migrated,
          from: migrated.from || "",
          to: migrated.to || "",
          departureDate: migrated.departureDate || "",
          departureTime: migrated.departureTime || "",
          arrivalDate: migrated.arrivalDate || "",
          arrivalTime: migrated.arrivalTime || "",
          checkInDate: migrated.checkInDate || "",
          checkOutDate: migrated.checkOutDate || "",
          scheduled: { date: null, slot: null, span: 1 }
        };
      }

      // Migration 3: cards created after `scheduled` existed but before
      // it could hold a span (Phase 3 Step 2 vs. Step 3 of the calendar
      // port) have scheduled.date/slot with no scheduled.span - the
      // field that lets a placed item stretch across multiple slots or
      // days. Backfill span: 1 so an old single-slot placement doesn't
      // break once the extend/shrink UI starts reading it.
      if (migrated.scheduled && migrated.scheduled.span === undefined) {
        changed = true;
        migrated = {
          ...migrated,
          scheduled: { ...migrated.scheduled, span: 1 }
        };
      }

      // Migration 4: cards created before checkInTime/checkOutTime/
      // reservationTime existed (Phase 3 close-out, 2026-09-11) don't have
      // them. Backfill as empty strings, same pattern as Migration 2, so
      // older trips don't break once the placed-card time chip starts
      // reading these fields.
      if (migrated.reservationTime === undefined) {
        changed = true;
        migrated = {
          ...migrated,
          checkInTime: migrated.checkInTime || "",
          checkOutTime: migrated.checkOutTime || "",
          reservationTime: migrated.reservationTime || ""
        };
      }

      return migrated;
    });
  });
  return changed;
}
