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
    notes: {}                // { [tripId]: [ {id, title, body} ] }  <- confirmations, doc numbers, etc.
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
    return { ...emptyState(), ...parsed };
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
