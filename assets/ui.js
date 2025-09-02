// ui.js: 描画・ルーティング・イベント
import {
  Books,
  Store,
  DateUtil,
  computeStats,
  loadAchievements,
  evaluateAchievements,
  seedDemoIfEmpty,
  exportAll,
  importAll,
  init,
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
  if (hash.startsWith('#/calendar')) {
    const el = $('#tab-calendar');
    if (el) el.classList.add('active');
  } else if (hash.startsWith('#/achievements')) {
    const el = $('#tab-achievements');
    if (el) el.classList.add('active');
  } else {
    const el = $('#tab-home');
    if (el) el.classList.add('active');
  }
}

async function renderHome() {
  const el = document.createElement('div');
  el.innerHTML = `
    <section class="section toolbar">
      <input id="q" placeholder="検索（タイトル/著者/感想）" style="flex:1;" />
      <button id="btn-export" class="btn">エクスポート</button>
      <button id="btn-import" class="btn">インポート</button>
      <button id="btn-seed" class="btn ghost" title="デモデータ">デモ</button>
    </section>
    <section class="section" id="reunion"></section>
    <section class="section">
      <h3>最近の読了</h3>
      <div class="list" id="recent"></div>
    </section>
  `;
  const books = await Books.list();
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
  const qel = $('#q', el);
  if (qel)
    qel.addEventListener('input', async (e) => {
      const q = e.target.value.toLowerCase();
      const result = books.filter((b) =>
        (b.title + ' ' + b.author + ' ' + (b.reviewText || '')).toLowerCase().includes(q),
      );
      recentBox.innerHTML = '';
      if (!result.length) recentBox.innerHTML = `<div class="empty">まだ棚にない言葉です。</div>`;
      else result.slice(0, 50).forEach((b) => recentBox.appendChild(bookCard(b)));
      // 検索イベント: 称号評価（対応しないタイプは無視）
      await Store.incCounter('searches', 1);
      const all = await Books.list();
      const stats = computeStats(all);
      const counters = await Store.getCounters();
      const newly = await evaluateAchievements({
        achievements: ACHIEVEMENTS,
        stats,
        books: all,
        counters,
        lastEvent: { type: 'search' },
      });
      if (newly.length) showAchievementToasts(newly);
    });

  // デモデータ
  const seedBtn = $('#btn-seed', el);
  if (seedBtn)
    seedBtn.addEventListener('click', async () => {
      await seedDemoIfEmpty();
      navigate('#/home');
      Toast.show('デモデータを追加しました');
    });

  const exportBtn = $('#btn-export', el);
  if (exportBtn)
    exportBtn.addEventListener('click', async () => {
      await exportAll();
      const all = await Books.list();
      const stats = computeStats(all);
      const counters = await Store.getCounters();
      const newly = await evaluateAchievements({
        achievements: ACHIEVEMENTS,
        stats,
        books: all,
        counters,
        lastEvent: { type: 'backup' },
      });
      if (newly.length) showAchievementToasts(newly);
      Toast.show('バックアップを保存しました');
    });

  const importBtn = $('#btn-import', el);
  if (importBtn)
    importBtn.addEventListener('click', async () => {
      const inp = document.getElementById('import-file');
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        const mode = confirm('インポートを「上書き」で行いますか？（キャンセルでマージ）')
          ? 'overwrite'
          : 'merge';
        const text = await file.text();
        await importAll(text, mode);
        const all = await Books.list();
        const stats = computeStats(all);
        const counters = await Store.getCounters();
        const newly = await evaluateAchievements({
          achievements: ACHIEVEMENTS,
          stats,
          books: all,
          counters,
          lastEvent: { type: 'restore' },
        });
        if (newly.length) showAchievementToasts(newly);
        navigate('#/home');
        Toast.show('復元が完了しました');
        inp.value = '';
      };
      inp.click();
    });

  return el;
}

async function renderCalendar() {
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

  const renderMonth = async () => {
    const y = base.getFullYear();
    const m = base.getMonth();
    label.textContent = `${y}年 ${m + 1}月`;
    grid.innerHTML = '';

    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const padStart = (first.getDay() + 6) % 7; // 月曜始まり
    const days = last.getDate();
    const stats = computeStats(await Books.list());
    const ymKey = `${y}-${String(m + 1).padStart(2, '0')}`;
    const monthReads = (stats.byMonth && stats.byMonth[ymKey]) || 0;
    summary.textContent = `今月 ${monthReads} 冊`;

    // 空セル（前月の埋め）
    for (let i = 0; i < padStart; i++) grid.appendChild(blankCell());
    for (let d = 1; d <= days; d++) {
      const iso = new Date(y, m, d).toISOString();
      const key = DateUtil.ymdKeyJst(iso);
      const count = (stats.byDay && stats.byDay[key]) || 0;
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
  await renderMonth();
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
  const unlocked = new Set();
  const box = el.querySelector('#achs');
  (async () => {
    const set = await Store.getUnlocked();
    set.forEach((id) => unlocked.add(id));
    fill();
  })();
  function fill() {
    box.innerHTML = '';
    if (!ACHIEVEMENTS.length) {
      box.innerHTML = `<div class="empty">称号定義を読み込み中です…</div>`;
      return;
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
    <div class="row" style="margin-top:8px">
      <button class="btn" data-edit="${b.id}">編集</button>
      <button class="btn" data-del="${b.id}">削除</button>
    </div>
  `;
  const editBtn = card.querySelector(`[data-edit="${b.id}"]`);
  if (editBtn) editBtn.addEventListener('click', () => openBookModal(b));
  const delBtn = card.querySelector(`[data-del="${b.id}"]`);
  if (delBtn)
    delBtn.addEventListener('click', async () => {
      if (!confirm('削除しますか？')) return;
      await Books.remove(b.id);
      const all = await Books.list();
      const stats = computeStats(all);
      const counters = await Store.getCounters();
      const newly = await evaluateAchievements({
        achievements: ACHIEVEMENTS,
        stats,
        books: all,
        counters,
        lastEvent: { type: 'delete', book: b },
      });
      if (newly.length) showAchievementToasts(newly);
      navigate('#/home');
    });
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
  let editingId = null;
  let openedAt = 0;

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
    let book;
    if (editingId) {
      book = await Books.update(editingId, {
        title: data.title,
        author: data.author,
        startedAt: new Date(data.startedAt).toISOString(),
        finishedAt:
          finishedToggle.checked && data.finishedAt ? new Date(data.finishedAt).toISOString() : '',
        rating: Number(data.rating || 0),
        oneLiner: data.oneLiner,
        reviewText: data.reviewText,
      });
    } else {
      book = await Books.create({
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
    }
    // 集計と称号
    const all = await Books.list();
    const stats = computeStats(all);
    const counters = await Store.getCounters();
    const durationSec = (Date.now() - openedAt) / 1000;
    const newly = await evaluateAchievements({
      achievements: ACHIEVEMENTS,
      stats,
      books: all,
      counters,
      lastEvent: { type: editingId ? 'edit' : 'save', book, durationSec },
    });
    if (newly.length) showAchievementToasts(newly);
    modal.close();
    navigate('#/home');
    Toast.show('綴じました。次のページへ。');
  });

  function open(book) {
    editingId = book?.id || null;
    openedAt = Date.now();
    form.reset();
    const todayIso = new Date().toISOString();
    startedInput.value = DateUtil.toInputDate(book?.startedAt || todayIso);
    if (book?.finishedAt) {
      finishedToggle.checked = true;
      finishedAt.disabled = false;
      finishedAt.value = DateUtil.toInputDate(book.finishedAt);
    } else {
      finishedToggle.checked = false;
      finishedAt.disabled = true;
      finishedAt.value = '';
    }
    form.elements.namedItem('title').value = book?.title || '';
    form.elements.namedItem('author').value = book?.author || '';
    form.elements.namedItem('rating').value = book?.rating || '';
    form.elements.namedItem('oneLiner').value = book?.oneLiner || '';
    form.elements.namedItem('reviewText').value = book?.reviewText || '';
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      // Fallback for browsers without <dialog>
      modal.setAttribute('open', '');
      modal.style.display = 'block';
    }
  }

  return { open };
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
  if (location.hash.startsWith('#/calendar')) root.appendChild(await renderCalendar());
  else if (location.hash.startsWith('#/achievements')) root.appendChild(await renderAchievements());
  else root.appendChild(await renderHome());
}

// 初期化
async function bootstrap() {
  try {
    await init();
    ACHIEVEMENTS = await loadAchievements();
  } catch {
    ACHIEVEMENTS = [];
  }
  await seedDemoIfEmpty();
  const modal = setupModal();
  const addBtn = $('#btn-add');
  if (addBtn) addBtn.addEventListener('click', () => modal.open());
  const settingsBtn = $('#btn-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', () => openSettings());
  // ナビゲーションをクリックで強制描画（hashchangeの保険）
  const tabHome = $('#tab-home');
  if (tabHome)
    tabHome.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('#/home');
    });
  const tabCal = $('#tab-calendar');
  if (tabCal)
    tabCal.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('#/calendar');
    });
  const tabAch = $('#tab-achievements');
  if (tabAch)
    tabAch.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('#/achievements');
    });
  window.addEventListener('hashchange', render);
  // 初回描画はエラーを握りつぶさず通知
  try {
    await render();
  } catch (err) {
    console.error(err);
    Toast.show('描画エラー');
  }
  // Service Worker（後続で強化）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    bootstrap();
  });
} else {
  // すでに読み込み済みの場合
  bootstrap();
}

// 予期しないエラーをトーストで可視化
window.addEventListener('error', (e) => {
  try {
    Toast.show('エラー: ' + (e?.error?.message || e?.message || 'unknown'));
  } catch {
    /* ignore */
  }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    Toast.show('エラー: ' + (e?.reason?.message || String(e?.reason) || 'unknown'));
  } catch {
    /* ignore */
  }
});

function openBookModal(b) {
  const m = setupModal();
  m.open(b);
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  const form = document.getElementById('settings-form');
  const btnClear = document.getElementById('btn-clear-cache');
  if (btnClear) {
    btnClear.onclick = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        Toast.show('キャッシュをクリアしました。再読み込みします。');
        setTimeout(() => location.reload(), 400);
      } catch (e) {
        console.error(e);
        Toast.show('キャッシュクリアに失敗しました');
      }
    };
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    await Store.incCounter('settingsSaves', 1);
    const all = await Books.list();
    const stats = computeStats(all);
    const counters = await Store.getCounters();
    const newly = await evaluateAchievements({
      achievements: ACHIEVEMENTS,
      stats,
      books: all,
      counters,
      lastEvent: { type: 'settings' },
    });
    if (newly.length) showAchievementToasts(newly);
    if (typeof modal.close === 'function') {
      modal.close();
    } else {
      modal.removeAttribute('open');
      modal.style.display = 'none';
    }
    Toast.show('設定を保存しました');
  };
  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    modal.setAttribute('open', '');
    modal.style.display = 'block';
  }
}
