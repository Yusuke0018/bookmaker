// achievements.js: 定義の読込とルール評価
import { getAllAchState, putAchState } from "./db.js";

let defsCache = null; // [{id,name,rule,...}]

export async function loadAchievementDefs() {
  if (defsCache) return defsCache;
  const res = await fetch("./assets/achievements.json", { cache: "no-cache" });
  defsCache = await res.json();
  return defsCache;
}

/**
 * @param {Array} books
 * @param {{stats?: any, event?: string}} [ctx]
 */
export async function evaluateAndSave(books, ctx = {}) {
  const defs = await loadAchievementDefs();
  const state = await getAllAchState();
  const acquired = new Set(state.map((s) => s.id));
  const newly = [];
  for (const d of defs) {
    if (acquired.has(d.id)) continue;
    if (rulePass(d.rule, books, ctx)) {
      const entry = { id: d.id, acquiredAt: new Date().toISOString() };
      await putAchState(entry);
      newly.push(d);
    }
  }
  return newly; // [{id,name,...}]
}

function rulePass(rule, books, ctx) {
  switch (rule?.type) {
    case "TOTAL_READS": {
      const count = books.filter((b) => !!b.finishedAt).length;
      return typeof rule.gte === "number" ? count >= rule.gte : false;
    }
    case "STREAK_DAYS": {
      const { max } = computeStreak(books);
      return typeof rule.gte === "number" ? max >= rule.gte : false;
    }
    case "WEEK_READS": {
      const now = new Date();
      const wr = weekRange(now, ctx?.stats?.startOfWeek || "mon");
      const c = books.filter(
        (b) =>
          b.finishedAt && inRange(new Date(b.finishedAt), wr.start, wr.end),
      ).length;
      return c >= (rule.gte || 0);
    }
    case "MONTH_READS": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const c = books.filter((b) => (b.finishedAt || "").startsWith(ym)).length;
      return c >= (rule.gte || 0);
    }
    case "YEAR_READS": {
      const now = new Date();
      const y = String(now.getFullYear());
      const c = books.filter((b) => (b.finishedAt || "").startsWith(y)).length;
      return c >= (rule.gte || 0);
    }
    case "REVIEW_CHARS": {
      const lens = books.map((b) => (b.reviewText || "").length);
      const any = lens.some(
        (n) =>
          (rule.gte != null ? n >= rule.gte : true) &&
          (rule.lte != null ? n <= rule.lte : true),
      );
      return !!any;
    }
    case "REVIEW_CONTAINS": {
      const words = rule.anyOf || [];
      if (!words.length) return false;
      const any = books.some((b) => {
        const t = b.reviewText || "";
        return words.some((w) => t.includes(w));
      });
      return any;
    }
    case "ONE_LINER_PATTERN": {
      const p = rule;
      return books.some((b) => matchOneLiner(b.oneLiner || "", p));
    }
    case "REREAD_COUNT": {
      const map = groupByTitleFinishes(books);
      const any = [...map.values()].some(
        (arr) => arr.length >= (rule.gte || 0),
      );
      return any;
    }
    case "REREAD_COMPARE": {
      const map = groupByTitleFinishes(books);
      for (const arr of map.values()) {
        if (arr.length < 2) continue;
        const prev = arr[arr.length - 2];
        const last = arr[arr.length - 1];
        if (rule.field === "reviewText" && rule.cmp === "shorter") {
          if ((last.reviewText || "").length < (prev.reviewText || "").length)
            return true;
        }
        if (rule.field === "oneLiner" && rule.cmp === "different") {
          if ((last.oneLiner || "") !== (prev.oneLiner || "")) return true;
        }
      }
      return false;
    }
    case "SAME_AUTHOR_STREAK": {
      // 最大連続（読了順）
      const byDate = books
        .filter((b) => b.finishedAt)
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
      let max = 0,
        cur = 0,
        prev = null;
      for (const b of byDate) {
        if (prev && prev.author && b.author && prev.author === b.author)
          cur += 1;
        else cur = 1;
        max = Math.max(max, cur);
        prev = b;
      }
      return max >= (rule.gte || 0);
    }
    case "UNIQUE_AUTHORS": {
      const set = new Set(books.map((b) => b.author).filter(Boolean));
      return set.size >= (rule.gte || 0);
    }
    case "DATE_PATTERN": {
      return books.some((b) => matchDatePattern(b, rule));
    }
    case "READ_SPEED": {
      return books.some((b) => matchReadSpeed(b, rule));
    }
    case "SAME_DAY_FINISHES": {
      const map = new Map();
      for (const b of books) {
        if (!b.finishedAt) continue;
        map.set(b.finishedAt, (map.get(b.finishedAt) || 0) + 1);
      }
      return [...map.values()].some((v) => v >= (rule.gte || 2));
    }
    case "QUARTER_READS": {
      const now = new Date();
      const ym = new Set();
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        ym.add(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        );
      }
      const c = books.filter(
        (b) => b.finishedAt && ym.has(b.finishedAt.slice(0, 7)),
      ).length;
      return c >= (rule.gte || 0);
    }
    case "HALF_YEAR_READS": {
      const now = new Date();
      const ym = new Set();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        ym.add(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        );
      }
      const c = books.filter(
        (b) => b.finishedAt && ym.has(b.finishedAt.slice(0, 7)),
      ).length;
      return c >= (rule.gte || 0);
    }
    case "MONTH_DISTINCT_DAYS": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const days = new Set(
        books
          .filter((b) => (b.finishedAt || "").startsWith(ym))
          .map((b) => b.finishedAt),
      );
      return days.size >= (rule.gte || 0);
    }
    case "MONTH_EACH_WEEK_HAS_READ": {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      let ok = true;
      for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 7)) {
        const wr = weekRange(d, ctx?.stats?.startOfWeek || "mon");
        const exist = books.some(
          (b) =>
            b.finishedAt &&
            inRange(new Date(b.finishedAt), wr.start, wr.end) &&
            new Date(b.finishedAt + "T00:00:00").getMonth() === m,
        );
        if (!exist) {
          ok = false;
          break;
        }
      }
      return ok;
    }
    case "MONTH_READS_BY_MONTH": {
      const year = new Date().getFullYear();
      const mm = `${year}-${String(rule.month).padStart(2, "0")}`;
      const c = books.filter((b) => (b.finishedAt || "").startsWith(mm)).length;
      return c >= (rule.gte || 0);
    }
    case "REREAD_FROM_FIRST_DAYS": {
      const map = groupByTitleFinishes(books);
      for (const arr of map.values()) {
        if (arr.length < 2) continue;
        const diff = Math.round(
          (new Date(arr[arr.length - 1].finishedAt + "T00:00:00") -
            new Date(arr[0].finishedAt + "T00:00:00")) /
            86400000,
        );
        if (rule.lteDays != null && diff <= rule.lteDays) return true;
        if (rule.gteDays != null && diff >= rule.gteDays) return true;
      }
      return false;
    }
    case "LAST_5_ALL_DIFFERENT": {
      const seq = books
        .filter((b) => b.finishedAt)
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
        .slice(-5);
      if (seq.length < 5) return false;
      return new Set(seq.map((b) => b.author || "")).size === 5;
    }
    case "MONTH_AUTHOR_3_SAME": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const cnt = {};
      books
        .filter((b) => (b.finishedAt || "").startsWith(ym))
        .forEach((b) => {
          const k = b.author || "";
          if (!k) return;
          cnt[k] = (cnt[k] || 0) + 1;
        });
      return Object.values(cnt).some((v) => v >= 3);
    }
    case "SAME_AUTHOR_SAME_DAY": {
      const map = new Map();
      for (const b of books) {
        if (!b.finishedAt || !b.author) continue;
        const key = b.finishedAt + "#" + b.author;
        map.set(key, (map.get(key) || 0) + 1);
      }
      return [...map.values()].some((v) => v >= 2);
    }
    case "MONTH_ALL_FIRST_AUTHORS": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthBooks = books.filter((b) =>
        (b.finishedAt || "").startsWith(ym),
      );
      if (!monthBooks.length) return false;
      const seenBefore = new Set(
        books
          .filter((b) => b.finishedAt && b.finishedAt < ym + "-01")
          .map((b) => b.author || ""),
      );
      return monthBooks.every((b) => b.author && !seenBefore.has(b.author));
    }
    case "LONG_AUTHOR_NAME": {
      return books.some((b) => (b.author || "").length >= (rule.gte || 10));
    }
    case "MONTH_RATING_BOTH": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let has1 = false,
        has5 = false;
      for (const b of books) {
        if (
          (b.finishedAt || "").startsWith(ym) &&
          typeof b.rating === "number"
        ) {
          if (b.rating === 1) has1 = true;
          if (b.rating === 5) has5 = true;
        }
      }
      return has1 && has5;
    }
    case "USER_ACTION": {
      // ctx.stats.actions内のカウンタを参照
      const a = ctx?.stats?.actions || {};
      const key = rule.event;
      if (!key) return false;
      const v = a[key] || 0;
      return v >= (rule.gte || 1);
    }
    case "EDIT_SAME_BOOK_GTE": {
      const a = ctx?.stats?.actions || {};
      const m = a.editCounts || {};
      return Object.values(m).some((n) => n >= (rule.gte || 3));
    }
    case "MONTH_STREAK": {
      // 連続する「月」（少なくとも1冊読了）の最大長
      const months = Array.from(
        new Set(
          books
            .filter((b) => b.finishedAt)
            .map((b) => b.finishedAt.slice(0, 7)),
        ),
      ).sort();
      if (!months.length) return false;
      // 文字列比較で連続月を判定
      let max = 1,
        cur = 1;
      function nextMonthStr(ym) {
        const y = Number(ym.slice(0, 4)),
          m = Number(ym.slice(5, 7));
        const d = new Date(y, m - 1, 1);
        d.setMonth(d.getMonth() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      for (let i = 1; i < months.length; i++) {
        if (months[i] === nextMonthStr(months[i - 1])) cur += 1;
        else {
          max = Math.max(max, cur);
          cur = 1;
        }
      }
      max = Math.max(max, cur);
      return max >= (rule.gte || 12);
    }
    case "REVIEW_NEWLINES": {
      const needGte = rule.gte;
      const needLte = rule.lte;
      return books.some((b) => {
        const t = b.reviewText || "";
        const nl = (t.match(/\n/g) || []).length;
        if (needGte != null && nl < needGte) return false;
        if (needLte != null && nl > needLte) return false;
        return t.length > 0 || needLte === 0; // allow empty when lte 0
      });
    }
    case "LAST_N_AUTHORS_ALL_DIFFERENT": {
      const n = rule.n || 5;
      const seq = books
        .filter((b) => b.finishedAt)
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
        .slice(-n);
      if (seq.length < n) return false;
      return new Set(seq.map((b) => b.author || "")).size === n;
    }
    default:
      return false;
  }
}

// 連続日（finishedAt）最大値の算出
function computeStreak(books) {
  const days = new Set(
    books.filter((b) => b.finishedAt).map((b) => b.finishedAt),
  );
  if (days.size === 0) return { current: 0, max: 0 };
  const arr = Array.from(days).sort();
  let max = 1;
  let cur = 1;
  for (let i = 1; i < arr.length; i++) {
    if (isNextDay(arr[i - 1], arr[i])) cur += 1;
    else {
      max = Math.max(max, cur);
      cur = 1;
    }
  }
  max = Math.max(max, cur);
  // currentは今日からの連続
  const today = toDateISO(new Date());
  let current = 0;
  let d = today;
  while (days.has(d)) {
    current += 1;
    d = prevISO(d);
  }
  return { current, max };
}

function isNextDay(prev, next) {
  const p = new Date(prev + "T00:00:00");
  const n = new Date(next + "T00:00:00");
  return (n - p) / 86400000 === 1;
}
function toDateISO(d) {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}
function prevISO(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return toDateISO(d);
}

function weekRange(ref, startOfWeek = "mon") {
  const dow0Sun = ref.getDay();
  // mon=0..sun=6
  const dow = startOfWeek === "sun" ? (dow0Sun + 6) % 7 : (dow0Sun + 6) % 7;
  const start = new Date(
    ref.getFullYear(),
    ref.getMonth(),
    ref.getDate() - dow,
  );
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 6,
  );
  return { start, end };
}

function inRange(d, start, end) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return x >= start && x <= end;
}

function groupByTitleFinishes(books) {
  const byDate = books
    .filter((b) => b.finishedAt)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const map = new Map();
  for (const b of byDate) {
    const key = (b.title || "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  return map;
}

function matchOneLiner(s, p) {
  if (p.empty) return s.trim().length === 0;
  if (p.maxLen != null && s.length > p.maxLen) return false;
  if (p.exactLen != null && s.length !== p.exactLen) return false;
  if (p.noPeriod && /[。．\.]/.test(s.slice(-1))) return false;
  if (p.hasQuotes && !/["'『』“”]/.test(s)) return false;
  if (p.hasQuestion && !s.includes("？") && !s.includes("?")) return false;
  if (p.hasExclamation && !s.includes("！") && !s.includes("!")) return false;
  if (p.hasEllipsis && !s.includes("…")) return false;
  if (p.hasDigit && !/[0-9０-９]/.test(s)) return false;
  if (p.hasAscii && !/[A-Za-z]/.test(s)) return false;
  return true;
}

function matchDatePattern(b, rule) {
  if (!b.finishedAt) return false;
  const d = new Date(b.finishedAt + "T00:00:00");
  if (rule.weekday) {
    const map = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
    if (
      d.getDay() !==
      (rule.weekday === "mon"
        ? 1
        : rule.weekday === "sun"
          ? 0
          : map[rule.weekday])
    )
      return false;
  }
  if (rule.firstOfMonth && d.getDate() !== 1) return false;
  if (rule.lastOfMonth) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() !== last) return false;
  }
  if (rule.monthEquals != null) {
    if (d.getMonth() + 1 !== rule.monthEquals) return false;
  }
  if (rule.weekend) {
    if (d.getDay() !== 0 && d.getDay() !== 6) return false;
  }
  return true;
}

function matchReadSpeed(b, rule) {
  if (!b.startedAt || !b.finishedAt) return false;
  const s = new Date(b.startedAt + "T00:00:00");
  const f = new Date(b.finishedAt + "T00:00:00");
  const days = Math.round((f - s) / 86400000);
  if (rule.sameDay && days === 0) return true;
  if (rule.lteDays != null && days <= rule.lteDays) return true;
  if (rule.gteDays != null && days >= rule.gteDays) return true;
  if (rule.weekendCross) {
    // 土曜開始→日曜読了
    return s.getDay() === 6 && f.getDay() === 0;
  }
  if (rule.sameDayFinishesGte) {
    // 同日読了冊数>=n は本単体では判定できないため、false（別型で集計）
    return false;
  }
  return false;
}
