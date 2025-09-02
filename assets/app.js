// app.js: データモデルとストレージ（S0はlocalStorage実装。S1でIndexedDBへ移行）
export const VERSION = "0.1.0";

const LS_KEY = "bookmaker.books.v1";

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

/** @returns {Book[]} */
export function loadBooks() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** @param {Book[]} books */
export function saveBooks(books) {
  localStorage.setItem(LS_KEY, JSON.stringify(books));
}

/** @param {Partial<Book>} data */
export function createBook(data) {
  const now = new Date().toISOString();
  /** @type {Book} */
  const book = {
    id: crypto.randomUUID(),
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
  const books = loadBooks();
  books.unshift(book);
  saveBooks(books);
  return book;
}

/** @param {string} q */
export function searchBooks(q) {
  const books = loadBooks();
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
