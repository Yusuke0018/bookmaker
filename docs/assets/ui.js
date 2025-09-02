// ui.js: 描画・ルーティング・イベント
import {
  Books,
  DateUtil,
  computeStats,
  loadAchievements,
  evaluateAchievements,
  seedDemoIfEmpty,
} from './app.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const Toast = {
  show(msg, ms = 2200) {
    const wrap = $('#toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      el.remove();
    }, ms);
  },
};

let ACHIEVEMENTS = [];

function activateTab(hash) {
  $$('#tab-home, #tab-calendar, #tab-achievements').forEach((a) => a.classList.remove('active'));
  if (hash.startsWith('#/calendar')) $('#tab-calendar')?.classList.add('active');
  else if (hash.startsWith('#/achievements')) $('#tab-achievements')?.classList.add('active');
  else $('#tab-home')?.classList.add('active');
}

function renderHome() {
  const el = document.createElement('div');
  el.innerHTML = `
    <section class="section toolbar">
      <input id="q" placeholder="検索（タイトル/著者/感想）" style="flex:1;" />
      <button id="btn-seed" class="btn ghost" title="デモデータ">デモ</button>
    </section>
    <section class="section" id="reunion"></section>
    <section class="section">
      <h3>最近の読了</h3>
      <div class="list" id="recent"></div>
    </section>
  `;

  const books = Books.list();
  const recent = books.filter((b) => b.finishedAt).slice(0, 10);
  const recentBox = $('#recent', el);
  if (!recent.length) {
    recentBox.innerHTML = `<div class="empty">最初の一冊を綴じましょう。</div>`;
  } else {
    for (const b of recent) recentBox.appendChild(bookCard(b));
  }

  // 日替わり再会
  const rbox = $('#reunion', el);
  const candidate = dailyPick(books.filter((b) => b.finishedAt));
  if (candidate) {
    const d = DateUtil.ymdKeyJst(candidate.finishedAt);
    rbox.innerHTML = `<div class="card"><div class="meta">今日の再会本</div><h4>${escapeHtml(candidate.title)}</h4><div class="meta">${escapeHtml(candidate.author)} / ${d}</div></div>`;
  }

  // 検索
  $('#q', el)?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const result = books.filter((b) =>
      (b.title + ' ' + b.author + ' ' + (b.reviewText || '')).toLowerCase().includes(q),
    );
    recentBox.innerHTML = '';
    if (!result.length) recentBox.innerHTML = `<div class="empty">まだ棚にない言葉です。</div>`;
    else result.slice(0, 50).forEach((b) => recentBox.appendChild(bookCard(b)));
    // 検索イベント: 称号評価（対応しないタイプは無視）
    const stats = computeStats(Books.list());
    const newly = evaluateAchievements({
      achievements: ACHIEVEMENTS,
      stats,
      lastEvent: { type: 'search' },
    });
    if (newly.length) showAchievementToasts(newly);
  });

  // デモデータ
  $('#btn-seed', el)?.addEventListener('click', () => {
    seedDemoIfEmpty();
    navigate('#/home');
    Toast.show('デモデータを追加しました');
  });

  return el;
}

function renderCalendar() {
  const el = document.createElement('div');
  el.innerHTML = `
    <section class="section toolbar">
      <div>
        <button class="btn" id="prev">← 前</button>
        <span id="label" style="margin:0 8px;"></span>
        <button class="btn" id="next">次 →</button>
      </div>
      <div id="summary"></div>
    </section>
    <section class="section">
      <div class="heatmap" id="grid"></div>
    </section>
  `;

  let base = new Date();
  const grid = $('#grid', el);
  const label = $('#label', el);
  const summary = $('#summary', el);

  const renderMonth = () => {
    const y = base.getFullYear();
    const m = base.getMonth();
    label.textContent = `${y}年 ${m + 1}月`;
    grid.innerHTML = '';

    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const padStart = (first.getDay() + 6) % 7; // 月曜始まり
    const days = last.getDate();
    const stats = computeStats(Books.list());
    const ymKey = `${y}-${String(m + 1).padStart(2, '0')}`;
    const monthReads = stats.byMonth?.[ymKey] || 0;
    summary.textContent = `今月 ${monthReads} 冊`;

    // 空セル（前月の埋め）
    for (let i = 0; i < padStart; i++) grid.appendChild(blankCell());
    for (let d = 1; d <= days; d++) {
      const iso = new Date(y, m, d).toISOString();
      const key = DateUtil.ymdKeyJst(iso);
      const count = stats.byDay?.[key] || 0;
      grid.appendChild(dayCell(d, count));
    }
  };

  $('#prev', el).addEventListener('click', () => {
    base.setMonth(base.getMonth() - 1);
    renderMonth();
  });
  $('#next', el).addEventListener('click', () => {
    base.setMonth(base.getMonth() + 1);
    renderMonth();
  });
  renderMonth();
  return el;
}

function renderAchievements() {
  const el = document.createElement('div');
  el.innerHTML = `
    <section class="section">
      <h3>実績（称号）</h3>
      <div class="ach-list" id="achs"></div>
    </section>
  `;
  const unlocked = new Set(
    JSON.parse(localStorage.getItem('bookmaker:achievements:unlocked') || '[]'),
  );
  const box = el.querySelector('#achs');
  if (!ACHIEVEMENTS.length) {
    box.innerHTML = `<div class="empty">称号定義を読み込み中です…</div>`;
    return el;
  }
  for (const a of ACHIEVEMENTS) {
    const card = document.createElement('div');
    card.className = 'card ach-card';
    const left = document.createElement('div');
    left.innerHTML = `<div class="ach-name">${escapeHtml(a.name)}</div><div class="ach-desc">${escapeHtml(a.description || '')}</div>`;
    const badge = document.createElement('span');
    const ok = unlocked.has(a.id);
    badge.className = `ach-badge ${ok ? 'ach-ok' : 'ach-ng'}`;
    badge.textContent = ok ? '獲得済' : '未獲得';
    card.appendChild(left);
    card.appendChild(badge);
    box.appendChild(card);
  }
  return el;
}

function bookCard(b) {
  const d = b.finishedAt ? DateUtil.ymdKeyJst(b.finishedAt) : '';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h4>${escapeHtml(b.title)}</h4>
    <div class="meta">${escapeHtml(b.author)} ${d ? ' / ' + d : ''} ${b.rating ? ` / ★${b.rating}` : ''}</div>
    ${b.oneLiner ? `<div class="pill">${escapeHtml(b.oneLiner)}</div>` : ''}
  `;
  return card;
}

function blankCell() {
  const el = document.createElement('div');
  el.className = 'day heat-0';
  el.style.visibility = 'hidden';
  return el;
}
function dayCell(d, count) {
  const el = document.createElement('div');
  const heat = count >= 4 ? 4 : count;
  el.className = `day heat-${heat}`;
  el.textContent = d;
  return el;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]+/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

function dailyPick(items) {
  if (!items.length) return null;
  const seed = DateUtil.todayYmd();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const idx = h % items.length;
  return items[idx];
}

function showAchievementToasts(list) {
  for (const a of list) Toast.show(`称号獲得：${a.name}`);
}

// 追加モーダル
function setupModal() {
  const modal = $('#book-modal');
  const form = $('#book-form');
  const startedInput = form.elements.namedItem('startedAt');
  const finishedToggle = form.elements.namedItem('finishedToggle');
  const finishedAt = form.elements.namedItem('finishedAt');

  // 初期値
  const today = new Date().toISOString();
  startedInput.value = DateUtil.toInputDate(today);
  finishedToggle.addEventListener('change', () => {
    finishedAt.disabled = !finishedToggle.checked;
    if (finishedToggle.checked) finishedAt.value = DateUtil.toInputDate(new Date().toISOString());
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const book = Books.create({
      title: data.title,
      author: data.author,
      startedAt: new Date(data.startedAt).toISOString(),
      finished: finishedToggle.checked,
      finishedAt:
        finishedToggle.checked && data.finishedAt ? new Date(data.finishedAt).toISOString() : '',
      rating: data.rating,
      oneLiner: data.oneLiner,
      reviewText: data.reviewText,
    });
    // 集計と称号
    const stats = computeStats(Books.list());
    const newly = evaluateAchievements({
      achievements: ACHIEVEMENTS,
      stats,
      books: Books.list(),
      lastEvent: { type: 'save', book },
    });
    if (newly.length) showAchievementToasts(newly);
    modal.close();
    navigate('#/home');
    Toast.show('綴じました。次のページへ。');
  });

  return { open: () => modal.showModal() };
}

// ルーティング
function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
  render();
}
window.navigate = navigate;

async function render() {
  activateTab(location.hash || '#/home');
  const root = $('#app');
  root.innerHTML = '';
  if (location.hash.startsWith('#/calendar')) root.appendChild(renderCalendar());
  else if (location.hash.startsWith('#/achievements')) root.appendChild(renderAchievements());
  else root.appendChild(renderHome());
}

// 初期化
window.addEventListener('DOMContentLoaded', async () => {
  try {
    ACHIEVEMENTS = await loadAchievements();
  } catch {
    ACHIEVEMENTS = [];
  }
  seedDemoIfEmpty();
  const modal = setupModal();
  $('#btn-add')?.addEventListener('click', () => modal.open());
  window.addEventListener('hashchange', render);
  render();
  // Service Worker（後続で強化）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
