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
    default:
      return false;
  }
}
