// stats.js: 統計の再計算（簡易フルリビルド）とアクションカウンタ
import { openDB } from "./db.js";

const STORE = "stats";
const DOC_ID = "stats";

export async function getStats() {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const r = t.objectStore(STORE).get(DOC_ID);
    r.onsuccess = () => resolve(r.result || defaultStats());
    r.onerror = () => reject(r.error);
  });
}

export async function putStats(stats) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const s = t.objectStore(STORE);
    s.put({ ...stats, id: DOC_ID });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function defaultStats() {
  return {
    id: DOC_ID,
    totals: { reads: 0 },
    byDay: {}, // yyyy-mm-dd -> count
    byMonth: {}, // yyyy-mm -> count
    byYear: {}, // yyyy -> count
    authors: { unique: 0, counts: {} }, // name -> count
    streak: { current: 0, max: 0 },
    lastFiveAuthors: [],
    actions: {
      searchCount: 0,
      exportCount: 0,
      importCount: 0,
      deleteCount: 0,
      editCounts: {}, // bookId -> count
      rateCount: 0,
      settingsSaved: 0,
      fastCreateCount: 0,
    },
    monthRatingExtremes: {}, // yyyy-mm -> {has1:true/false, has5:true/false}
  };
}

export async function rebuildStats(books) {
  const stats = defaultStats();
  const finished = [...books]
    .filter((b) => b.finishedAt)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  stats.totals.reads = finished.length;
  const authorCounts = {};

  // per day / month / year + authors + extremes
  for (const b of finished) {
    const d = b.finishedAt; // yyyy-mm-dd
    const ym = d.slice(0, 7);
    const y = d.slice(0, 4);
    stats.byDay[d] = (stats.byDay[d] || 0) + 1;
    stats.byMonth[ym] = (stats.byMonth[ym] || 0) + 1;
    stats.byYear[y] = (stats.byYear[y] || 0) + 1;
    if (b.author) authorCounts[b.author] = (authorCounts[b.author] || 0) + 1;
    if (typeof b.rating === "number") {
      const e = (stats.monthRatingExtremes[ym] ||= {
        has1: false,
        has5: false,
      });
      if (b.rating === 1) e.has1 = true;
      if (b.rating === 5) e.has5 = true;
    }
  }
  stats.authors.counts = authorCounts;
  stats.authors.unique = Object.keys(authorCounts).length;

  // streak (max/current) based on days set
  const days = Object.keys(stats.byDay).sort();
  let max = 0,
    cur = 0,
    prev = null;
  for (const iso of days) {
    if (prev && isNextDay(prev, iso)) cur += 1;
    else cur = 1;
    max = Math.max(max, cur);
    prev = iso;
  }
  // current streak (ending today)
  let current = 0;
  let d = todayISO();
  const daySet = new Set(days);
  while (daySet.has(d)) {
    current += 1;
    d = prevISO(d);
  }
  stats.streak = { current, max };

  // last five authors
  const lastFive = finished.slice(-5).map((b) => b.author || "");
  stats.lastFiveAuthors = lastFive;

  return stats;
}

function isNextDay(prev, next) {
  const p = new Date(prev + "T00:00:00");
  const n = new Date(next + "T00:00:00");
  return (n - p) / 86400000 === 1;
}
function todayISO() {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}
function prevISO(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}
