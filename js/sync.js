/*
  sync.js - keeps trips in step between devices (LUV-41)
  -------------------------------------------------------
  storage.js is still the only file the rest of the app calls. This file
  is its helper: the only place that talks to Firestore, the shared
  database. It's a separate file only because Firebase's SDK comes as
  JavaScript modules and storage.js is a plain script.

  It does two jobs:

  1. LISTEN. Once someone signs in, it watches every trip whose
     memberEmails includes them, plus each of those trips' ideas,
     packing, budget and notes. Whenever any of that changes - on this
     device or another one - it hands the new data to storage.js's
     in-memory copy, and asks app.js to redraw if the change came from
     somewhere else.

  2. WRITE. storage.js updates its in-memory copy first (so the screen
     changes instantly), then calls window.setoutSync to save just the
     one document that changed.

  Offline: Firestore keeps its own copy of everything on the device (set
  up in firebase-init.js). With no signal, the listeners answer from
  that copy and writes queue up and send themselves when the signal
  comes back. Nothing in this file needs to know whether it's online.

  Document shape (see the Linear doc "SetOut - Sync Design"):
    trips/{tripId}                trip fields + memberEmails, createdBy, schemaVersion
    trips/{tripId}/{list}/{id}    one document per idea / packing item / budget entry / note
*/

import {
  collection, doc, query, where, onSnapshot,
  setDoc, updateDoc, deleteDoc, writeBatch, arrayUnion, arrayRemove,
  deleteField, waitForPendingWrites
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

const LISTS = ["ideas", "packing", "budget", "notes"];

let stopTripsListener = null;
// tripId -> the stop functions for that trip's four list listeners
const tripListeners = new Map();
// Has app.js been told the first full load is done? Until then nothing
// is drawn, so the app never flashes an empty "no trips" screen while
// the real trips are still loading.
let readyReported = false;

// Documents store everything except their own id (Firestore already
// knows it). These two helpers add it back on the way in and strip it
// on the way out, so storage.js can keep working with { id, ...fields }.
const withId = (snap) => ({ id: snap.id, ...snap.data() });
function withoutId(data) {
  const { id, ...rest } = data;
  return rest;
}

// A change "came from somewhere else" if any document in it has no
// unsent local edits. Firestore also reports our OWN edits back to us
// instantly (marked hasPendingWrites); those are already on screen, so
// redrawing for them would only waste work and could interrupt typing.
function isRemote(snapshot) {
  return snapshot.docChanges().some((change) => !change.doc.metadata.hasPendingWrites);
}

function reportReady() {
  if (readyReported) return;
  readyReported = true;
  handleSyncReady();
}

// Trips we're currently allowed to see (from the trips listener), and
// how many times each trip's list listeners have been retried.
let knownTripIds = new Set();
const retries = new Map();

// Starts the four list listeners for one trip. Resolves once each has
// delivered its first answer, which is what "fully loaded" means for
// the start-up gate.
function listenToTrip(tripId) {
  const stops = [];
  tripListeners.set(tripId, stops);
  return Promise.all(LISTS.map((list) => new Promise((resolve) => {
    stops.push(onSnapshot(collection(db, "trips", tripId, list), (snap) => {
      retries.delete(tripId);
      applyRemoteList(tripId, list, snap.docs.map(withId));
      if (readyReported && isRemote(snap)) handleRemoteChange();
      resolve();
    }, (err) => {
      // The rules refused this listener. Usually the trip was just
      // deleted or unshared, and the trips listener drops it. But it can
      // also be a timing blip, so if the trip is still ours, try again a
      // few times before giving up.
      console.warn(`Stopped syncing ${list} for trip ${tripId}:`, err.code || err);
      resolve();
      retryTrip(tripId);
    }));
  })));
}

function retryTrip(tripId) {
  if (!tripListeners.has(tripId)) return; // already stopped or retrying
  stopTrip(tripId);
  const attempt = (retries.get(tripId) || 0) + 1;
  if (attempt > 3) return;
  retries.set(tripId, attempt);
  setTimeout(() => {
    if (knownTripIds.has(tripId) && !tripListeners.has(tripId)) listenToTrip(tripId);
  }, 2000 * attempt);
}

function stopTrip(tripId) {
  (tripListeners.get(tripId) || []).forEach((stop) => stop());
  tripListeners.delete(tripId);
}

/* ---------------------- Sync status (LUV-43) ---------------------- */
// The small "Synced / Syncing... / Waiting to sync / Offline" label.
// Reviewed first as mockup/sync-status-mockup.html.
//
// "Are any of my changes still unsent?" comes from Firestore's
// waitForPendingWrites(): it settles once every change queued on this
// device has reached the server - including changes queued before the
// app was last closed, since Firestore keeps its queue on the device.
// Each new write asks again, and only the latest question counts.
//
// "Is there signal?" comes from the browser's online/offline events.
// Phones sometimes say they're online on wifi that goes nowhere, so a
// change that's been stuck for 10 seconds counts as waiting anyway.

const SHOW_SYNCING_AFTER_MS = 2000;  // shorter saves don't flicker the label
const TREAT_AS_WAITING_AFTER_MS = 10000;

let unsent = false;
let unsentSince = 0;
let pendingCheck = 0;  // which waitForPendingWrites() call is the latest
let statusTimers = [];

function currentStatus() {
  const online = navigator.onLine;
  if (!unsent) return online ? "synced" : "offline";
  if (!online) return "waiting";
  const waited = Date.now() - unsentSince;
  if (waited >= TREAT_AS_WAITING_AFTER_MS) return "waiting";
  if (waited >= SHOW_SYNCING_AFTER_MS) return "syncing";
  return "synced";
}

// Tells app.js the label to show, and separately whether anything is
// unsent at all (even under 2 seconds), which is what the sign-out
// check needs.
function reportStatus() {
  handleSyncStatus(currentStatus(), unsent);
}

// Re-reports at the 2- and 10-second marks, since the label changes
// with time even when nothing else happens.
function restartStatusTimers() {
  statusTimers.forEach(clearTimeout);
  statusTimers = [SHOW_SYNCING_AFTER_MS, TREAT_AS_WAITING_AFTER_MS]
    .map((ms) => setTimeout(reportStatus, ms + 50));
}

function checkPendingWrites() {
  const check = ++pendingCheck;
  if (!unsent) {
    unsent = true;
    unsentSince = Date.now();
    restartStatusTimers();
  }
  waitForPendingWrites(db).then(() => {
    if (check !== pendingCheck) return; // a newer write is still out
    unsent = false;
    statusTimers.forEach(clearTimeout);
    reportStatus();
  }).catch(() => {
    // Rejected because the signed-in person changed; startSync/stopSync
    // handle that.
  });
  reportStatus();
}

// Signal back: restart the clock, so the label says "Syncing..." while
// the queue sends rather than staying on "Waiting to sync".
window.addEventListener("online", () => {
  if (unsent) {
    unsentSince = Date.now();
    restartStatusTimers();
  }
  reportStatus();
});
window.addEventListener("offline", reportStatus);

function resetStatus() {
  pendingCheck++;
  unsent = false;
  statusTimers.forEach(clearTimeout);
}

export function startSync(user) {
  stopSync();
  setSyncUser(user);
  // Changes left unsent when the app was last closed are still queued.
  // This finds out, and settles straight away if there are none.
  checkPendingWrites();

  const myTrips = query(collection(db, "trips"), where("memberEmails", "array-contains", user.email));
  // includeMetadataChanges: also tell us when a trip created on this
  // device has been confirmed by the server (see below).
  stopTripsListener = onSnapshot(myTrips, { includeMetadataChanges: true }, (snap) => {
    const trips = snap.docs.map(withId);
    applyRemoteTrips(trips);

    // Follow trips as they appear (created here, created elsewhere, or
    // newly shared with me) and disappear (deleted or unshared).
    const ids = new Set(trips.map((t) => t.id));
    knownTripIds = ids;
    [...tripListeners.keys()].forEach((id) => { if (!ids.has(id)) stopTrip(id); });

    // A trip created on this device isn't on the server until its write
    // is confirmed (immediately with signal; later, if offline). Until
    // then the rules can't see it, and would refuse a listener on its
    // cards and lists. So those listeners start only once the trip is
    // confirmed. Meanwhile its contents were made here, so they're
    // already in storage.js's copy.
    const confirmed = snap.docs.filter((d) => !d.metadata.hasPendingWrites).map((d) => d.id);
    const newlyLoading = confirmed.filter((id) => !tripListeners.has(id)).map(listenToTrip);

    if (!readyReported) Promise.all(newlyLoading).then(reportReady);
    else if (isRemote(snap)) handleRemoteChange();
  }, (err) => {
    // Shouldn't happen for a signed-in member, but never leave the app
    // stuck on a blank screen if it does.
    console.error("Couldn't load trips:", err.code || err);
    reportReady();
  });
}

export function stopSync() {
  if (stopTripsListener) stopTripsListener();
  stopTripsListener = null;
  [...tripListeners.keys()].forEach(stopTrip);
  knownTripIds = new Set();
  retries.clear();
  readyReported = false;
  resetStatus();
  clearSyncedData();
}

// Writes return promises that only settle once the server confirms,
// which never happens while offline. So nothing waits on them; a
// failure (e.g. the rules refusing it) is logged, and Firestore itself
// rolls the local copy back, which the listeners then show.
function report(promise, what) {
  checkPendingWrites();
  promise.catch((err) => console.error(`Couldn't save ${what}:`, err.code || err));
}

window.setoutSync = {
  setTrip(tripId, data) {
    report(setDoc(doc(db, "trips", tripId), withoutId(data)), "the trip");
  },
  updateTrip(tripId, fields) {
    report(updateDoc(doc(db, "trips", tripId), fields), "the trip");
  },
  // Removes one field, or one entry of a map via a dotted path
  // ("transportGaps.abc__def"), leaving the rest of the trip alone.
  deleteTripField(tripId, path) {
    report(updateDoc(doc(db, "trips", tripId), { [path]: deleteField() }), "the trip");
  },
  // Sharing (LUV-42). arrayUnion / arrayRemove add or remove one email
  // without rewriting the whole list, so if two people change the
  // member list at the same moment, neither change is lost.
  addMember(tripId, email) {
    report(updateDoc(doc(db, "trips", tripId), { memberEmails: arrayUnion(email) }), "the new trip member");
  },
  removeMember(tripId, email) {
    report(updateDoc(doc(db, "trips", tripId), { memberEmails: arrayRemove(email) }), "the member removal");
  },
  setItem(tripId, list, data) {
    report(setDoc(doc(db, "trips", tripId, list, data.id), withoutId(data)), `a ${list} entry`);
  },
  // `fields` may use dotted paths ("location.placeName") to change one
  // part of a nested object without replacing the rest of it.
  updateItem(tripId, list, id, fields) {
    report(updateDoc(doc(db, "trips", tripId, list, id), fields), `a ${list} entry`);
  },
  deleteItem(tripId, list, id) {
    report(deleteDoc(doc(db, "trips", tripId, list, id)), `a ${list} deletion`);
  },
  // Firestore doesn't delete a document's subcollections for you, so a
  // trip's cards and lists are deleted first, in batches (a batch holds
  // at most 500 writes), with the trip itself in the last batch. The
  // trip has to go last: once it's gone, the rules can no longer see
  // that you're a member, and would refuse the rest.
  deleteTrip(tripId, children) {
    const refs = children.map(({ list, id }) => doc(db, "trips", tripId, list, id));
    refs.push(doc(db, "trips", tripId));
    for (let i = 0; i < refs.length; i += 450) {
      const batch = writeBatch(db);
      refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
      report(batch.commit(), "the trip deletion");
    }
  }
};
