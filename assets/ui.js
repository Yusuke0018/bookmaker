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
import { getStats, putStats, rebuildStats } from "./stats.js";
import { loadSettings, saveSettings, applyTheme } from "./settings.js";
import { getAllAchState } from "./db.js";

const NAV_ORDER = ["home", "calendar", "add", "achievements", "settings"];

const views = {
  home: document.getElementById("view-home"),
  calendar: document.getElementById("view-calendar"),
  add: document.getElementById("view-add"),
  achievements: document.getElementById("view-achievements"),
  settings: document.getElementById("view-settings"),
  detail: document.getElementById("view-detail"),
};

const tabs = {
  home: document.getElementById("tab-home"),
  calendar: document.getElementById("tab-calendar"),
  add: document.getElementById("tab-add"),
  achievements: document.getElementById("tab-achievements"),
  settings: document.getElementById("tab-settings"),
};

let lastMainView = "home";
function route() {
  const raw = (location.hash || "#home").slice(1);
  let hash = raw;
  let bookId = null;
  if (raw.startsWith("book:")) {
    hash = "detail";
    bookId = decodeURIComponent(raw.slice(5));
  }
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle("active", k === hash);
  });
  Object.entries(tabs).forEach(([k, el]) => {
    el.classList.toggle("active", k === hash);
  });
  if (hash !== "detail") lastMainView = hash;
  if (hash === "home") renderHome();
  if (hash === "calendar") renderCalendar();
  if (hash === "achievements") renderAchievements();
  if (hash === "settings") renderSettings();
  if (hash === "detail" && bookId) renderDetail(bookId);
}

window.addEventListener("hashchange", route);
window.addEventListener("load", () => {
  route();
  initForm();
  initHomeSearch();
  initCalendar();
  // 事前に称号定義を読み込んでおく
  loadAchievementDefs().catch(() => {});
  // 設定の適用
  loadSettings()
    .then((s) => applyTheme(s.theme))
    .catch(() => {});
  const rel = document.getElementById("reload-ach");
  rel?.addEventListener("click", () => renderAchievements());
  const btnExp = document.getElementById("btn-export");
  const btnImp = document.getElementById("btn-import");
  const fileImp = document.getElementById("file-import");
  btnExp?.addEventListener("click", exportJson);
  btnImp?.addEventListener("click", () => fileImp?.click());
  fileImp?.addEventListener("change", importJson);
  // 画面下（メインコンテンツ）でスワイプしてタブ移動（ループ）
  attachSwipeTabs(document.body);
  // 設定フォーム
  const sf = document.getElementById("settings-form");
  sf?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(sf);
    const s = {
      theme: data.get("theme"),
      startOfWeek: data.get("startOfWeek"),
      sound: data.get("sound") === "true",
    };
    await saveSettings(s);
    applyTheme(s.theme);
    const stats = await getStats();
    stats.actions.settingsSaved = (stats.actions.settingsSaved || 0) + 1;
    await putStats(stats);
    await evaluateAfterEvent("settings");
    showToast("設定を保存しました。");
  });
  // テーマ選択の即時反映
  const themeSel = sf?.querySelector('select[name="theme"]');
  themeSel?.addEventListener("change", async () => {
    const theme = themeSel.value;
    applyTheme(theme);
    const s = await loadSettings();
    await saveSettings({ ...s, theme });
  });
  // キャッシュ削除ボタン
  const btnClear = document.getElementById("btn-clear-cache");
  btnClear?.addEventListener("click", async () => {
    try {
      if (
        confirm(
          "オフラインキャッシュとService Workerを削除します。よろしいですか？",
        )
      ) {
        const regs = await navigator.serviceWorker?.getRegistrations?.();
        if (regs) await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        showToast("キャッシュを削除しました。ページを再読み込みします。");
        setTimeout(() => location.reload(), 500);
      }
    } catch {}
  });
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
  const qel = document.getElementById("quote");
  if (qel) qel.textContent = pickDailyQuote();
  list.innerHTML = books
    .map((b) => {
      const date = b.finishedAt || b.startedAt || b.createdAt.slice(0, 10);
      const one = b.oneLiner
        ? `<span class="badge">${escapeHtml(b.oneLiner)}</span>`
        : "";
      const star = typeof b.rating === "number" ? ` ★${b.rating}` : "";
      const actions = `<div class="row gap" style="margin-top:6px"><button class="btn small" data-edit="${b.id}">編集</button><button class="btn small outline" data-del="${b.id}">削除</button></div>`;
      return `<li data-id="${b.id}"><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}${star}<br><span class="muted">${date}</span> ${one}${actions}</li>`;
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
    const r = document.getElementById("reunion");
    r.innerHTML = `<div><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}</div>`;
    r.dataset.id = b.id;
    r.style.cursor = "pointer";
    r.onclick = () => {
      location.hash = `#book:${encodeURIComponent(b.id)}`;
    };
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
      const stats = await getStats();
      stats.actions.deleteCount = (stats.actions.deleteCount || 0) + 1;
      await putStats(stats);
      await evaluateAfterEvent("delete");
      renderHome();
    });
  });
  // 行（ボタン以外）タップで詳細へ
  list.addEventListener("click", (e) => {
    if (e.target.closest("button")) return; // ボタンは除外
    const li = e.target.closest("li");
    if (!li) return;
    const editBtn = li.querySelector("button[data-edit]");
    const id = editBtn?.getAttribute("data-edit");
    if (id) location.hash = `#book:${encodeURIComponent(id)}`;
  });
  // 行クリックで詳細（ボタン以外）
  list.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    location.hash = `#book:${encodeURIComponent(li.getAttribute("data-id"))}`;
  });
}

function initHomeSearch() {
  const q = document.getElementById("q");
  q.addEventListener("input", async () => {
    const results = await searchBooks(q.value);
    if (q.value && q.value !== q.dataset.prev) {
      const stats = await getStats();
      stats.actions.searchCount = (stats.actions.searchCount || 0) + 1;
      await putStats(stats);
      q.dataset.prev = q.value;
      await evaluateAfterEvent("search");
    }
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
  markToday.addEventListener("click", async () => {
    form.finishedAt.value = todayISO();
    // 「今日で読了」時は即保存して編集画面を閉じる
    await handleSubmit(false);
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
      const stats = await getStats();
      stats.actions.editCounts[form.dataset.id] =
        (stats.actions.editCounts[form.dataset.id] || 0) + 1;
      if (typeof payload.rating === "number")
        stats.actions.rateCount = (stats.actions.rateCount || 0) + 1;
      await putStats(stats);
    } else {
      await createBook(payload);
      showToast("綴じました。次のページへ。");
      const stats = await getStats();
      if ((payload.startedAt || "") === todayISO())
        stats.actions.fastCreateCount =
          (stats.actions.fastCreateCount || 0) + 1;
      if (typeof payload.rating === "number")
        stats.actions.rateCount = (stats.actions.rateCount || 0) + 1;
      await putStats(stats);
    }
    await evaluateAfterEvent("createOrEdit");
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

function pickDailyQuote() {
  const quotes = [
    "本は心の鏡。今日の自分に一節を。",
    "読み終わりは始まりの合図。",
    "一行の発見が、一日の景色を変える。",
    "迷ったら、本棚へ。",
    "手のひらサイズの旅支度。",
  ];
  const d = new Date();
  const idx =
    (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) %
    quotes.length;
  return quotes[idx];
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

async function renderDetail(id) {
  const books = await loadBooks();
  const b = books.find((x) => x.id === id);
  const title = document.getElementById("detail-title");
  const meta = document.getElementById("detail-meta");
  const rating = document.getElementById("detail-rating");
  const one = document.getElementById("detail-one");
  const review = document.getElementById("detail-review");
  const btnEdit = document.getElementById("btn-detail-edit");
  const btnBack = document.getElementById("btn-detail-back");
  const backTarget = ["home", "calendar", "achievements", "settings"].includes(
    lastMainView,
  )
    ? `#${lastMainView}`
    : "#home";
  if (!b) {
    title.textContent = "詳細";
    meta.textContent = "見つかりませんでした";
    rating.textContent = "";
    one.textContent = "";
    review.textContent = "";
    btnEdit.onclick = null;
    btnBack.onclick = () => (location.hash = backTarget);
    return;
  }
  title.textContent = b.title;
  const metaParts = [];
  metaParts.push(`著者：${escapeHtml(b.author || "")}`);
  if (b.startedAt) metaParts.push(`開始：${b.startedAt}`);
  if (b.finishedAt) metaParts.push(`読了：${b.finishedAt}`);
  meta.innerHTML = metaParts.join(" / ");
  rating.textContent =
    typeof b.rating === "number"
      ? `評価：${"★".repeat(b.rating)}${"☆".repeat(5 - b.rating)}`
      : "";
  one.innerHTML = b.oneLiner
    ? `<strong>一言まとめ：</strong>${escapeHtml(b.oneLiner)}`
    : "";
  review.innerHTML = b.reviewText
    ? `<strong>感想</strong><div>${escapeHtml(b.reviewText).replace(/\n/g, "<br>")}</div>`
    : "";
  btnEdit.onclick = () => enterEditMode(b.id);
  btnBack.onclick = () => (location.hash = backTarget);
}

async function renderSettings() {
  const sf = document.getElementById("settings-form");
  if (!sf) return;
  const s = await loadSettings();
  sf.theme.value = s.theme;
  sf.startOfWeek.value = s.startOfWeek;
  sf.sound.value = String(!!s.sound);
}

async function evaluateAfterEvent(event) {
  try {
    const books = await loadBooks();
    const stats = await rebuildStats(books);
    const prev = await getStats();
    stats.actions = { ...prev.actions };
    await putStats(stats);
    const newly = await evaluateAndSave(books, { stats, event });
    if (newly.length) {
      newly.forEach((d) => {
        showToast(`${d.name}：${d.description}`);
        if (["A007", "A009", "A025"].includes(d.id))
          try {
            confetti(1000);
          } catch {}
      });
    }
  } catch {}
}

function confetti(duration = 1000) {
  const c = document.createElement("canvas");
  c.style.position = "fixed";
  c.style.left = "0";
  c.style.top = "0";
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.pointerEvents = "none";
  c.width = innerWidth;
  c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  const N = 120,
    parts = Array.from({ length: N }, () => ({
      x: Math.random() * c.width,
      y: -Math.random() * c.height,
      vy: 2 + Math.random() * 3,
      vx: -2 + Math.random() * 4,
      size: 4 + Math.random() * 6,
      color: `hsl(${Math.random() * 360},90%,60%)`,
    }));
  let start = performance.now();
  function step(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y > c.height) p.y = -10;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    if (t - start < duration) requestAnimationFrame(step);
    else document.body.removeChild(c);
  }
  requestAnimationFrame(step);
}

// Calendar
let calYear;
let calMonth; // 1-12
let calMode = "month"; // month | week | year

function initCalendar() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth() + 1;
  const prev = document.getElementById("cal-prev");
  const next = document.getElementById("cal-next");
  prev?.addEventListener("click", () => moveMonth(-1));
  next?.addEventListener("click", () => moveMonth(1));
  const mMonth = document.getElementById("mode-month");
  const mWeek = document.getElementById("mode-week");
  const mYear = document.getElementById("mode-year");
  mMonth?.addEventListener("click", () => setMode("month"));
  mWeek?.addEventListener("click", () => setMode("week"));
  mYear?.addEventListener("click", () => setMode("year"));

  // カレンダー内スワイプはタブ移動に一元化するため無効化
}

function moveMonth(delta) {
  if (calMode === "year") {
    calYear += delta;
  } else {
    calMonth += delta;
    if (calMonth <= 0) {
      calMonth = 12;
      calYear -= 1;
    } else if (calMonth >= 13) {
      calMonth = 1;
      calYear += 1;
    }
  }
  renderCalendar();
}

async function renderCalendar() {
  const label = document.getElementById("cal-label");
  if (!label) return;
  const wrapMonth = document.getElementById("cal-month");
  const wrapWeek = document.getElementById("cal-week");
  const wrapYear = document.getElementById("cal-year");
  if (calMode === "week") {
    if (wrapMonth) wrapMonth.hidden = true;
    if (wrapYear) wrapYear.hidden = true;
    if (wrapWeek) wrapWeek.hidden = false;
    const wr = weekRange(new Date());
    label.textContent = `${wr.start.getMonth() + 1}/${wr.start.getDate()} - ${wr.end.getMonth() + 1}/${wr.end.getDate()}`;
    await renderWeekInner();
    return;
  }
  if (calMode === "year") {
    if (wrapMonth) wrapMonth.hidden = true;
    if (wrapWeek) wrapWeek.hidden = true;
    if (wrapYear) wrapYear.hidden = false;
    label.textContent = `${calYear}年`;
    await renderYearInner();
    return;
  }
  if (wrapMonth) wrapMonth.hidden = false;
  if (wrapWeek) wrapWeek.hidden = true;
  if (wrapYear) wrapYear.hidden = true;
  label.textContent = `${calYear}年 ${calMonth}月`;
  await renderMonthInner();
}

async function renderMonthInner() {
  const grid = document.getElementById("cal-grid");
  const ul = document.getElementById("cal-day-ul");
  if (!grid || !ul) return;
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
            `<li data-id="${b.id}"><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}</li>`,
        )
        .join("");
    });
  });
  // 選択日のリストから詳細へ
  ul.onclick = (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const id = li.getAttribute("data-id");
    location.hash = `#book:${encodeURIComponent(id)}`;
  };

  // 合計ラベルを更新
  const totalMonth = [...counts.values()].reduce((a, b) => a + b, 0);
  updateCalSummary(books, totalMonth);
}

async function updateCalSummary(books, totalMonth) {
  const now = new Date();
  const s = await loadSettings().catch(() => ({ startOfWeek: "mon" }));
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

async function renderWeekInner() {
  const ul = document.getElementById("cal-week-ul");
  if (!ul) return;
  const books = await loadBooks();
  const wr = weekRange(new Date());
  const arr = books.filter(
    (b) => b.finishedAt && inRange(new Date(b.finishedAt), wr.start, wr.end),
  );
  const map = new Map(); // dow -> list
  arr.forEach((b) => {
    const d = new Date(b.finishedAt + "T00:00:00");
    const dow = (d.getDay() + 6) % 7; // Mon..Sun
    if (!map.has(dow)) map.set(dow, []);
    map.get(dow).push(b);
  });
  const labels = ["月", "火", "水", "木", "金", "土", "日"];
  ul.innerHTML = labels
    .map((lab, i) => {
      const items = map.get(i) || [];
      const li = items
        .map(
          (b) =>
            `<div data-id="${b.id}"><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author)}</div>`,
        )
        .join("");
      return `<li><span class="badge">${lab}</span> (${items.length})<br>${li}</li>`;
    })
    .join("");
  // 週一覧から詳細へ
  ul.onclick = (e) => {
    const el = e.target.closest("[data-id]");
    if (!el) return;
    const id = el.getAttribute("data-id");
    location.hash = `#book:${encodeURIComponent(id)}`;
  };
  updateCalSummary(books, arr.length);
}

async function renderYearInner() {
  const bars = document.getElementById("year-bars");
  if (!bars) return;
  const books = await loadBooks();
  const months = Array(12).fill(0);
  for (const b of books) {
    if (!b.finishedAt) continue;
    const y = Number(b.finishedAt.slice(0, 4));
    const m = Number(b.finishedAt.slice(5, 7));
    if (y === calYear) months[m - 1] += 1;
  }
  const max = Math.max(1, ...months);
  bars.innerHTML = months
    .map((cnt, idx) => {
      const h = Math.max(4, Math.round((cnt / max) * 140));
      const mo = idx + 1;
      return `<div class="bar"><div class="col" style="height:${h}px"></div><div class="label">${mo}月<br>${cnt}</div></div>`;
    })
    .join("");
  updateCalSummary(
    books,
    months.reduce((a, b) => a + b, 0),
  );
}

function setMode(mode) {
  calMode = mode;
  ["mode-month", "mode-week", "mode-year"].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.setAttribute("aria-pressed", id === `mode-${mode}` ? "true" : "false");
  });
  renderCalendar();
}

function attachSwipeNavigation(container) {
  let sx = 0,
    sy = 0,
    dx = 0,
    dy = 0,
    tracking = false;
  const onStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    // 入力要素上でのスワイプは無視
    const tg = e.target;
    if (tg && tg.closest && tg.closest("input, textarea, select, button, a, label")) {
      tracking = false;
      return;
    }
    tracking = true;
    sx = t.clientX;
    sy = t.clientY;
    dx = dy = 0;
  };
  const onMove = (e) => {
    if (!tracking) return;
    const t = e.touches?.[0];
    if (!t) return;
    dx = t.clientX - sx;
    dy = t.clientY - sy;
  };
  const onEnd = () => {
    if (!tracking) return;
    tracking = false;
    // 水平方向が優位かつ一定距離以上
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) moveMonth(1);
      else moveMonth(-1);
    }
  };
  container.addEventListener("touchstart", onStart, { passive: true });
  container.addEventListener("touchmove", onMove, { passive: true });
  container.addEventListener("touchend", onEnd, { passive: true });
  // Pointer events fallback (一部端末でtouchが発火しない場合)
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return; // マウス操作は無視
      startPointer(e);
    },
    { passive: true },
  );
  container.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "mouse") return;
      movePointer(e);
    },
    { passive: true },
  );
  container.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType === "mouse") return;
      onEnd();
    },
    { passive: true },
  );

  function startPointer(e) {
    tracking = true;
    sx = e.clientX;
    sy = e.clientY;
    dx = dy = 0;
  }
  function movePointer(e) {
    if (!tracking) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
  }
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

// --- Swipe tabs on header (loop over NAV_ORDER) ---
function attachSwipeTabs(container) {
  let sx = 0,
    sy = 0,
    dx = 0,
    dy = 0,
    tracking = false;
  const onStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    tracking = true;
    sx = t.clientX;
    sy = t.clientY;
    dx = dy = 0;
  };
  const onMove = (e) => {
    if (!tracking) return;
    const t = e.touches?.[0];
    if (!t) return;
    dx = t.clientX - sx;
    dy = t.clientY - sy;
  };
  const onEnd = () => {
    if (!tracking) return;
    tracking = false;
    const raw = (location.hash || "#home").slice(1);
    if (!NAV_ORDER.includes(raw)) return; // detail等は対象外
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const idx = NAV_ORDER.indexOf(raw);
      const next =
        dx < 0
          ? (idx + 1) % NAV_ORDER.length
          : (idx - 1 + NAV_ORDER.length) % NAV_ORDER.length;
      location.hash = `#${NAV_ORDER[next]}`;
    }
  };
  container.addEventListener("touchstart", onStart, { passive: true });
  container.addEventListener("touchmove", onMove, { passive: true });
  container.addEventListener("touchend", onEnd, { passive: true });
}

// Achievements view
async function renderAchievements() {
  const listEl = document.getElementById("ach-list");
  if (!listEl) return;
  const defs = await loadAchievementDefs();
  // 現在取得済み（achState）はDBから読み、id集合化
  try {
    const books = await loadBooks();
    await evaluateAndSave(books); // 未取得があれば付与
  } catch {}
  const state = await getAllAchState();
  const got = new Set(state.map((s) => s.id));
  // 今ねらえる3つ（ざっくりヒューリスティック）
  try {
    const books = await loadBooks();
    const sugs = suggestNext(defs, got, books).slice(0, 3);
    const ul = document.getElementById("ach-suggestions");
    if (ul)
      ul.innerHTML = sugs
        .map(
          (d) =>
            `<li><strong>${escapeHtml(d.name)}</strong> — <span class="muted">${escapeHtml(d.description)}</span></li>`,
        )
        .join("");
  } catch {}
  listEl.innerHTML = defs
    .map((d) => {
      const cl = got.has(d.id) ? "ach-item got" : "ach-item";
      return `<div class="${cl}"><div class="name">${escapeHtml(d.name)}</div><div class="desc">${escapeHtml(d.description)}</div></div>`;
    })
    .join("");
}

function suggestNext(defs, got, books) {
  const total = books.filter((b) => b.finishedAt).length;
  const byMonth = books.filter(
    (b) => b.finishedAt && b.finishedAt.slice(0, 7) === todayISO().slice(0, 7),
  ).length;
  const byYear = books.filter(
    (b) => b.finishedAt && b.finishedAt.slice(0, 4) === todayISO().slice(0, 4),
  ).length;
  const candidates = [];
  for (const d of defs) {
    if (got.has(d.id)) continue;
    const r = d.rule || {};
    if (r.type === "TOTAL_READS" && r.gte) {
      candidates.push({ def: d, remain: Math.max(0, r.gte - total) });
    }
    if (r.type === "MONTH_READS" && r.gte) {
      candidates.push({ def: d, remain: Math.max(0, r.gte - byMonth) });
    }
    if (r.type === "YEAR_READS" && r.gte) {
      candidates.push({ def: d, remain: Math.max(0, r.gte - byYear) });
    }
  }
  return candidates.sort((a, b) => a.remain - b.remain).map((x) => x.def);
}

// Export / Import
async function exportJson() {
  const books = await loadBooks();
  const settings = await loadSettings();
  const stats = await getStats();
  const blob = new Blob([JSON.stringify({ books, settings, stats }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_${ymd}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast("保存完了。未来の自分に贈り物を。");
  const st = await getStats();
  st.actions.exportCount = (st.actions.exportCount || 0) + 1;
  await putStats(st);
  await evaluateAfterEvent("export");
}

async function importJson(e) {
  const input = e.target;
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.books)) throw new Error("Invalid format");
    // 既存とマージ（同IDは上書き、未存在は追加）
    const existing = await loadBooks();
    const map = new Map(existing.map((b) => [b.id, b]));
    for (const nb of data.books) map.set(nb.id, nb);
    // クリア→一括putは未実装のため、個別更新/追加（簡易）
    // 既存を削除し、新規を追加（books量は最大1000想定で許容）
    const toDelete = existing.filter((b) => !map.has(b.id));
    for (const b of toDelete) await deleteBook(b.id);
    const merged = Array.from(map.values());
    // 反映：既存IDはupdate、新規IDはcreateっぽくadd。
    const existingIds = new Set(existing.map((b) => b.id));
    for (const b of merged) {
      if (existingIds.has(b.id)) {
        await updateBook(b.id, b);
      } else {
        await createBook(b);
      }
    }
    await renderHome();
    showToast("記憶を製本しました。");
    const st = await getStats();
    st.actions.importCount = (st.actions.importCount || 0) + 1;
    await putStats(st);
    await evaluateAfterEvent("import");
  } catch {
    alert("インポートに失敗しました。ファイル形式をご確認ください。");
  } finally {
    input.value = "";
  }
}
