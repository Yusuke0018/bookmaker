// app.js: データモデルとストレージ（IndexedDB実装）
import {
  addBook as dbAdd,
  getAllBooks as dbAll,
  updateBook as dbUpdate,
  deleteBook as dbDel,
  getBook as dbGet,
} from "./db.js";
export const VERSION = "0.2.0";

/** @typedef {Object} Book
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string=} startedAt  // yyyy-mm-dd
 * @property {string=} finishedAt // yyyy-mm-dd
 * @property {string=} reviewText
 * @property {string=} oneLiner
 * @property {number=} rating
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @returns {Promise<Book[]>} */
export async function loadBooks() {
  try {
    const list = await dbAll();
    if (Array.isArray(list)) return list;
  } catch {}
  return readLS();
}

/** @param {Partial<Book>} data */
export async function createBook(data) {
  const now = new Date().toISOString();
  /** @type {Book} */
  const book = {
    id: randomUUID(),
    title: (data.title || "").trim(),
    author: (data.author || "").trim(),
    startedAt: data.startedAt || "",
    finishedAt: data.finishedAt || "",
    reviewText: data.reviewText || "",
    oneLiner: data.oneLiner || "",
    rating: typeof data.rating === "number" ? data.rating : undefined,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await dbAdd(book);
  } catch {
    const books = readLS();
    books.unshift(book);
    writeLS(books);
  }
  return book;
}

/** @param {string} id @param {Partial<Book>} patch */
export async function updateBook(id, patch) {
  const existing = await dbGet(id);
  if (!existing) {
    const ls = readLS();
    const idx = ls.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error("Book not found");
    const now = new Date().toISOString();
    const updated = { ...ls[idx], ...patch, updatedAt: now };
    ls[idx] = updated;
    writeLS(ls);
    return updated;
  }
  const now = new Date().toISOString();
  const updated = { ...existing, ...patch, updatedAt: now };
  try {
    await dbUpdate(updated);
  } catch {
    const ls = readLS();
    const idx = ls.findIndex((b) => b.id === id);
    if (idx >= 0) {
      ls[idx] = updated;
      writeLS(ls);
    }
  }
  return updated;
}

/** @param {string} id */
export async function deleteBook(id) {
  try {
    await dbDel(id);
  } catch {
    const ls = readLS().filter((b) => b.id !== id);
    writeLS(ls);
  }
}

/** @param {string} q */
export async function searchBooks(q) {
  const books = await loadBooks();
  const needle = q.trim().toLowerCase();
  if (!needle) return books;
  return books.filter((b) =>
    [b.title, b.author, b.reviewText, b.oneLiner]
      .filter(Boolean)
      .join(" \n ")
      .toLowerCase()
      .includes(needle),
  );
}

export function todayISO() {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

function randomUUID() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto)
    return globalThis.crypto.randomUUID();
  // 簡易フォールバック
  const s = [...Array(36)].map((_, i) =>
    i === 14
      ? "4"
      : i === 19
        ? ((Math.random() * 4) | 8).toString(16)
        : ((Math.random() * 16) | 0).toString(16),
  );
  s[8] = s[13] = s[18] = s[23] = "-";
  return s.join("");
}

// LocalStorage fallback helpers
const LS_KEY = "bookmaker.books.v1";
function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function writeLS(books) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(books));
  } catch {}
}
