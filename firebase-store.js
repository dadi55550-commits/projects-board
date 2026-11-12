// Connects the board to Firebase: Google sign-in + Firestore.
// Each user's data lives under users/<uid>/projects and users/<uid>/tasks.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, writeBatch, getDoc, query, where,
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
        get: async () => { const d = await getDoc(ref); return { exists: d.exists(), data: () => d.data() }; },
        onSnapshot: (next, err) => onSnapshot(ref, (d) => next({ exists: d.exists(), data: () => d.data() }), err),
      };
    },
    collection(path) {
      const ref = collection(fs, base + path);
      return {
        add: (data) => addDoc(ref, data),
        onSnapshot: (next, err) => onSnapshot(ref, (s) => next(wrapSnap(s)), err),
      };
    },
    uid,
    // Delegation: shared lists live at shares/<random id>, readable by anyone with the link.
    shares: {
      set: (id, data) => setDoc(doc(fs, "shares/" + id), Object.assign({}, data, { ownerUid: uid, updatedAt: new Date().toISOString() })),
      watchMine: (next, err) => onSnapshot(query(collection(fs, "shares"), where("ownerUid", "==", uid)), (snap) => next(snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))), err),
      remove: (id) => deleteDoc(doc(fs, "shares/" + id)),
    },
    // iPhone calendar subscription feed: feeds/<secret id>, read publicly by the calendar server, written only by the owner.
    feed: {
      set: (id, json) => setDoc(doc(fs, "feeds/" + id), { ownerUid: uid, updatedAt: new Date().toISOString(), json }),
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
  if (/[?&]login=redirect/.test(location.search)) { await signInWithRedirect(auth, provider); return; }
  try {
    // Open the popup synchronously inside the tap: any await before it makes Safari block the popup.
    // (Local persistence is already the default in browsers.)
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && e.code === "auth/popup-blocked") {
      gateMsg.textContent = "הדפדפן חסם את חלון ההתחברות. לחץ שוב על הכפתור.";
    } else if (e && e.code === "auth/operation-not-supported-in-this-environment") {
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

// One-time import link: #import=<base64url of raw-deflated JSON>. Kept until the user is signed in.
const IMPORT_KEY = "pendingImport";
if (location.hash.startsWith("#import=")) {
  try { sessionStorage.setItem(IMPORT_KEY, location.hash.slice(8)); } catch (_) {}
  history.replaceState(null, "", location.pathname);
}
async function decodeImport(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}
async function runPendingImport() {
  let s = null;
  try { s = sessionStorage.getItem(IMPORT_KEY); } catch (_) {}
  if (!s || !store) return;
  try {
    const data = await decodeImport(s);
    $("status").textContent = "מעביר את הנתונים…"; $("status").hidden = false;
    await store.importData(data);
    try { sessionStorage.removeItem(IMPORT_KEY); } catch (_) {}
    $("importbox").hidden = true;
    $("status").textContent = "הועברו " + data.projects.length + " פרויקטים ו-" + data.tasks.length + " משימות.";
  } catch (_) {
    $("status").textContent = "העברת הנתונים מהקישור נכשלה. נסה לפתוח את הקישור שוב.";
    $("status").className = "note err"; $("status").hidden = false;
  }
}

// ---------- Delegate page: ?share=<id> (no sign-in needed) ----------
const shareId = new URLSearchParams(location.search).get("share");
function renderSharePage(id) {
  document.querySelectorAll(".wrap, #gate, #fab, #inbox-sheet").forEach((el) => { el.hidden = true; el.style.display = "none"; });
  const box = document.createElement("div"); box.className = "share-page";
  box.innerHTML = '<h1 class="share-h">טוען…</h1><p class="share-sub"></p><ul class="share-list"></ul><p class="share-foot">מסמנים ✓ כשמשימה בוצעה – זה מתעדכן אצל מי ששלח את הרשימה.</p>';
  document.body.appendChild(box);
  const ref = doc(fs, "shares/" + id);
  let cur = null;
  const fmt = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return d + "." + m; };
  onSnapshot(ref, (d) => {
    if (!d.exists()) { box.querySelector(".share-h").textContent = "הרשימה לא נמצאה"; return; }
    cur = d.data();
    box.querySelector(".share-h").textContent = "המשימות של " + (cur.assignee || "");
    const open = (cur.items || []).filter((x) => !x.done).length;
    box.querySelector(".share-sub").textContent = (cur.fromName ? "מ" + cur.fromName + " · " : "") + open + " פתוחות";
    const ul = box.querySelector(".share-list"); ul.textContent = "";
    (cur.items || []).forEach((it, i) => {
      const li = document.createElement("li"); if (it.done) li.className = "done";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!it.done;
      cb.addEventListener("change", () => {
        const items = cur.items.map((x, j) => j === i ? Object.assign({}, x, { done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : "" }) : x);
        updateDoc(ref, { items, updatedAt: new Date().toISOString() }).catch(() => { cb.checked = !cb.checked; });
      });
      const t = document.createElement("div");
      const ti = document.createElement("b"); ti.textContent = it.title;
      const meta = document.createElement("small"); meta.textContent = [it.project, it.due ? "עד " + fmt(it.due) : ""].filter(Boolean).join(" · ");
      t.append(ti, meta);
      li.append(cb, t); ul.appendChild(li);
    });
  }, () => { box.querySelector(".share-h").textContent = "אין גישה לרשימה הזו"; });
}

if (shareId) renderSharePage(shareId);
else onAuthStateChanged(auth, (user) => {
  if (user) {
    store = makeStore(user.uid);
    $("who").textContent = user.email || user.displayName || "";
    gate.hidden = true;
    window.startBoard(store);
    runPendingImport();
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
  // When a new version is installed, reload once so the update shows right away.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => {
    r.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") r.update().catch(() => {}); });
  }).catch(() => {});
}
