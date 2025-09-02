// db.js: IndexedDB ラッパーとlocalStorageからの移行

const DB_NAME = "bookmaker";
const DB_VERSION = 1;
const STORES = {
  books: "books",
  settings: "settings",
  achState: "achState",
  stats: "stats",
};

const LS_KEY = "bookmaker.books.v1";

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.books)) {
        db.createObjectStore(STORES.books, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.achState)) {
        db.createObjectStore(STORES.achState, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.stats)) {
        db.createObjectStore(STORES.stats, { keyPath: "id" });
      }
    };
    req.onsuccess = async () => {
      const db = req.result;
      try {
        await migrateFromLocalStorage(db);
      } catch (e) {
        console.warn("Migration skipped:", e);
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function migrateFromLocalStorage(db) {
  // 既にbooksがあればスキップ
  const count = await countStore(db, STORES.books);
  const raw = localStorage.getItem(LS_KEY);
  if (!raw || count > 0) return;
  /** @type {any[]} */
  let items = [];
  try {
    items = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(items) || items.length === 0) return;
  await txPutAll(db, STORES.books, items);
  localStorage.removeItem(LS_KEY);
}

function tx(db, storeName, mode = "readonly") {
  const t = db.transaction(storeName, mode);
  return t.objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function countStore(db, store) {
  const r = tx(db, store).count();
  return await reqToPromise(r);
}

async function txPutAll(db, store, items) {
  await new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const s = t.objectStore(store);
    for (const it of items) s.put(it);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Books APIs
export async function getAllBooks() {
  const db = await openDB();
  const r = tx(db, STORES.books).getAll();
  const all = await reqToPromise(r);
  // createdAtの降順で返す
  return all.sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
}

export async function addBook(book) {
  const db = await openDB();
  const r = tx(db, STORES.books, "readwrite").add(book);
  await reqToPromise(r);
  return book;
}

export async function updateBook(book) {
  const db = await openDB();
  const r = tx(db, STORES.books, "readwrite").put(book);
  await reqToPromise(r);
  return book;
}

export async function deleteBook(id) {
  const db = await openDB();
  const r = tx(db, STORES.books, "readwrite").delete(id);
  await reqToPromise(r);
}

export async function getBook(id) {
  const db = await openDB();
  const r = tx(db, STORES.books).get(id);
  return await reqToPromise(r);
}

// Achievements state APIs
export async function getAllAchState() {
  const db = await openDB();
  const r = tx(db, STORES.achState).getAll();
  return await reqToPromise(r);
}

export async function putAchState(entry) {
  const db = await openDB();
  const r = tx(db, STORES.achState, "readwrite").put(entry);
  await reqToPromise(r);
}
