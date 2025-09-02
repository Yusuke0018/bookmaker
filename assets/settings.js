// settings.js: 設定の保存/読込と適用
import { openDB } from "./db.js";

const STORE = "settings";
const DOC_ID = "settings";

export function defaultSettings() {
  return { id: DOC_ID, theme: "auto", startOfWeek: "mon", sound: false };
}

export async function loadSettings() {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const r = t.objectStore(STORE).get(DOC_ID);
    r.onsuccess = () => resolve(r.result || defaultSettings());
    r.onerror = () => reject(r.error);
  });
}

export async function saveSettings(s) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put({ ...defaultSettings(), ...s, id: DOC_ID });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function applyTheme(theme) {
  const root = document.documentElement;
  const mode =
    theme === "auto"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  root.dataset.theme = mode;
}
