// Connects the board to Firebase: Google sign-in + Firestore.
// Each user's data lives under users/<uid>/projects and users/<uid>/tasks.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwkG2cVsCfHJPs7hp_FGGHS-oqL_2QwuQ",
  authDomain: "projack-manger.firebaseapp.com",
  projectId: "projack-manger",
  storageBucket: "projack-manger.firebasestorage.app",
  messagingSenderId: "28622406432",
  appId: "1:28622406432:web:6df091320ae41babb14d45",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const $ = (id) => document.getElementById(id);
const gate = $("gate"), gateMsg = $("gate-msg"), signinBtn = $("signin");

// Thin wrapper with the same shape the board code already uses (db.doc / db.collection).
function makeStore(uid) {
  const base = "users/" + uid + "/";
  const wrapSnap = (snap) => ({ docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })) });
  return {
    doc(path) {
      const ref = doc(fs, base + path);
      return {
        set: (data) => setDoc(ref, data),
        update: (data) => updateDoc(ref, data),
        delete: () => deleteDoc(ref),
      };
    },
    collection(path) {
      const ref = collection(fs, base + path);
      return {
        add: (data) => addDoc(ref, data),
        onSnapshot: (next, err) => onSnapshot(ref, (s) => next(wrapSnap(s)), err),
      };
    },
    async importData(data) {
      const ops = [];
      (data.projects || []).forEach((p) => ops.push([base + "projects/" + p.id, { name: p.name, order: p.order }]));
      (data.tasks || []).forEach((t) => { const { id, ...rest } = t; ops.push([base + "tasks/" + id, rest]); });
      for (let i = 0; i < ops.length; i += 400) {
        const b = writeBatch(fs);
        ops.slice(i, i + 400).forEach(([p, d]) => b.set(doc(fs, p), d));
        await b.commit();
      }
      return ops.length;
    },
  };
}

let store = null;

signinBtn.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  gateMsg.textContent = "מתחבר…";
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
    } else if (e && e.code === "auth/unauthorized-domain") {
      gateMsg.textContent = "הכתובת של האפליקציה עוד לא אושרה ב-Firebase (Authorized domains).";
    } else if (e && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      gateMsg.textContent = "ההתחברות נכשלה (" + (e.code || "שגיאה") + "). נסה שוב.";
    } else {
      gateMsg.textContent = "כדי לראות את הפרויקטים שלך, התחבר עם חשבון Google.";
    }
  }
});
getRedirectResult(auth).catch(() => {});

$("signout").addEventListener("click", () => signOut(auth));

$("import-file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f || !store) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.projects)) throw new Error("bad");
    $("importbox").hidden = true;
    const n = await store.importData(data);
    $("status").textContent = "הועברו " + data.projects.length + " פרויקטים ו-" + data.tasks.length + " משימות.";
    $("status").hidden = false;
    void n;
  } catch (_) {
    $("status").textContent = "הקובץ הזה לא נראה כמו קובץ הנתונים של הלוח.";
    $("status").className = "note err"; $("status").hidden = false;
  }
});

window.offerImport = (empty) => { $("importbox").hidden = !empty; };

onAuthStateChanged(auth, (user) => {
  if (user) {
    store = makeStore(user.uid);
    $("who").textContent = user.email || user.displayName || "";
    gate.hidden = true;
    window.startBoard(store);
  } else {
    store = null;
    window.stopBoard && window.stopBoard();
    $("importbox").hidden = true;
    gate.hidden = false;
    signinBtn.hidden = false;
    gateMsg.textContent = "כדי לראות את הפרויקטים שלך, התחבר עם חשבון Google.";
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
