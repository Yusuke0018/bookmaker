// ui.js: ルーティングとUIの最小実装
import {
  createBook,
  loadBooks,
  searchBooks,
  todayISO,
  updateBook,
  deleteBook,
} from "./app.js";
import { evaluateAndSave, loadAchievementDefs } from "./achievements.js";

const views = {
  home: document.getElementById("view-home"),
  calendar: document.getElementById("view-calendar"),
  add: document.getElementById("view-add"),
  achievements: document.getElementById("view-achievements"),
};

const tabs = {
  home: document.getElementById("tab-home"),
  calendar: document.getElementById("tab-calendar"),
  add: document.getElementById("tab-add"),
  achievements: document.getElementById("tab-achievements"),
};

function route() {
  const hash = (location.hash || "#home").replace("#", "");
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle("active", k === hash);
  });
  Object.entries(tabs).forEach(([k, el]) => {
    el.classList.toggle("active", k === hash);
  });
  if (hash === "home") renderHome();
  if (hash === "calendar") renderCalendar();
  if (hash === "achievements") renderAchievements();
}

window.addEventListener("hashchange", route);
window.addEventListener("load", () => {
  route();
  initForm();
  initHomeSearch();
  initCalendar();
  // 事前に称号定義を読み込んでおく
  loadAchievementDefs().catch(() => {});
  const rel = document.getElementById("reload-ach");
  rel?.addEventListener("click", () => renderAchievements());
});

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2200);
}

// Home
async function renderHome() {
  const list = document.getElementById("recent-list");
  const books = await loadBooks();
  list.innerHTML = books
    .map((b) => {
      const date = b.finishedAt || b.startedAt || b.createdAt.slice(0, 10);
      const one = b.oneLiner
        ? `<span class="badge">${escapeHtml(b.oneLiner)}</span>`
        : "";
      const star = typeof b.rating === "number" ? ` ★${b.rating}` : "";
      const actions = `<div class="row gap" style="margin-top:6px"><button class="btn small" data-edit="${b.id}">編集</button><button class="btn small outline" data-del="${b.id}">削除</button></div>`;
      return `<li><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}${star}<br><span class="muted">${date}</span> ${one}${actions}</li>`;
    })
    .join("");
  // 日替わり再会（単純なhashで選択）
  const reunionWrap = document.getElementById("reunion-card");
  if (books.length) {
    const idx =
      (new Date().getFullYear() * 10000 +
        new Date().getMonth() * 100 +
        new Date().getDate()) %
      books.length;
    const b = books[idx];
    document.getElementById("reunion").innerHTML =
      `<div><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}</div>`;
    reunionWrap.hidden = false;
  } else {
    reunionWrap.hidden = true;
  }

  // アクション（編集・削除）
  list.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () =>
      enterEditMode(btn.getAttribute("data-edit")),
    );
  });
  list.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("この本を削除します。よろしいですか？")) return;
      await deleteBook(id);
      showToast("削除も勇気。綴じ直しました。");
      renderHome();
    });
  });
}

function initHomeSearch() {
  const q = document.getElementById("q");
  q.addEventListener("input", async () => {
    const results = await searchBooks(q.value);
    const list = document.getElementById("recent-list");
    list.innerHTML = results
      .map(
        (b) =>
          `<li><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}</li>`,
      )
      .join("");
  });
}

// Add
function initForm() {
  const form = document.getElementById("book-form");
  const saveContinue = document.getElementById("save-continue");
  const markToday = document.getElementById("mark-finished-today");
  // 既定：開始日を今日
  form.startedAt.value = todayISO();
  markToday.addEventListener("click", () => {
    form.finishedAt.value = todayISO();
  });
  const handleSubmit = async (cont = false) => {
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = {
      title: data.get("title"),
      author: data.get("author"),
      startedAt: data.get("startedAt"),
      finishedAt: data.get("finishedAt"),
      oneLiner: data.get("oneLiner"),
      reviewText: data.get("reviewText"),
      rating: parseNumber(data.get("rating")),
    };
    if (form.dataset.mode === "edit" && form.dataset.id) {
      await updateBook(form.dataset.id, payload);
      showToast("更新しました。紙背が整いました。");
    } else {
      await createBook(payload);
      showToast("綴じました。次のページへ。");
    }
    // 称号評価（最小: TOTAL_READS）
    try {
      const books = await loadBooks();
      const newly = await evaluateAndSave(books);
      if (newly.length) {
        newly.forEach((d) => showToast(`${d.name}：${d.description}`));
      }
    } catch {}
    await renderHome();
    if (cont && form.dataset.mode !== "edit") {
      form.reset();
      form.startedAt.value = todayISO();
      form.title.focus();
    } else {
      clearEditMode();
      location.hash = "#home";
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSubmit(false);
  });
  saveContinue.addEventListener("click", () => handleSubmit(true));
}

function parseNumber(v) {
  const n = Number(v);
  return isFinite(n) && v !== "" ? n : undefined;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function enterEditMode(id) {
  const list = await loadBooks();
  const b = list.find((x) => x.id === id);
  if (!b) return;
  const form = document.getElementById("book-form");
  form.dataset.mode = "edit";
  form.dataset.id = b.id;
  form.title.value = b.title;
  form.author.value = b.author;
  form.startedAt.value = b.startedAt || "";
  form.finishedAt.value = b.finishedAt || "";
  form.oneLiner.value = b.oneLiner || "";
  form.reviewText.value = b.reviewText || "";
  form.rating.value = typeof b.rating === "number" ? String(b.rating) : "";
  location.hash = "#add";
}

function clearEditMode() {
  const form = document.getElementById("book-form");
  delete form.dataset.mode;
  delete form.dataset.id;
}

// Calendar
let calYear;
let calMonth; // 1-12

function initCalendar() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth() + 1;
  const prev = document.getElementById("cal-prev");
  const next = document.getElementById("cal-next");
  prev?.addEventListener("click", () => moveMonth(-1));
  next?.addEventListener("click", () => moveMonth(1));
}

function moveMonth(delta) {
  calMonth += delta;
  if (calMonth <= 0) {
    calMonth = 12;
    calYear -= 1;
  } else if (calMonth >= 13) {
    calMonth = 1;
    calYear += 1;
  }
  renderCalendar();
}

async function renderCalendar() {
  const label = document.getElementById("cal-label");
  const grid = document.getElementById("cal-grid");
  const ul = document.getElementById("cal-day-ul");
  if (!label || !grid || !ul) return;
  label.textContent = `${calYear}年 ${calMonth}月`;

  const books = await loadBooks();
  const counts = new Map(); // key: yyyy-mm-dd -> count
  const listByDay = new Map();
  for (const b of books) {
    if (!b.finishedAt) continue; // 読了日のみ集計
    const y = Number(b.finishedAt.slice(0, 4));
    const m = Number(b.finishedAt.slice(5, 7));
    if (y === calYear && m === calMonth) {
      const key = b.finishedAt;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!listByDay.has(key)) listByDay.set(key, []);
      listByDay.get(key).push(b);
    }
  }

  // 月初の曜日（月曜=1...日曜=7）
  const first = new Date(calYear, calMonth - 1, 1);
  let w = first.getDay(); // 0-6 (Sun-Sat)
  w = w === 0 ? 7 : w; // 1-7
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const cells = [];
  // 先頭の空白（週始まり: 月曜）
  for (let i = 1; i < w; i++) cells.push({ empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const c = counts.get(key) || 0;
    cells.push({ date: d, key, count: c });
  }

  const max = Math.max(0, ...[...counts.values()]);
  const level = (c) =>
    c === 0 ? 0 : Math.min(5, 1 + Math.floor((c / Math.max(1, max)) * 4));
  grid.innerHTML = cells
    .map((cell) => {
      if (cell.empty)
        return `<div class="cal-cell" style="visibility:hidden"></div>`;
      const lv = level(cell.count);
      return `<div class="cal-cell level-${lv}" data-key="${cell.key}"><div class="date">${cell.date}</div><div class="count">${cell.count}</div></div>`;
    })
    .join("");

  // クリックで当日の一覧
  grid.querySelectorAll(".cal-cell[data-key]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.getAttribute("data-key");
      const items = listByDay.get(key) || [];
      ul.innerHTML = items
        .map(
          (b) =>
            `<li><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}</li>`,
        )
        .join("");
    });
  });

  // 合計ラベル
  const totalMonth = [...counts.values()].reduce((a, b) => a + b, 0);
  const now = new Date();
  const weekInfo = weekRange(now);
  const year = now.getFullYear();
  const totalWeek = books.filter(
    (b) =>
      b.finishedAt &&
      inRange(new Date(b.finishedAt), weekInfo.start, weekInfo.end),
  ).length;
  const totalYear = books.filter(
    (b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === year,
  ).length;
  const summary = document.getElementById("cal-summary");
  if (summary)
    summary.textContent = `今週 ${totalWeek} / 今月 ${totalMonth} / 今年 ${totalYear}`;
}

function inRange(d, start, end) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return x >= start && x <= end;
}

function weekRange(ref) {
  // 月曜は0オフセット、日曜=6として週開始を算出
  const dow = (ref.getDay() + 6) % 7; // Mon=0..Sun=6
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

// Achievements view
async function renderAchievements() {
  const listEl = document.getElementById("ach-list");
  if (!listEl) return;
  const defs = await loadAchievementDefs();
  // 現在取得済み（achState）はDBから読み、id集合化
  // ここでは ui.js からは直接参照しないため、評価時に取得済みが更新される想定。
  // 最新状態を反映するため、evaluateAndSaveの副作用後のレンダリングが望ましい。
  // 簡易的に、いまのbooksから再評価を走らせ、achStateを更新してから描画する。
  try {
    const books = await loadBooks();
    await evaluateAndSave(books);
  } catch {}
  // achState一覧を再取得したいが、ここでは簡易表示として、達成済みはローカルにトーストで把握済みとし、
  // 一旦すべて未達成扱い→将来拡張で色付け更新
  // 当面は総数とターゲット提示のみ行う。
  listEl.innerHTML = defs
    .map(
      (d) =>
        `<div class="ach-item"><div class="name">${escapeHtml(d.name)}</div><div class="desc">${escapeHtml(d.description)}</div></div>`,
    )
    .join("");
}
