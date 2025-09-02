// app.js: 状態・データ層・集計・称号（IndexedDB 実装）

// IndexedDB ラッパ
let USE_LS = false; // IDB不可時にlocalStorageにフォールバック
function openDB() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open('bookmaker', 1);
    } catch {
      USE_LS = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        const s = db.createObjectStore('books', { keyPath: 'id' });
        s.createIndex('finishedAt', 'finishedAt', { unique: false });
        s.createIndex('author', 'author', { unique: false });
        s.createIndex('title', 'title', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' }); // {key, value}
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      USE_LS = true;
      resolve(null);
    };
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const ret = fn(store, tx);
    tx.oncomplete = () => resolve(ret);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const Meta = {
  async get(key, fallback) {
    if (USE_LS) {
      try {
        const v = localStorage.getItem(`bookmaker:meta:${key}`);
        return v ? JSON.parse(v) : fallback;
      } catch {
        return fallback;
      }
    }
    return withStore('meta', 'readonly', (st) => st.get(key)).then(
      (req) =>
        new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
          req.onerror = () => resolve(fallback);
        }),
    );
  },
  async set(key, value) {
    if (USE_LS) {
      localStorage.setItem(`bookmaker:meta:${key}`, JSON.stringify(value));
      return;
    }
    return withStore('meta', 'readwrite', (st) => st.put({ key, value }));
  },
};

export const Store = (() => {
  const K = {
    unlocked: 'unlocked',
    counters: 'counters',
  };

  const nowIso = () => new Date().toISOString();
  const uuid = () =>
    crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2);

  const getUnlocked = async () => new Set((await Meta.get(K.unlocked, [])) || []);
  const setUnlocked = async (set) => Meta.set(K.unlocked, Array.from(set));

  const getCounters = async () => (await Meta.get(K.counters, {})) || {};
  const setCounters = async (c) => Meta.set(K.counters, c);
  const incCounter = async (name, by = 1) => {
    const c = await getCounters();
    c[name] = (c[name] || 0) + by;
    await setCounters(c);
    return c;
  };

  // 移行: localStorage→IndexedDB（初回のみ）
  const migrateIfNeeded = async () => {
    const lsBooksRaw = localStorage.getItem('bookmaker:books');
    if (lsBooksRaw) {
      const lsBooks = JSON.parse(lsBooksRaw);
      if (!USE_LS) {
        const existing = await withStore('books', 'readonly', (st) => st.getAll()).then(
          (req) =>
            new Promise((resolve) => {
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => resolve([]);
            }),
        );
        if (!existing.length && lsBooks.length) {
          await withStore('books', 'readwrite', (st) => {
            lsBooks.forEach((b) => st.put(b));
          });
        }
      }
      localStorage.removeItem('bookmaker:books');
    }
    const lsUnlocked = localStorage.getItem('bookmaker:achievements:unlocked');
    if (lsUnlocked) {
      const present = await Meta.get(K.unlocked, null);
      if (!present) await Meta.set(K.unlocked, JSON.parse(lsUnlocked));
      localStorage.removeItem('bookmaker:achievements:unlocked');
    }
  };

  return {
    K,
    nowIso,
    uuid,
    getUnlocked,
    setUnlocked,
    getCounters,
    setCounters,
    incCounter,
    migrateIfNeeded,
  };
})();

// 日付ユーティリティ（Asia/Tokyo基準）
export const DateUtil = (() => {
  const JST_OFFSET_MIN = 9 * 60;
  const toJstDate = (isoOrDate) => {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : new Date(isoOrDate);
    // JS Dateは内部UTC。JSTキー作成のためオフセットを足し引きして日付キー化
    const t = d.getTime() + (JST_OFFSET_MIN - d.getTimezoneOffset()) * 60_000;
    return new Date(t);
  };
  const ymdKeyJst = (iso) => {
    const d = toJstDate(iso);
    const y = d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const ymKeyJst = (iso) => ymdKeyJst(iso).slice(0, 7);
  const isoWeekKeyJst = (iso) => {
    // ISO週（Mon-Sun）: 木曜日の週番号方式
    const d = toJstDate(iso);
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // 木曜に合わせる
    const dayNr = (target.getUTCDay() + 6) % 7; // 0=Mon
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
      );
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  };
  const todayYmd = () => ymdKeyJst(new Date().toISOString());
  const toInputDate = (iso) => ymdKeyJst(iso); // yyyy-mm-dd
  return { ymdKeyJst, ymKeyJst, isoWeekKeyJst, todayYmd, toInputDate };
})();

// 集計（毎回再計算でシンプルに）
export function computeStats(books) {
  const byDay = new Map();
  const byMonth = new Map();
  const byWeek = new Map();
  const byAuthor = new Map();

  const finished = books.filter((b) => !!b.finishedAt);
  for (const b of finished) {
    const d = DateUtil.ymdKeyJst(b.finishedAt);
    byDay.set(d, (byDay.get(d) || 0) + 1);
    const m = DateUtil.ymKeyJst(b.finishedAt);
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
    const w = DateUtil.isoWeekKeyJst(b.finishedAt);
    byWeek.set(w, (byWeek.get(w) || 0) + 1);
    const a = (b.author || '').trim();
    if (a) byAuthor.set(a, (byAuthor.get(a) || 0) + 1);
  }

  // 連続読了（最大）
  const keys = Array.from(byDay.keys()).sort();
  let streakMax = 0;
  let streakCur = 0;
  let prev = null;
  for (const k of keys) {
    if (!prev) {
      streakCur = 1;
    } else {
      const pd = new Date(prev);
      const cd = new Date(k);
      const diff = (cd - pd) / 86400000;
      streakCur = diff === 1 ? streakCur + 1 : 1;
    }
    streakMax = Math.max(streakMax, streakCur);
    prev = k;
  }

  return {
    totals: { reads: finished.length },
    byDay: Object.fromEntries(byDay),
    byMonth: Object.fromEntries(byMonth),
    byWeek: Object.fromEntries(byWeek),
    byAuthor: Object.fromEntries(byAuthor),
    streaks: { maxDays: streakMax },
  };
}

// 称号ロジック（スプリント0: 一部のみ対応）
export async function loadAchievements() {
  const res = await fetch('./assets/achievements.json');
  const list = await res.json();
  return list;
}

export async function evaluateAchievements({ achievements, stats, books, counters, lastEvent }) {
  // lastEvent: { type: 'save'|'edit'|'delete'|'search'|'backup'|'restore', book?, durationSec? }
  const unlocked = await Store.getUnlocked();
  const newly = [];

  const get = (obj, key, def = 0) => (obj && key in obj ? obj[key] : def);
  const total = stats.totals.reads;
  const nowIso = new Date().toISOString();
  const monthKeyNow = DateUtil.ymKeyJst(nowIso);
  const weekKeyNow = DateUtil.isoWeekKeyJst(nowIso);
  const monthReadsNow = get(stats.byMonth, monthKeyNow, 0);
  const weekReadsNow = get(stats.byWeek, weekKeyNow, 0);
  const streakMax = stats.streaks.maxDays || 0;

  // ユーティリティ
  const weekday = (iso) => new Date(iso).getDay(); // 0=Sun
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  // 前処理
  const finished = books
    .filter((b) => !!b.finishedAt)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const byTitle = new Map();
  const byAuthorMonth = new Map(); // `${author}|${ym}` -> count
  const byAuthorDay = new Map(); // `${author}|${ymd}` -> count
  const byMonthDistinctDays = new Map(); // ym -> Set(days)
  const allAuthorsSet = new Set();

  for (const b of finished) {
    const t = (b.title || '').trim();
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(b);
    const a = (b.author || '').trim();
    if (a) allAuthorsSet.add(a);
    const ym = DateUtil.ymKeyJst(b.finishedAt);
    const ymd = DateUtil.ymdKeyJst(b.finishedAt);
    if (a) byAuthorMonth.set(`${a}|${ym}`, (byAuthorMonth.get(`${a}|${ym}`) || 0) + 1);
    if (a) byAuthorDay.set(`${a}|${ymd}`, (byAuthorDay.get(`${a}|${ymd}`) || 0) + 1);
    if (!byMonthDistinctDays.has(ym)) byMonthDistinctDays.set(ym, new Set());
    byMonthDistinctDays.get(ym).add(ymd);
  }

  const checkRule = (rule) => {
    switch (rule.type) {
      // 基本集計
      case 'TOTAL_READS':
        return rule.gte != null && total >= rule.gte && (rule.lte == null || total <= rule.lte);
      case 'MONTH_READS': {
        // 現在の月
        return rule.gte != null && monthReadsNow >= rule.gte;
      }
      case 'WEEK_READS':
        return rule.gte != null && weekReadsNow >= rule.gte;
      case 'YEAR_READS': {
        const y = new Date().getFullYear();
        const sum = Object.entries(stats.byMonth || {})
          .filter(([k]) => Number(k.slice(0, 4)) === y)
          .reduce((s, [, v]) => s + v, 0);
        return rule.gte != null && sum >= rule.gte;
      }
      case 'QUARTER_READS': {
        const d = new Date();
        const y = d.getFullYear();
        const q = Math.floor(d.getMonth() / 3); // 0..3
        const months = [q * 3 + 1, q * 3 + 2, q * 3 + 3];
        const sum = months
          .map((m) => `${y}-${String(m).padStart(2, '0')}`)
          .reduce((acc, k) => acc + (stats.byMonth?.[k] || 0), 0);
        return rule.gte != null && sum >= rule.gte;
      }
      case 'HALF_YEAR_READS': {
        const d = new Date();
        const y = d.getFullYear();
        const h = d.getMonth() < 6 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
        const sum = h
          .map((m) => `${y}-${String(m).padStart(2, '0')}`)
          .reduce((a, k) => a + (stats.byMonth?.[k] || 0), 0);
        return rule.gte != null && sum >= rule.gte;
      }
      case 'MONTH_WEEKS_ALL_GTE': {
        // 現在の月の各ISO週で gte
        const d = new Date();
        const y = d.getFullYear();
        const m = d.getMonth();
        const last = new Date(y, m + 1, 0);
        const weeks = new Set();
        for (let day = 1; day <= last.getDate(); day++) {
          const iso = new Date(y, m, day).toISOString();
          weeks.add(DateUtil.isoWeekKeyJst(iso));
        }
        for (const w of weeks) if ((stats.byWeek?.[w] || 0) < (rule.gte || 1)) return false;
        return true;
      }
      case 'STREAK_DAYS':
        return rule.gte != null && streakMax >= rule.gte;

      // 速度・日付
      case 'SAME_DAY_FINISH': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt || !b.startedAt) return false;
        return DateUtil.ymdKeyJst(b.finishedAt) === DateUtil.ymdKeyJst(b.startedAt);
      }
      case 'DURATION_HOURS': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt || !b.startedAt) return false;
        const hrs = (new Date(b.finishedAt) - new Date(b.startedAt)) / 3600000;
        return rule.lte != null ? hrs <= rule.lte : false;
      }
      case 'DURATION_DAYS': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt || !b.startedAt) return false;
        const ds = daysBetween(b.startedAt, b.finishedAt);
        if (rule.lte != null) return ds <= rule.lte;
        if (rule.gte != null) return ds >= rule.gte;
        return false;
      }
      case 'DAY_FINISH_COUNT': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt) return false;
        const ymd = DateUtil.ymdKeyJst(b.finishedAt);
        const count = stats.byDay?.[ymd] || 0;
        return rule.gte != null && count >= rule.gte;
      }
      case 'WEEKEND_START_END': {
        const b = lastEvent?.book;
        if (!b || !b.startedAt || !b.finishedAt) return false;
        return weekday(b.startedAt) === 6 && weekday(b.finishedAt) === 0; // Sat -> Sun
      }

      // テキスト系
      case 'REVIEW_CHARS': {
        const b = lastEvent?.book;
        if (!b) return false;
        const len = (b.reviewText || '').length;
        if (rule.lte != null) return len <= rule.lte;
        if (rule.gte != null) return len >= rule.gte;
        return false;
      }
      case 'REVIEW_LINE_COUNT': {
        const b = lastEvent?.book;
        if (!b) return false;
        const lines = (b.reviewText || '').split(/\n/).length;
        if (rule.lte != null) return lines <= rule.lte;
        if (rule.gte != null) return lines >= rule.gte;
        return false;
      }
      case 'REVIEW_CONTAINS': {
        const b = lastEvent?.book;
        if (!b) return false;
        const t = b.reviewText || '';
        return (rule.any || []).some((w) => t.includes(w));
      }

      // 一言系
      case 'ONELINER_CHARS': {
        const b = lastEvent?.book;
        if (!b) return false;
        const len = (b.oneLiner || '').length;
        return rule.lte != null && len <= rule.lte;
      }
      case 'ONELINER_CHARS_EQ': {
        const b = lastEvent?.book;
        if (!b) return false;
        return (b.oneLiner || '').length === rule.eq;
      }
      case 'ONELINER_NO_PERIOD': {
        const b = lastEvent?.book;
        if (!b) return false;
        const s = (b.oneLiner || '').trim();
        return s && !/[。.]/.test(s.slice(-1));
      }
      case 'ONELINER_CONTAINS': {
        const b = lastEvent?.book;
        if (!b) return false;
        const s = b.oneLiner || '';
        return (rule.any || []).some((w) => s.includes(w));
      }
      case 'ONELINER_CONTAINS_DIGIT': {
        const b = lastEvent?.book;
        if (!b) return false;
        return /[0-9０-９]/.test(b.oneLiner || '');
      }
      case 'ONELINER_CONTAINS_ALPHA': {
        const b = lastEvent?.book;
        if (!b) return false;
        return /[A-Za-z]/.test(b.oneLiner || '');
      }
      case 'ONELINER_EMPTY': {
        const b = lastEvent?.book;
        if (!b) return false;
        return !(b.oneLiner || '').trim();
      }

      // 再読/著者
      case 'REREAD_COUNT': {
        const b = lastEvent?.book;
        if (!b || !b.title) return false;
        const arr = byTitle.get(b.title.trim()) || [];
        return rule.gte != null && arr.length >= rule.gte;
      }
      case 'REREAD_COMPARE': {
        const b = lastEvent?.book;
        if (!b || !b.title) return false;
        const arr = (byTitle.get(b.title.trim()) || []).sort((a, b) =>
          a.finishedAt.localeCompare(b.finishedAt),
        );
        if (arr.length < 2) return false;
        const prev = arr[arr.length - 2];
        if (rule.field === 'reviewText') {
          if (rule.cmp === 'shorter')
            return (b.reviewText || '').length < (prev.reviewText || '').length;
        }
        if (rule.field === 'oneLiner') {
          if (rule.cmp === 'changed') return (b.oneLiner || '') !== (prev.oneLiner || '');
        }
        return false;
      }
      case 'REREAD_INTERVAL_DAYS': {
        const b = lastEvent?.book;
        if (!b || !b.title) return false;
        const arr = (byTitle.get(b.title.trim()) || []).sort((a, b) =>
          a.finishedAt.localeCompare(b.finishedAt),
        );
        if (arr.length < 2) return false;
        const first = arr[0];
        const last = arr[arr.length - 1];
        const dif = daysBetween(first.finishedAt, last.finishedAt);
        if (rule.lte != null) return dif <= rule.lte;
        if (rule.gte != null) return dif >= rule.gte;
        return false;
      }
      case 'AUTHOR_STREAK_ALL_DIFFERENT': {
        const n = rule.gte || 3;
        const recent = finished.slice(-n);
        if (recent.length < n) return false;
        const s = new Set(recent.map((b) => (b.author || '').trim()));
        return s.size === n;
      }
      case 'SAME_AUTHOR_STREAK': {
        const n = rule.gte || 2;
        const recent = finished.slice(-n);
        if (recent.length < n) return false;
        const a = (recent[0].author || '').trim();
        return recent.every((b) => (b.author || '').trim() === a);
      }
      case 'UNIQUE_AUTHORS': {
        return (allAuthorsSet.size || 0) >= (rule.gte || 0);
      }
      case 'AUTHOR_NAME_LENGTH': {
        const b = lastEvent?.book;
        if (!b) return false;
        return (b.author || '').trim().length >= (rule.gte || 0);
      }
      case 'MONTH_AUTHOR_READS': {
        // 任意の月で満たせばOK
        for (const [, v] of byAuthorMonth) if (v >= (rule.gte || 0)) return true;
        return false;
      }
      case 'DAY_AUTHOR_FINISH_COUNT': {
        for (const [, v] of byAuthorDay) if (v >= (rule.gte || 0)) return true;
        return false;
      }
      case 'MONTH_ALL_NEW_AUTHORS': {
        // ある月内の著者が、それ以前の履歴に存在しない
        const byMonthAuthors = new Map(); // ym -> Set(author)
        const seen = new Set();
        for (const b of finished) {
          const a = (b.author || '').trim();
          const ym = DateUtil.ymKeyJst(b.finishedAt);
          if (!byMonthAuthors.has(ym)) byMonthAuthors.set(ym, new Set());
          byMonthAuthors.get(ym).add(a);
        }
        for (const [, authors] of byMonthAuthors) {
          let ok = true;
          for (const a of authors)
            if (seen.has(a)) {
              ok = false;
              break;
            }
          if (ok && authors.size > 0) return true;
          for (const a of authors) seen.add(a);
        }
        return false;
      }
      case 'RECENT_N_AUTHORS_ALL_DIFFERENT': {
        const n = rule.n || 5;
        const recent = finished.slice(-n);
        if (recent.length < n) return false;
        const s = new Set(recent.map((b) => (b.author || '').trim()));
        return s.size === n;
      }

      // 曜日・月
      case 'FINISH_WEEKDAY': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt) return false;
        return weekday(b.finishedAt) === rule.eq;
      }
      case 'FINISH_WEEKDAY_IN': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt) return false;
        return (rule.any || []).includes(weekday(b.finishedAt));
      }
      case 'FINISH_DAY_OF_MONTH': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt) return false;
        return new Date(b.finishedAt).getDate() === rule.eq;
      }
      case 'FINISH_LAST_DAY_OF_MONTH': {
        const b = lastEvent?.book;
        if (!b || !b.finishedAt) return false;
        const d = new Date(b.finishedAt);
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return d.getDate() === last;
      }
      case 'MONTH_SPECIFIC_READS': {
        const month = rule.month; // 1-12
        const sum = Object.entries(stats.byMonth || {})
          .filter(([k]) => Number(k.slice(5, 7)) === month)
          .reduce((s, [, v]) => s + v, 0);
        return sum >= (rule.gte || 0);
      }
      case 'MONTH_DISTINCT_DAYS': {
        for (const [, set] of byMonthDistinctDays) if (set.size >= (rule.gte || 0)) return true;
        return false;
      }
      case 'MONTH_WEEKS_CONSECUTIVE': {
        // 任意の月で n 週連続（各週>=1）
        const weeksByMonth = new Map(); // ym->Map(week->count)
        for (const b of finished) {
          const ym = DateUtil.ymKeyJst(b.finishedAt);
          const wk = DateUtil.isoWeekKeyJst(b.finishedAt);
          if (!weeksByMonth.has(ym)) weeksByMonth.set(ym, new Map());
          const m = weeksByMonth.get(ym);
          m.set(wk, (m.get(wk) || 0) + 1);
        }
        const need = rule.gte || 4;
        for (const [, m] of weeksByMonth) {
          const weeks = Array.from(m.keys()).sort();
          let run = 0,
            best = 0;
          for (let i = 0; i < weeks.length; i++) {
            if (i === 0 || Number(weeks[i].slice(6)) === Number(weeks[i - 1].slice(6)) + 1) run++;
            else run = 1;
            best = Math.max(best, run);
          }
          if (best >= need) return true;
        }
        return false;
      }

      // 操作・評価カウンタ系
      case 'BACKUP_COUNT':
        return (counters.backups || 0) >= (rule.gte || 1);
      case 'RESTORE_COUNT':
        return (counters.restores || 0) >= (rule.gte || 1);
      case 'EDIT_COUNT_PER_BOOK': {
        const b = lastEvent?.book;
        if (!b) return false;
        const cnt = (counters.editsByBook && counters.editsByBook[b.id]) || 0;
        return cnt >= (rule.gte || 0);
      }
      case 'DELETE_COUNT':
        return (counters.deletes || 0) >= (rule.gte || 1);
      case 'RATING_ADDED': {
        const b = lastEvent?.book;
        if (!b) return false;
        return Number(b.rating || 0) > 0;
      }
      case 'MONTH_RATING_BOTH': {
        // 任意の月で★5と★1が共存
        const byMonthRatings = new Map(); // ym->{has1,has5}
        for (const b of finished) {
          const ym = DateUtil.ymKeyJst(b.finishedAt);
          if (!byMonthRatings.has(ym)) byMonthRatings.set(ym, { has1: false, has5: false });
          const r = Number(b.rating || 0);
          if (r === 1) byMonthRatings.get(ym).has1 = true;
          if (r === 5) byMonthRatings.get(ym).has5 = true;
        }
        for (const v of byMonthRatings.values()) if (v.has1 && v.has5) return true;
        return false;
      }
      case 'SEARCH_COUNT':
        return (counters.searches || 0) >= (rule.gte || 0);
      case 'QUICK_SAVE_SECONDS': {
        const sec = lastEvent?.durationSec;
        if (sec == null) return false;
        return sec <= (rule.lte || 60);
      }
      case 'BOOK_CREATE_COUNT':
        return (counters.creates || 0) >= (rule.gte || 1);
      case 'SETTINGS_SAVE_COUNT':
        return (counters.settingsSaves || 0) >= (rule.gte || 1);
      default:
        return false;
    }
  };

  for (const a of achievements) {
    if (unlocked.has(a.id)) continue;
    if (checkRule(a.rule)) {
      unlocked.add(a.id);
      newly.push(a);
    }
  }

  if (newly.length) await Store.setUnlocked(unlocked);
  return newly;
}

// 本の永続化API（最小）
export const Books = {
  async list() {
    if (USE_LS) {
      const all = JSON.parse(localStorage.getItem('bookmaker:books') || '[]');
      return all.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''));
    }
    const all = await withStore('books', 'readonly', (st) => st.getAll()).then(
      (req) =>
        new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        }),
    );
    return all.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''));
  },
  async create(input) {
    const now = Store.nowIso();
    const book = {
      id: Store.uuid(),
      title: (input.title || '').trim(),
      author: (input.author || '').trim(),
      startedAt: input.startedAt || now,
      finishedAt: input.finished ? input.finishedAt || now : '',
      reviewText: input.reviewText || '',
      oneLiner: input.oneLiner || '',
      rating: Number(input.rating || 0),
      createdAt: now,
      updatedAt: now,
    };
    if (USE_LS) {
      const all = JSON.parse(localStorage.getItem('bookmaker:books') || '[]');
      all.push(book);
      localStorage.setItem('bookmaker:books', JSON.stringify(all));
    } else {
      await withStore('books', 'readwrite', (st) => st.put(book));
    }
    // カウンタ
    await Store.incCounter('creates', 1);
    return book;
  },
  async update(id, patch) {
    if (USE_LS) {
      const all = JSON.parse(localStorage.getItem('bookmaker:books') || '[]');
      const book = all.find((b) => b.id === id) || null;
      if (!book) return null;
      const next = { ...book, ...patch, updatedAt: Store.nowIso() };
      const nextAll = all.map((b) => (b.id === id ? next : b));
      localStorage.setItem('bookmaker:books', JSON.stringify(nextAll));
      const c = await Store.getCounters();
      c.editsByBook = c.editsByBook || {};
      c.editsByBook[id] = (c.editsByBook[id] || 0) + 1;
      await Store.setCounters(c);
      return next;
    }
    const book = await withStore('books', 'readonly', (st) => st.get(id)).then(
      (req) =>
        new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        }),
    );
    if (!book) return null;
    const next = { ...book, ...patch, updatedAt: Store.nowIso() };
    await withStore('books', 'readwrite', (st) => st.put(next));
    const c = await Store.getCounters();
    c.editsByBook = c.editsByBook || {};
    c.editsByBook[id] = (c.editsByBook[id] || 0) + 1;
    await Store.setCounters(c);
    return next;
  },
  async remove(id) {
    if (USE_LS) {
      const all = JSON.parse(localStorage.getItem('bookmaker:books') || '[]');
      const next = all.filter((b) => b.id !== id);
      localStorage.setItem('bookmaker:books', JSON.stringify(next));
    } else {
      await withStore('books', 'readwrite', (st) => st.delete(id));
    }
    await Store.incCounter('deletes', 1);
  },
};

// デモデータ生成（任意）
export async function seedDemoIfEmpty() {
  const has = await Books.list();
  if (has.length) return;
  const today = new Date();
  const titles = ['青い栞', '砂時計の街', '紙片の宇宙', '読了の習慣', '静かな熱量', '栞と旅'];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 2 + 1));
    const iso = d.toISOString();
    await Books.create({
      title: titles[i % titles.length] + ` ${i + 1}`,
      author: ['山田', '佐藤', '鈴木', '田中'][i % 4],
      startedAt: iso,
      finished: true,
      finishedAt: iso,
      oneLiner: 'よかった',
      reviewText: '短い感想',
      rating: (i % 5) + 1,
    });
  }
}

// バックアップ/復元
export async function exportAll() {
  const books = await Books.list();
  const counters = await Store.getCounters();
  const unlocked = Array.from(await Store.getUnlocked());
  const data = { version: 1, exportedAt: new Date().toISOString(), books, counters, unlocked };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookmaker-backup-${DateUtil.todayYmd()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  await Store.incCounter('backups', 1);
}

export async function importAll(json, mode = 'merge') {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (mode === 'overwrite') {
    if (USE_LS) {
      localStorage.setItem('bookmaker:books', JSON.stringify([]));
    } else {
      await withStore('books', 'readwrite', (st) => st.clear());
    }
  }
  // books
  for (const b of data.books || []) {
    if (USE_LS) {
      const all = JSON.parse(localStorage.getItem('bookmaker:books') || '[]');
      all.push(b);
      localStorage.setItem('bookmaker:books', JSON.stringify(all));
    } else {
      await withStore('books', 'readwrite', (st) => st.put(b));
    }
  }
  // counters/unlocked (merge)
  const c0 = await Store.getCounters();
  const c1 = data.counters || {};
  const merged = { ...c0, ...c1 };
  merged.editsByBook = { ...(c0.editsByBook || {}), ...(c1.editsByBook || {}) };
  await Store.setCounters(merged);
  const u0 = await Store.getUnlocked();
  const u1 = new Set(data.unlocked || []);
  const u = new Set([...u0, ...u1]);
  await Store.setUnlocked(u);
  await Store.incCounter('restores', 1);
}

// 初期化フック（移行）
export async function init() {
  try {
    await openDB();
  } catch {
    /* no-op */
  }
  await Store.migrateIfNeeded();
}
