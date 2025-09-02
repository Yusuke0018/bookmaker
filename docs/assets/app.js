// app.js: 状態・データ層・集計・称号
// 簡易版: IndexedDBは後続M2。いまはlocalStorageで最小実装。

export const Store = (() => {
  const K = {
    books: 'bookmaker:books',
    stats: 'bookmaker:stats',
    unlocked: 'bookmaker:achievements:unlocked',
  };

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, val) => localStorage.setItem(key, JSON.stringify(val));

  const nowIso = () => new Date().toISOString();
  const uuid = () =>
    crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2);

  const getBooks = () => read(K.books, []);
  const setBooks = (books) => write(K.books, books);

  const getUnlocked = () => new Set(read(K.unlocked, []));
  const setUnlocked = (set) => write(K.unlocked, Array.from(set));

  return {
    K,
    nowIso,
    uuid,
    getBooks,
    setBooks,
    getUnlocked,
    setUnlocked,
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

export function evaluateAchievements({ achievements, stats, lastEvent }) {
  // lastEvent: { type: 'save'|'edit'|'delete'|'search'|'backup'|'restore', book? }
  const unlocked = Store.getUnlocked();
  const newly = [];

  const get = (obj, key) => obj[key] ?? 0;
  const total = stats.totals.reads;
  const monthKeyNow = DateUtil.ymKeyJst(new Date().toISOString());
  const weekKeyNow = DateUtil.isoWeekKeyJst(new Date().toISOString());
  const monthReads = get(stats.byMonth, monthKeyNow);
  const weekReads = get(stats.byWeek, weekKeyNow);
  const streakMax = stats.streaks.maxDays || 0;

  const checkRule = (rule) => {
    switch (rule.type) {
      case 'TOTAL_READS':
        return rule.gte != null && total >= rule.gte && (rule.lte == null || total <= rule.lte);
      case 'MONTH_READS':
        return rule.gte != null && monthReads >= rule.gte;
      case 'WEEK_READS':
        return rule.gte != null && weekReads >= rule.gte;
      case 'STREAK_DAYS':
        return rule.gte != null && streakMax >= rule.gte;
      case 'REVIEW_CHARS': {
        const b = lastEvent?.book;
        if (!b) return false;
        const len = (b.reviewText || '').length;
        if (rule.lte != null) return len <= rule.lte;
        if (rule.gte != null) return len >= rule.gte;
        return false;
      }
      default:
        return false; // 未対応タイプはスキップ
    }
  };

  for (const a of achievements) {
    if (unlocked.has(a.id)) continue;
    if (checkRule(a.rule)) {
      unlocked.add(a.id);
      newly.push(a);
    }
  }

  if (newly.length) Store.setUnlocked(unlocked);
  return newly; // 初回獲得のみ
}

// 本の永続化API（最小）
export const Books = {
  list() {
    return Store.getBooks().sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''));
  },
  create(input) {
    const now = Store.nowIso();
    const book = {
      id: Store.uuid(),
      title: input.title.trim(),
      author: input.author.trim(),
      startedAt: input.startedAt || now,
      finishedAt: input.finished ? input.finishedAt || now : '',
      reviewText: input.reviewText || '',
      oneLiner: input.oneLiner || '',
      rating: Number(input.rating || 0),
      createdAt: now,
      updatedAt: now,
    };
    const books = Store.getBooks();
    books.push(book);
    Store.setBooks(books);
    return book;
  },
};

// デモデータ生成（任意）
export function seedDemoIfEmpty() {
  const books = Store.getBooks();
  if (books.length) return;
  const today = new Date();
  const titles = ['青い栞', '砂時計の街', '紙片の宇宙', '読了の習慣', '静かな熱量', '栞と旅'];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 2 + 1));
    const iso = d.toISOString();
    Books.create({
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
