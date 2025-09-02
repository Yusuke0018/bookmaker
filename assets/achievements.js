// achievements.js: 定義の読込と最小ルール評価（TOTAL_READSのみ）
import { getAllAchState, putAchState } from "./db.js";

let defsCache = null; // [{id,name,rule,...}]

export async function loadAchievementDefs() {
  if (defsCache) return defsCache;
  const res = await fetch("./assets/achievements.json", { cache: "no-cache" });
  defsCache = await res.json();
  return defsCache;
}

export async function evaluateAndSave(books) {
  const defs = await loadAchievementDefs();
  const state = await getAllAchState();
  const acquired = new Set(state.map((s) => s.id));
  const newly = [];
  for (const d of defs) {
    if (acquired.has(d.id)) continue;
    if (rulePass(d.rule, books)) {
      const entry = { id: d.id, acquiredAt: new Date().toISOString() };
      await putAchState(entry);
      newly.push(d);
    }
  }
  return newly; // [{id,name,...}]
}

function rulePass(rule, books) {
  switch (rule?.type) {
    case "TOTAL_READS": {
      const count = books.filter((b) => !!b.finishedAt).length;
      return typeof rule.gte === "number" ? count >= rule.gte : false;
    }
    case "STREAK_DAYS": {
      const { max } = computeStreak(books);
      return typeof rule.gte === "number" ? max >= rule.gte : false;
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
