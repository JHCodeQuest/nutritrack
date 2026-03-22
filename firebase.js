// ── FIREBASE SETUP ───────────────────────────────────────────────────────
// We import Firebase tools directly from Google's CDN
import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                                                  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot }
                                                  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Your Firebase project config — these are safe to be in frontend code
const firebaseConfig = {
  apiKey:            "AIzaSyAvEEu5fVhw-53xddvP7Weh3uo7THwMPN4",
  authDomain:        "nutritrack-5fc63.firebaseapp.com",
  projectId:         "nutritrack-5fc63",
  storageBucket:     "nutritrack-5fc63.firebasestorage.app",
  messagingSenderId: "201676177627",
  appId:             "1:201676177627:web:857b03681e244bedbf0cfe"
};

// Initialise Firebase — think of this like "connecting to the database"
const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);       // handles login/logout
const db          = getFirestore(firebaseApp);  // the cloud database

// ── AUTH STATE ───────────────────────────────────────────────────────────
// This function runs automatically whenever the login state changes
// e.g. when user signs in, signs out, or reopens the app
onAuthStateChanged(auth, (user) => {
  if (user) {
    // User is signed in
    showApp(user);
    subscribeToFirestore(user.uid);  // start listening for their cloud data
  } else {
    // User is signed out
    showLoginScreen();
    unsubscribeFirestore();
  }
});

// Sign in with Google popup
window.signInWithGoogle = async function() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged above will fire automatically after this
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in failed: ' + e.message, true);
    }
  }
};

// Sign out
window.signOutUser = async function() {
  await signOut(auth);
  // onAuthStateChanged will fire and show login screen
};

// ── FIRESTORE SYNC ───────────────────────────────────────────────────────
// Firestore path: users/{userId}/logs/{dateKey}
// e.g. users/abc123/logs/2026-03-21
let firestoreUnsub = null;  // holds the "stop listening" function

function subscribeToFirestore(uid) {
  // Listen in real-time to today's document in Firestore
  // onSnapshot fires immediately with current data, then again on any change
  const docRef = doc(db, 'users', uid, 'logs', currentDateKey);
  firestoreUnsub = onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      const cloudData = snap.data();
      // Load cloud data into meals array
      meals.forEach(meal => {
        meal.items = cloudData[meal.id] || [];
      });
    } else {
      // No cloud data for this day — try loading from localStorage fallback
      loadFromLocalStorage();
    }
    renderMeals();
    updateSummary();
    markSaved();
  }, (err) => {
    console.warn('Firestore error, falling back to localStorage:', err);
    loadFromLocalStorage();
    renderMeals();
    updateSummary();
  });
}

function unsubscribeFirestore() {
  if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
  meals.forEach(m => m.items = []);
  renderMeals();
  updateSummary();
}

// Save current day's meals to Firestore
// We wrap it in a try/catch so if offline it falls back to localStorage
window.saveToCloud = async function() {
  const user = auth.currentUser;
  if (!user) { saveToLocalStorage(); return; }

  const snapshot = {};
  meals.forEach(m => { snapshot[m.id] = m.items; });

  try {
    // setDoc writes (or overwrites) the document at this path
    await setDoc(
      doc(db, 'users', user.uid, 'logs', currentDateKey),
      snapshot
    );
    saveToLocalStorage(); // also save locally as offline backup
    markSaved();
  } catch(e) {
    console.warn('Cloud save failed, saved locally:', e);
    saveToLocalStorage();
    markSaved();
    showToast('Saved locally (offline mode)', false);
  }
};

// Re-subscribe when user changes day
window.resubscribeForDate = function() {
  const user = auth.currentUser;
  if (!user) return;
  unsubscribeFirestore();
  subscribeToFirestore(user.uid);
};

// Make db and auth accessible to non-module scripts
window._firebaseAuth = auth;
window._firebaseDb   = db;
