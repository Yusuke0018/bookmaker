// ui.js: ルーティングとUIの最小実装
import {
  createBook,
  loadBooks,
  searchBooks,
  todayISO,
  updateBook,
  deleteBook,
} from "./app.js";

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
}

window.addEventListener("hashchange", route);
window.addEventListener("load", () => {
  route();
  initForm();
  initHomeSearch();
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
