/*
  storage.js
  ----------
  This file is the ONLY place in the app that talks to localStorage.

  Why keep it in one place?
  Because localStorage only stores strings. Every time we save data we have
  to convert our JavaScript objects into a string with JSON.stringify(),
  and every time we read data back we have to convert it back into objects
  with JSON.parse(). If that conversion logic were scattered across every
  file, a typo in one spot could silently corrupt your trip data. Keeping
  it in one module means the rest of the app never touches JSON.stringify
  or localStorage directly - it just calls functions like getTrips() or
  addPackingItem() and trusts this file to handle the details.

  Everything here is "offline-first" by definition: localStorage lives on
  the phone itself, so none of this needs a network connection.
*/

const STORAGE_KEY = "groundworkData";

// This is the "shape" of a brand new, empty database. If nothing has been
// saved yet, this is what we start from.
function emptyState() {
  return {
    trips: [],          // [{ id, name, destination, startDate, endDate }]
    activeTripId: null,  // which trip is currently selected in the UI
    itinerary: {},       // { [tripId]: [ {id, date, time, type, title, details} ] }
    packing: {},          // { [tripId]: [ {id, text, checked, category} ] }
    budget: {},            // { [tripId]: [ {id, description, amount, currency, category, date} ] }
    notes: {},               // { [tripId]: [ {id, title, body} ] }  <- confirmations, doc numbers, etc.
    ideas: {}                // { [tripId]: [ <idea card - see the Ideas section below> ] }  <- ideation board
  };
}

// Reads the whole database out of localStorage.
// If nothing is there yet (first time opening the app), returns emptyState().
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw);
    // Merge with emptyState() so that if we add new fields in a future
    // version of the app, old saved data doesn't break anything.
    const state = { ...emptyState(), ...parsed };
    // Bring any ideas saved under an older field shape up to date (see
    // migrateIdeasInState below), and persist the result so this only
    // has to run once per trip's data.
    if (migrateIdeasInState(state)) saveState(state);
    return state;
  } catch (err) {
    console.error("Saved trip data was corrupted, starting fresh.", err);
    return emptyState();
  }
}

// Writes the whole database back to localStorage.
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// A tiny helper for generating unique-enough IDs without any library.
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------- Trips ---------------------------- */

function getTrips() {
  return loadState().trips;
}

function getActiveTrip() {
  const state = loadState();
  return state.trips.find((t) => t.id === state.activeTripId) || null;
}

function setActiveTrip(tripId) {
  const state = loadState();
  state.activeTripId = tripId;
  saveState(state);
}

function createTrip({ name, destination, startDate, endDate }) {
  const state = loadState();
  const trip = { id: makeId(), name, destination, startDate, endDate };
  state.trips.push(trip);
  state.activeTripId = trip.id;
  // Set up empty lists for this trip in every category.
  state.itinerary[trip.id] = [];
  state.packing[trip.id] = [];
  state.budget[trip.id] = [];
  state.notes[trip.id] = [];
  state.ideas[trip.id] = [];
  saveState(state);
  return trip;
}

function deleteTrip(tripId) {
  const state = loadState();
  state.trips = state.trips.filter((t) => t.id !== tripId);
  delete state.itinerary[tripId];
  delete state.packing[tripId];
  delete state.budget[tripId];
  delete state.notes[tripId];
  delete state.ideas[tripId];
  if (state.activeTripId === tripId) {
    state.activeTripId = state.trips.length ? state.trips[0].id : null;
  }
  saveState(state);
}

/* -------------------------- Itinerary --------------------------- */

function getItinerary(tripId) {
  const state = loadState();
  const items = state.itinerary[tripId] || [];
  // Keep the list sorted by date then time so the itinerary always reads
  // top-to-bottom in chronological order, no matter the entry order.
  return [...items].sort((a, b) => {
    const aKey = `${a.date || ""} ${a.time || ""}`;
    const bKey = `${b.date || ""} ${b.time || ""}`;
    return aKey.localeCompare(bKey);
  });
}

function addItineraryItem(tripId, item) {
  const state = loadState();
  if (!state.itinerary[tripId]) state.itinerary[tripId] = [];
  state.itinerary[tripId].push({ id: makeId(), ...item });
  saveState(state);
}

function deleteItineraryItem(tripId, itemId) {
  const state = loadState();
  state.itinerary[tripId] = (state.itinerary[tripId] || []).filter(
    (i) => i.id !== itemId
  );
  saveState(state);
}

/* --------------------------- Packing ----------------------------- */

function getPackingItems(tripId) {
  const state = loadState();
  return state.packing[tripId] || [];
}

function addPackingItem(tripId, text, category) {
  const state = loadState();
  if (!state.packing[tripId]) state.packing[tripId] = [];
  state.packing[tripId].push({
    id: makeId(),
    text,
    category: category || "General",
    checked: false
  });
  saveState(state);
}

function togglePackingItem(tripId, itemId) {
  const state = loadState();
  const item = (state.packing[tripId] || []).find((i) => i.id === itemId);
  if (item) item.checked = !item.checked;
  saveState(state);
}

function deletePackingItem(tripId, itemId) {
  const state = loadState();
  state.packing[tripId] = (state.packing[tripId] || []).filter(
    (i) => i.id !== itemId
  );
  saveState(state);
}

/* ---------------------------- Budget ------------------------------ */

function getBudgetItems(tripId) {
  const state = loadState();
  return state.budget[tripId] || [];
}

function addBudgetItem(tripId, entry) {
  const state = loadState();
  if (!state.budget[tripId]) state.budget[tripId] = [];
  state.budget[tripId].push({ id: makeId(), ...entry });
  saveState(state);
}

function deleteBudgetItem(tripId, itemId) {
  const state = loadState();
  state.budget[tripId] = (state.budget[tripId] || []).filter(
    (i) => i.id !== itemId
  );
  saveState(state);
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
  state.notes[tripId].push({ id: makeId(), ...note });
  saveState(state);
}

function deleteNote(tripId, noteId) {
  const state = loadState();
  state.notes[tripId] = (state.notes[tripId] || []).filter(
    (n) => n.id !== noteId
  );
  saveState(state);
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
    // Lodging uses a date range instead of a single date/time.
    checkInDate: input.checkInDate || "",
    checkOutDate: input.checkOutDate || "",
    // Where this card sits on the Building-mode calendar, once it has a
    // spot there - either because it auto-placed itself (a confirmed
    // departure or check-in date) or because it was manually dragged into
    // a slot. slot is one of morning/midday/afternoon/evening/allday/
    // lodging. Both stay null until the card is actually placed.
    scheduled: {
      date: (input.scheduled && input.scheduled.date) || null,
      slot: (input.scheduled && input.scheduled.slot) || null
    },
    selected: input.selected || false,
    // A brand new idea always starts outside The Itinerary, even if
    // it's already reserved (the Milan case) - moving it into The
    // Itinerary is still a deliberate drag/click, same as selecting it
    // into The Plan at all.
    finalized: false,
    location: {
      placeName: rawLocation.placeName || "",
      lat: null,
      lng: null,
      geocodeStatus: "pending"
    },
    createdAt: new Date().toISOString()
  };

  state.ideas[tripId].push(idea);
  saveState(state);
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
  if (idea) Object.assign(idea, updates);
  saveState(state);
}

// Dedicated setter for the location sub-object. Pass only what changed,
// e.g. setIdeaLocation(tripId, id, { lat: -33.9, lng: 18.4, geocodeStatus: "success" })
// after a Nominatim lookup succeeds, without touching placeName.
function setIdeaLocation(tripId, ideaId, locationUpdates) {
  const state = loadState();
  const idea = (state.ideas[tripId] || []).find((i) => i.id === ideaId);
  if (idea) idea.location = { ...idea.location, ...locationUpdates };
  saveState(state);
}

function deleteIdea(tripId, ideaId) {
  const state = loadState();
  state.ideas[tripId] = (state.ideas[tripId] || []).filter(
    (i) => i.id !== ideaId
  );
  saveState(state);
}

// One-time migration: earlier versions of this app stored a single
// "bookingStatus" field (not_required / needed / booked) on each idea
// instead of the current reservationNeeded/reserved/finalized fields.
// This converts any idea it finds in the old shape the first time it's
// loaded, so existing trip data doesn't just disappear when the fields
// change underneath it. Called automatically from loadState() - nothing
// else needs to call this directly.
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
          scheduled: { date: null, slot: null }
        };
      }

      return migrated;
    });
  });
  return changed;
}
