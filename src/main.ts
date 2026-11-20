// Billy Note : un bloc-notes Markdown sans interface.
// Onglets, brouillons conservés entre les lancements, notes enregistrées dans
// un dossier synchronisé (iCloud Drive, OneDrive, Dropbox…).

import "./dev-mock";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type NoteInfo } from "./backend";
import { baseExtensions, createState } from "./editor";
import { renderPreview } from "./preview";
import { Palette, Switcher, type Item, type Source } from "./palette";
import { icon } from "./icons";
import { debounce, esc, fuzzy, highlight, relDate, uid } from "./util";

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

type Theme = "system" | "light" | "dark";

interface Tab {
  id: string;
  kind: "draft" | "file";
  path?: string;
  name?: string;
  /** Contenu tant qu'aucun EditorState n'existe pour cet onglet. */
  content: string;
  /** Dernier contenu connu sur le disque (notes enregistrées). */
  disk?: string;
  mtime?: number;
  sel?: { anchor: number; head: number };
  scroll?: number;
  preview?: boolean;
}

interface Session {
  v: 1;
  tabs: Tab[];
  active: string | null;
  mru: string[];
  theme: Theme;
  zoom: number;
  flatHeadings?: boolean;
}

const $ = (id: string) => document.getElementById(id)!;
const appEl = $("app");
const editorEl = $("editor");
const previewEl = $("preview");
const tabsEl = $("tabs");
const sidebarEl = $("sidebar");
const edgeEl = $("edge");
const overlayEl = $("overlay");
const toastEl = $("toast");

const isMac = /Mac/.test(navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl+";
const CTRL = isMac ? "⌃" : "Ctrl+";
document.documentElement.classList.add(isMac ? "mac" : "win");

let notesDir = "";
let tabs: Tab[] = [];
let active!: Tab;
let mru: string[] = [];
let theme: Theme = "system";
let zoom = 16;
let flatHeadings = false;
let notes: NoteInfo[] = [];
const states = new Map<string, EditorState>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const writeChains = new Map<string, Promise<void>>();

const extensions = baseExtensions(isMac, onEditorUpdate);
const view = new EditorView({ parent: editorEl, state: createState("", extensions) });
const palette = new Palette(overlayEl);
const switcher = new Switcher(overlayEl, (id) => {
  const t = byId(id);
  if (t) activate(t);
});
palette.onClose = () => focusContent();
if (import.meta.env.DEV) Object.assign(window, { __view: view });

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

const byId = (id: string | null | undefined) => tabs.find((t) => t.id === id);

function docOf(tab: Tab) {
  return states.get(tab.id)?.doc;
}

function contentOf(tab: Tab): string {
  return docOf(tab)?.toString() ?? tab.content;
}

function titleOf(tab: Tab): string {
  if (tab.kind === "file") return tab.name ?? "Sans titre";
  const doc = docOf(tab);
  const lines = doc ? Array.from({ length: Math.min(doc.lines, 30) }, (_, i) => doc.line(i + 1).text) : tab.content.split("\n", 30);
  const first = lines.find((l) => l.trim());
  if (!first) return "Sans titre";
  const clean = first.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "").replace(/[*_`~]/g, "").trim();
  return (clean || "Sans titre").slice(0, 60);
}

const isDirtyDraft = (t: Tab) => t.kind === "draft" && contentOf(t).trim() !== "";

function stashActive() {
  if (!active) return;
  const s = view.state.selection.main;
  active.sel = { anchor: s.anchor, head: s.head };
  active.scroll = active.preview ? previewEl.scrollTop : view.scrollDOM.scrollTop;
  states.set(active.id, view.state);
}

function activate(tab: Tab, opts: { flash?: boolean } = {}) {
  if (active && active !== tab) stashActive();
  active = tab;
  mru = [tab.id, ...mru.filter((id) => id !== tab.id && byId(id))];
  let st = states.get(tab.id);
  if (!st) {
    st = createState(tab.content, extensions, tab.sel);
    states.set(tab.id, st);
  }
  view.setState(st);
  applyPreview(true);
  const scroll = tab.scroll ?? 0;
  requestAnimationFrame(() => {
    if (tab.preview) previewEl.scrollTop = scroll;
    else view.scrollDOM.scrollTop = scroll;
  });
  renderTabs();
  if (opts.flash !== false) flashTabs();
  if (sidebarOpen) renderSidebar();
  saveSessionSoon();
  focusContent();
}

function insertTab(tab: Tab) {
  const i = tabs.indexOf(active);
  tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, tab);
}

function newDraft(content = "") {
  const tab: Tab = { id: uid(), kind: "draft", content };
  insertTab(tab);
  activate(tab);
}

async function openNote(info: { path: string; name: string }) {
  const existing = tabs.find((t) => t.path === info.path);
  if (existing) return activate(existing);
  try {
    const { content, mtime } = await api.readNote(info.path);
    const tab: Tab = { id: uid(), kind: "file", path: info.path, name: info.name, content, disk: content, mtime };
    insertTab(tab);
    activate(tab);
  } catch (e) {
    toast(`Impossible d'ouvrir la note : ${e}`);
    refreshNotes();
  }
}

async function createNamed(name: string) {
  try {
    const c = await api.createNote(name, "");
    const tab: Tab = { id: uid(), kind: "file", path: c.path, name: c.name, content: "", disk: "", mtime: c.mtime };
    insertTab(tab);
    activate(tab);
    refreshNotes();
  } catch (e) {
    toast(`Impossible de créer la note : ${e}`);
  }
}

function removeTab(tab: Tab) {
  clearTimeout(writeTimers.get(tab.id));
  writeTimers.delete(tab.id);
  tabs = tabs.filter((t) => t !== tab);
  states.delete(tab.id);
  mru = mru.filter((id) => id !== tab.id);
  if (!tabs.length) {
    active = undefined as unknown as Tab;
    newDraft();
  } else if (tab === active) {
    active = undefined as unknown as Tab;
    activate(byId(mru[0]) ?? tabs[0]);
  } else {
    renderTabs();
    saveSessionSoon();
  }
  if (sidebarOpen) renderSidebar();
}

async function closeTab(tab = active) {
  if (tab.kind === "file") {
    await flushWrite(tab);
    return removeTab(tab);
  }
  if (!isDirtyDraft(tab)) return removeTab(tab);
  ask(`Ce brouillon n'est pas enregistré`, [
    { title: "Enregistrer dans le dossier des notes…", icon: "save", kbd: `${MOD}S`, run: () => saveAs(tab, () => removeTab(tab)) },
    { title: "Supprimer le brouillon", icon: "trash", run: () => removeTab(tab) },
    { title: "Annuler", icon: "close", run: () => {} },
  ]);
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

function onEditorUpdate(u: ViewUpdate) {
  if (!active || !u.transactions.length) return;
  states.set(active.id, u.state);
  if (u.docChanged) {
    if (active.kind === "file") scheduleWrite(active);
    titleRefreshSoon();
  }
  saveSessionSoon();
}

const titleRefreshSoon = debounce(() => {
  renderTabs();
  if (sidebarOpen) renderSidebar();
}, 500);

function scheduleWrite(tab: Tab) {
  clearTimeout(writeTimers.get(tab.id));
  writeTimers.set(tab.id, setTimeout(() => void flushWrite(tab), 700));
}

/** Écrit la note sur le disque si elle a changé (écritures sérialisées). */
function flushWrite(tab: Tab): Promise<void> {
  clearTimeout(writeTimers.get(tab.id));
  writeTimers.delete(tab.id);
  const run = async () => {
    if (tab.kind !== "file" || !tab.path || !tabs.includes(tab)) return;
    const content = contentOf(tab);
    if (content === tab.disk) return;
    try {
      tab.mtime = await api.writeNote(tab.path, content);
      tab.disk = content;
    } catch (e) {
      toast(`Échec de l'enregistrement : ${e}`);
    }
  };
  const next = (writeChains.get(tab.id) ?? Promise.resolve()).then(run);
  writeChains.set(tab.id, next);
  return next;
}

function serializeSession(): string {
  stashActive();
  const data: Session = {
    v: 1,
    active: active?.id ?? null,
    mru,
    theme,
    zoom,
    flatHeadings,
    tabs: tabs.map((t) => {
      const content = contentOf(t);
      return {
        id: t.id,
        kind: t.kind,
        path: t.path,
        name: t.name,
        // Les notes enregistrées sont relues depuis le disque au lancement.
        content: t.kind === "draft" || content !== t.disk ? content : "",
        sel: t.sel,
        scroll: t.scroll,
        preview: t.preview,
      };
    }),
  };
  return JSON.stringify(data);
}

async function saveSession() {
  saveSessionSoon.cancel();
  try {
    await api.saveSession(serializeSession());
  } catch (e) {
    console.error("session", e);
  }
}
const saveSessionSoon = debounce(() => void saveSession(), 400);

async function flushAll() {
  await Promise.all(tabs.filter((t) => t.kind === "file").map(flushWrite));
  await saveSession();
}

function suggestedName(tab: Tab) {
  const t = titleOf(tab);
  return t === "Sans titre" ? "" : t;
}

function saveAs(tab: Tab, after?: () => void) {
  palette.open(
    prompt({
      label: "Enregistrer la note",
      placeholder: "Nom de la note",
      initial: suggestedName(tab),
      verb: "Enregistrer",
      sub: shortDir(),
      run: async (name) => {
        try {
          const content = contentOf(tab);
          const c = await api.createNote(name, content);
          Object.assign(tab, { kind: "file", path: c.path, name: c.name, disk: content, mtime: c.mtime });
          renderTabs();
          saveSessionSoon();
          refreshNotes();
          toast(`Enregistrée dans ${shortDir()}`);
          after?.();
        } catch (e) {
          toast(`Impossible d'enregistrer : ${e}`);
        }
      },
    }),
  );
}

async function save() {
  if (active.kind === "draft") return saveAs(active);
  await flushWrite(active);
  toast("Enregistré");
}

function rename(tab = active) {
  if (tab.kind === "draft") return saveAs(tab);
  palette.open(
    prompt({
      label: "Renommer la note",
      placeholder: "Nouveau nom",
      initial: tab.name,
      select: true,
      verb: "Renommer en",
      run: async (name) => {
        try {
          await flushWrite(tab);
          const c = await api.renameNote(tab.path!, name);
          Object.assign(tab, { path: c.path, name: c.name });
          renderTabs();
          saveSessionSoon();
          refreshNotes();
        } catch (e) {
          toast(`Impossible de renommer : ${e}`);
        }
      },
    }),
  );
}

function trash(tab = active) {
  if (tab.kind === "draft") {
    if (!isDirtyDraft(tab)) return removeTab(tab);
    return ask("Supprimer ce brouillon ?", [
      { title: "Supprimer le brouillon", icon: "trash", run: () => removeTab(tab) },
      { title: "Annuler", icon: "close", run: () => {} },
    ]);
  }
  ask(`Mettre « ${tab.name} » à la corbeille ?`, [
    {
      title: "Mettre à la corbeille",
      icon: "trash",
      run: async () => {
        clearTimeout(writeTimers.get(tab.id));
        try {
          await api.trashNote(tab.path!);
          removeTab(tab);
          refreshNotes();
          toast("Note mise à la corbeille");
        } catch (e) {
          toast(`Impossible de supprimer : ${e}`);
        }
      },
    },
    { title: "Annuler", icon: "close", run: () => {} },
  ]);
}

/** Recharge les notes modifiées ailleurs (synchro iCloud/OneDrive, autre appareil). */
async function checkExternal() {
  const files = tabs.filter((t) => t.kind === "file" && t.path && !writeTimers.has(t.id));
  if (!files.length) return;
  const stats = await api.statNotes(files.map((t) => t.path!)).catch(() => null);
  if (!stats) return;
  for (const [i, tab] of files.entries()) {
    const m = stats[i];
    if (m === null) {
      // Fichier déplacé ou supprimé ailleurs : on garde le texte en brouillon.
      Object.assign(tab, { kind: "draft", path: undefined, name: undefined, disk: undefined, mtime: undefined });
      tab.content = contentOf(tab);
      toast("Une note a disparu du dossier : conservée comme brouillon");
      continue;
    }
    if (m === tab.mtime) continue;
    const local = contentOf(tab);
    if (local !== tab.disk) continue; // modifications locales en attente : elles l'emportent
    try {
      const { content, mtime } = await api.readNote(tab.path!);
      tab.mtime = mtime;
      if (content === tab.disk) continue;
      tab.disk = content;
      const st = states.get(tab.id);
      if (tab === active) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
        if (tab.preview) void renderPreview(previewEl, content);
      } else if (st) {
        states.set(tab.id, st.update({ changes: { from: 0, to: st.doc.length, insert: content } }).state);
      } else {
        tab.content = content;
      }
    } catch {
      /* fichier en cours de synchro, on réessaiera */
    }
  }
  renderTabs();
  saveSessionSoon();
}

// ---------------------------------------------------------------------------
// Vue consultation, thème, zoom
// ---------------------------------------------------------------------------

function applyPreview(keepScroll = false) {
  const on = !!active.preview;
  appEl.classList.toggle("previewing", on);
  previewEl.hidden = !on;
  if (on) {
    void renderPreview(previewEl, contentOf(active));
  } else {
    previewEl.replaceChildren();
    view.requestMeasure();
  }
  if (!keepScroll) focusContent();
}

function togglePreview() {
  const ratio = (el: HTMLElement) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
  const from = active.preview ? previewEl : view.scrollDOM;
  const r = ratio(from);
  active.preview = !active.preview;
  applyPreview();
  requestAnimationFrame(() => {
    const to = active.preview ? previewEl : view.scrollDOM;
    to.scrollTop = r * (to.scrollHeight - to.clientHeight);
  });
  saveSessionSoon();
}

function focusContent() {
  if (palette.isOpen || switcher.isOpen) return;
  if (active?.preview) previewEl.focus({ preventScroll: true });
  else view.focus();
}

const darkMq = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const resolved = theme === "system" ? (darkMq.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {});
}
darkMq.addEventListener("change", applyTheme);

function setTheme(t: Theme) {
  theme = t;
  applyTheme();
  saveSessionSoon();
}

function setZoom(px: number) {
  zoom = Math.max(12, Math.min(28, px));
  appEl.style.setProperty("--fs", `${zoom}px`);
  view.requestMeasure();
  saveSessionSoon();
}

let fullscreen = false;

function setFlatHeadings(on: boolean) {
  flatHeadings = on;
  appEl.classList.toggle("flat-headings", on);
  view.requestMeasure();
  saveSessionSoon();
}

async function toggleFullscreen() {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
  void syncFullscreen();
}

/** Met à jour l'icône agrandir / réduire selon l'état réel de la fenêtre. */
async function syncFullscreen() {
  const fs = await getCurrentWindow()
    .isFullscreen()
    .catch(() => false);
  if (fs === fullscreen && fullBtn.dataset.ready) return;
  fullscreen = fs;
  fullBtn.dataset.ready = "1";
  fullBtn.innerHTML = icon(fs ? "shrink" : "expand");
  fullBtn.title = fs ? `Quitter le plein écran (${isMac ? "⌃⌘F" : "F11"})` : `Plein écran (${isMac ? "⌃⌘F" : "F11"})`;
  appEl.classList.toggle("fullscreen", fs);
}

// ---------------------------------------------------------------------------
// Barre du haut : menu à gauche, onglets au centre, plein écran à droite.
// Apparaît au survol du haut de la fenêtre ou au défilement vers le haut.
// ---------------------------------------------------------------------------

const topbarEl = $("topbar");
const sideBtn = $("tb-sidebar");
const fullBtn = $("tb-full");
sideBtn.innerHTML = icon("sidebar");
sideBtn.title = `Menu (${MOD}\\)`;

let tabsTimer: ReturnType<typeof setTimeout> | undefined;
let tabsHover = false;

function renderTabs() {
  if (tabDrag) return void (tabDrag.rerender = true);
  tabsEl.innerHTML = tabs
    .map((t) => {
      const draft = t.kind === "draft" && contentOf(t).trim() !== "";
      return `<div class="pill${t === active ? " on" : ""}${draft ? " draft" : ""}" data-id="${t.id}" title="${esc(t.kind === "file" ? t.path ?? "" : "Brouillon non enregistré")}">
        <span class="pill-title">${esc(titleOf(t))}</span>
        <button class="pill-x" data-close="${t.id}" title="Fermer (${MOD}W)" tabindex="-1"><i class="dot"></i>${icon("close")}</button>
      </div>`;
    })
    .join("");
  tabsEl.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function showTabs(ms = 1600) {
  if (palette.isOpen || switcher.isOpen) return;
  topbarEl.classList.add("show");
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(function hide() {
    if (tabsHover || tabDrag) tabsTimer = setTimeout(hide, 600);
    else topbarEl.classList.remove("show");
  }, ms);
}
const flashTabs = () => tabs.length > 1 && showTabs(1100);

for (const el of topbarEl.querySelectorAll<HTMLElement>("#tabs, .tb-btn")) {
  el.addEventListener("mouseenter", () => (tabsHover = true));
  el.addEventListener("mouseleave", () => {
    tabsHover = false;
    showTabs(700);
  });
}
topbarEl.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("#tabs, .tb-btn")) e.preventDefault();
});
// Glisser un onglet pour le déplacer : il suit la souris, et l'ordre change dès
// qu'il dépasse le milieu d'un voisin.
interface TabDrag {
  tab: Tab;
  el: HTMLElement;
  startX: number;
  grab: number;
  moved: boolean;
  rerender?: boolean;
}
let tabDrag: TabDrag | null = null;
let suppressTabClick = false;

tabsEl.addEventListener("mousedown", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".pill");
  const tab = byId(el?.dataset.id);
  if (e.button !== 0 || !el || !tab || (e.target as HTMLElement).closest("[data-close]") || tabs.length < 2) return;
  tabDrag = { tab, el, startX: e.clientX, grab: e.clientX - el.getBoundingClientRect().left, moved: false };
});

document.addEventListener("mousemove", (e) => {
  const d = tabDrag;
  if (!d) return;
  if (!d.moved) {
    if (Math.abs(e.clientX - d.startX) < 5) return;
    d.moved = true;
    tabsHover = true;
    tabsEl.classList.add("reordering");
    d.el.classList.add("dragging");
  }
  // Échange avec un voisin dont le milieu est franchi par le bord de l'onglet.
  const pills = Array.from(tabsEl.querySelectorAll<HTMLElement>(".pill"));
  const i = pills.indexOf(d.el);
  const left = e.clientX - d.grab;
  const right = left + d.el.offsetWidth;
  const center = (p: HTMLElement) => {
    const r = p.getBoundingClientRect();
    return r.left + r.width / 2;
  };
  let to = i;
  while (to + 1 < pills.length && right > center(pills[to + 1])) to++;
  while (to - 1 >= 0 && left < center(pills[to - 1])) to--;
  if (to !== i) {
    tabsEl.insertBefore(d.el, to > i ? pills[to].nextSibling : pills[to]);
    tabs = tabs.filter((t) => t !== d.tab);
    tabs.splice(to, 0, d.tab);
  }
  // L'onglet suit la souris, sans sortir de la barre.
  d.el.style.transform = "";
  const box = tabsEl.getBoundingClientRect();
  const natural = d.el.getBoundingClientRect().left;
  const x = Math.max(box.left + 3, Math.min(box.right - 3 - d.el.offsetWidth, left));
  d.el.style.transform = `translateX(${x - natural}px)`;
});

document.addEventListener("mouseup", () => {
  const d = tabDrag;
  if (!d) return;
  tabDrag = null;
  if (!d.moved) return;
  suppressTabClick = true;
  setTimeout(() => (suppressTabClick = false));
  tabsEl.classList.remove("reordering");
  tabsHover = false;
  renderTabs();
  if (sidebarOpen) renderSidebar();
  saveSessionSoon();
  showTabs(900);
});

tabsEl.addEventListener("click", (e) => {
  if (suppressTabClick) return;
  const el = e.target as HTMLElement;
  const close = el.closest<HTMLElement>("[data-close]")?.dataset.close;
  if (close) {
    const t = byId(close);
    if (t) void closeTab(t);
    return;
  }
  const t = byId(el.closest<HTMLElement>("[data-id]")?.dataset.id);
  if (t) activate(t, { flash: false });
});
tabsEl.addEventListener("wheel", (e) => {
  // Molette verticale = défilement horizontal des onglets quand ils débordent.
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) tabsEl.scrollLeft += e.deltaY;
}, { passive: true });
sideBtn.addEventListener("click", () => (sidebarOpen ? closeSidebar() : openSidebar(true)));
fullBtn.addEventListener("click", () => void toggleFullscreen());
const minBtn = $("tb-min");
minBtn.innerHTML = icon("minimize");
minBtn.title = "Réduire";
minBtn.addEventListener("click", () => void getCurrentWindow().minimize());
const closeBtn = $("tb-close");
closeBtn.innerHTML = icon("close");
closeBtn.title = `Quitter (${MOD}Q)`;
closeBtn.addEventListener("click", () => void quit());
tabsEl.addEventListener("auxclick", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
  const t = byId(id);
  if (e.button === 1 && t) void closeTab(t);
});

// ---------------------------------------------------------------------------
// Menu de gauche (survol du bord gauche ou ⌘\)
// ---------------------------------------------------------------------------

let sidebarOpen = false;
let sidebarSticky = false;
let edgeTimer: ReturnType<typeof setTimeout> | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function renderSidebar() {
  const open = tabs
    .map(
      (t) => `<div class="sb-item${t === active ? " on" : ""}" data-tab="${t.id}">
        <span class="pal-ico">${icon(t.kind === "draft" ? "draft" : "note")}</span>
        <span class="sb-title">${esc(titleOf(t))}</span>
        <button class="sb-x" data-close="${t.id}" title="Fermer">${icon("close")}</button>
      </div>`,
    )
    .join("");
  const files = notes
    .filter((n) => !tabs.some((t) => t.path === n.path))
    .slice(0, 80)
    .map(
      (n) => `<div class="sb-item" data-path="${esc(n.path)}" data-name="${esc(n.name)}">
        <span class="pal-ico">${icon("note")}</span>
        <span class="sb-title">${esc(n.name)}</span>
        <span class="sb-meta">${esc(relDate(n.modified))}</span>
      </div>`,
    )
    .join("");
  sidebarEl.innerHTML = `
    <div class="sb-scroll">
      <div class="sb-head">Ouverts</div>${open}
      <div class="sb-new" data-new>${icon("plus")}<span>Nouvelle note</span><kbd>${MOD}N</kbd></div>
      ${files ? `<div class="sb-head">Dans le dossier</div>${files}` : ""}
    </div>
    <div class="sb-foot" data-reveal title="${esc(notesDir)}">${icon("cloud")}<span>${esc(shortDir())}</span></div>`;
}

function openSidebar(sticky: boolean) {
  sidebarSticky = sticky;
  if (sidebarOpen) return;
  sidebarOpen = true;
  renderSidebar();
  sidebarEl.classList.add("show");
  refreshNotes();
}

function closeSidebar() {
  sidebarOpen = false;
  sidebarSticky = false;
  sidebarEl.classList.remove("show");
}

edgeEl.addEventListener("mouseenter", () => {
  edgeTimer = setTimeout(() => openSidebar(false), 140);
});
edgeEl.addEventListener("mouseleave", () => clearTimeout(edgeTimer));
sidebarEl.addEventListener("mouseenter", () => clearTimeout(leaveTimer));
sidebarEl.addEventListener("mouseleave", () => {
  if (!sidebarSticky) leaveTimer = setTimeout(closeSidebar, 260);
});
sidebarEl.addEventListener("mousedown", (e) => e.preventDefault());
sidebarEl.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const close = el.closest<HTMLElement>("[data-close]")?.dataset.close;
  if (close) {
    const t = byId(close);
    if (t) void closeTab(t);
    return;
  }
  const item = el.closest<HTMLElement>(".sb-item, [data-new], [data-reveal]");
  if (!item) return;
  if (item.dataset.tab) activate(byId(item.dataset.tab)!);
  else if (item.dataset.path) void openNote({ path: item.dataset.path, name: item.dataset.name ?? "" });
  else if ("new" in item.dataset) newDraft();
  else if ("reveal" in item.dataset) return void revealNotesDir();
  if (!sidebarSticky) closeSidebar();
});
document.addEventListener("pointerdown", (e) => {
  if (sidebarOpen && !sidebarEl.contains(e.target as Node) && !sideBtn.contains(e.target as Node)) closeSidebar();
});

// ---------------------------------------------------------------------------
// Palette : notes (⌘P) et actions (« / »)
// ---------------------------------------------------------------------------

function shortDir() {
  const parts = notesDir.split(/[\\/]/).filter(Boolean);
  if (/Mobile Documents/.test(notesDir)) return `iCloud › ${parts.slice(-1)[0] ?? ""}`;
  const od = parts.findIndex((p) => /^OneDrive/i.test(p));
  if (od >= 0) return `OneDrive › ${parts.slice(od + 1).join(" › ") || "racine"}`;
  return parts.slice(-2).join(" › ");
}

interface Action {
  title: string;
  keys?: string;
  kbd?: string;
  icon: string;
  run: () => unknown;
  when?: () => boolean;
  active?: () => boolean;
  sub?: () => string;
}

const actions: Action[] = [
  {
    title: "Installer la mise à jour",
    keys: "update upgrade mise a jour installer nouvelle version",
    icon: "download",
    run: () => pendingUpdate && installUpdate(pendingUpdate),
    when: () => !!pendingUpdate,
    sub: () => `version ${pendingUpdate?.version}`,
  },
  { title: "Nouvelle note", keys: "new creer ajouter brouillon", kbd: `${MOD}N`, icon: "plus", run: () => newDraft() },
  { title: "Enregistrer", keys: "save sauver", kbd: `${MOD}S`, icon: "save", run: save },
  { title: "Renommer", keys: "rename nom", icon: "rename", run: () => rename() },
  {
    title: "Vue consultation",
    keys: "preview lecture apercu rendu markdown",
    kbd: `${MOD}E`,
    icon: "eye",
    run: togglePreview,
    when: () => !active.preview,
  },
  { title: "Revenir à l'édition", keys: "edit editer", kbd: `${MOD}E`, icon: "draft", run: togglePreview, when: () => !!active.preview },
  { title: "Rechercher dans la note", keys: "find chercher trouver", kbd: `${MOD}F`, icon: "find", run: () => findInNote() },
  { title: "Changer d'onglet", keys: "switch tabs onglets", kbd: `${CTRL}Espace`, icon: "tabs", run: () => openSwitcher(1) },
  { title: "Afficher le menu", keys: "sidebar menu liste notes", kbd: `${MOD}\\`, icon: "sidebar", run: () => openSidebar(true) },
  { title: "Fermer l'onglet", keys: "close", kbd: `${MOD}W`, icon: "close", run: () => closeTab() },
  { title: "Mettre à la corbeille", keys: "supprimer delete trash effacer", icon: "trash", run: () => trash() },
  { title: "Thème clair", keys: "light blanc theme", icon: "sun", run: () => setTheme("light"), active: () => theme === "light" },
  { title: "Thème sombre", keys: "dark noir theme", icon: "moon", run: () => setTheme("dark"), active: () => theme === "dark" },
  { title: "Thème du système", keys: "auto theme", icon: "auto", run: () => setTheme("system"), active: () => theme === "system" },
  { title: "Choisir le dossier des notes", keys: "icloud onedrive dropbox cloud sync dossier folder", icon: "cloud", run: chooseNotesDir },
  { title: "Ouvrir le dossier des notes", keys: "finder explorateur reveal", icon: "folder", run: revealNotesDir },
  {
    title: "Titres de taille normale en édition",
    keys: "titres compacts heading h1 taille police reglage parametre",
    icon: "rename",
    run: () => setFlatHeadings(true),
    when: () => !flatHeadings,
  },
  {
    title: "Titres agrandis en édition",
    keys: "titres grands heading h1 taille police reglage parametre",
    icon: "rename",
    run: () => setFlatHeadings(false),
    when: () => flatHeadings,
  },
  { title: "Agrandir le texte", keys: "zoom plus", kbd: `${MOD}+`, icon: "zoomIn", run: () => setZoom(zoom + 1) },
  { title: "Réduire le texte", keys: "zoom moins", kbd: `${MOD}−`, icon: "zoomOut", run: () => setZoom(zoom - 1) },
  { title: "Taille normale", keys: "zoom reset", kbd: `${MOD}0`, icon: "zoomReset", run: () => setZoom(16) },
  { title: "Plein écran", keys: "fullscreen", kbd: isMac ? "⌃⌘F" : "F11", icon: "expand", run: toggleFullscreen },
  { title: "Raccourcis clavier", keys: "aide help shortcuts", icon: "keyboard", run: () => showShortcuts() },
  {
    title: "Rechercher une mise à jour",
    keys: "update upgrade mise a jour version verifier",
    icon: "refresh",
    run: () => checkForUpdate(true),
    sub: () => `version ${appVersion}`,
  },
  { title: "Quitter", keys: "quit exit", kbd: `${MOD}Q`, icon: "power", run: quit },
];

const searchFooter = (q: string) =>
  q.startsWith("/")
    ? `<span><kbd>↵</kbd> exécuter</span><span><kbd>⇥</kbd> compléter</span><span><kbd>⌫</kbd> notes</span><span><kbd>esc</kbd> fermer</span><span class="pal-ver">Billy Note ${esc(appVersion)}</span>`
    : `<span><kbd>↑↓</kbd> naviguer</span><span><kbd>↵</kbd> ouvrir</span><span><kbd>/</kbd> actions</span><span><kbd>esc</kbd> fermer</span>`;

function actionItems(q: string): Item[] {
  return actions
    .filter((a) => !a.when || a.when())
    .map((a) => ({ a, m: fuzzy(q, a.title) ?? (q && fuzzy(q, a.keys ?? "") ? { score: -50, hits: [] } : null) }))
    .filter((x): x is { a: Action; m: { score: number; hits: number[] } } => !!x.m)
    .sort((x, y) => (q ? y.m.score - x.m.score : 0))
    .map(({ a, m }) => ({
      title: a.title,
      titleHtml: highlight(a.title, m.hits),
      kbd: a.kbd,
      icon: a.icon,
      active: a.active?.(),
      sub: a.active?.() ? "actuel" : a.title.startsWith("Choisir le dossier") ? shortDir() : a.sub?.(),
      run: a.run,
    }));
}

function noteItems(q: string): Item[] {
  const ordered = [...mru.map(byId).filter((t): t is Tab => !!t), ...tabs.filter((t) => !mru.includes(t.id))];
  const tabItems = ordered.map((t) => ({
    text: titleOf(t),
    item: {
      title: titleOf(t),
      sub: t.kind === "draft" ? "brouillon" : notes.find((n) => n.path === t.path)?.folder || "",
      meta: t === active ? "actuel" : "ouvert",
      icon: t.kind === "draft" ? "draft" : "note",
      active: t === active,
      run: () => activate(t),
    } as Item,
  }));
  const fileItems = notes
    .filter((n) => !tabs.some((t) => t.path === n.path))
    .map((n) => ({
      text: n.name,
      item: { title: n.name, sub: n.folder, meta: relDate(n.modified), icon: "note", run: () => openNote(n) } as Item,
    }));
  const all = [...tabItems, ...fileItems];
  if (!q.trim()) return all.slice(0, 60).map((x) => x.item);
  const found = all
    .map((x) => ({ x, m: fuzzy(q, x.text) }))
    .filter((r) => r.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .slice(0, 60)
    .map(({ x, m }): Item => ({ ...x.item, titleHtml: highlight(x.item.title, m!.hits) }));
  const name = q.trim();
  found.push({ title: `Créer « ${name} »`, sub: shortDir(), icon: "plus", run: () => createNamed(name) });
  return found;
}

function openPalette(initial = "") {
  closeSidebar();
  palette.open({
    placeholder: "Rechercher une note…   / pour les actions",
    initial,
    items: (q) => (q.startsWith("/") ? actionItems(q.slice(1)) : noteItems(q)),
    footer: searchFooter,
    heading: (q) => (q.startsWith("/") ? "Actions" : q.trim() ? undefined : notes.length || tabs.length > 1 ? "Récents" : undefined),
  });
  refreshNotes();
}

function prompt(o: {
  label: string;
  placeholder: string;
  initial?: string;
  select?: boolean;
  verb: string;
  sub?: string;
  run: (v: string) => unknown;
}): Source {
  return {
    label: o.label,
    placeholder: o.placeholder,
    initial: o.initial,
    selectInitial: o.select,
    items: (q) =>
      q.trim()
        ? [{ title: `${o.verb} « ${q.trim()} »`, sub: o.sub, icon: "save", run: () => o.run(q.trim()) }]
        : [{ title: "Tapez un nom", icon: "rename", disabled: true }],
    footer: () => `<span><kbd>↵</kbd> valider</span><span><kbd>esc</kbd> annuler</span>`,
  };
}

function ask(question: string, choices: Item[]) {
  palette.open({
    label: question,
    placeholder: "Choisir…",
    items: (q) => choices.filter((c) => fuzzy(q, c.title)),
    footer: () => `<span><kbd>↑↓</kbd> choisir</span><span><kbd>↵</kbd> valider</span><span><kbd>esc</kbd> annuler</span>`,
  });
}

function showShortcuts() {
  const list: [string, string][] = [
    ["Rechercher une note", `${MOD}P`],
    ["Actions", `${MOD}P puis /   ou   ${MOD}K`],
    ["Changer d'onglet", `${CTRL}Espace  (maintenir ${CTRL.replace("+", "")})`],
    ["Onglet 1 à 9", `${MOD}1…9`],
    ["Nouvelle note", `${MOD}N`],
    ["Enregistrer / nommer", `${MOD}S`],
    ["Vue consultation", `${MOD}E`],
    ["Rechercher dans la note", `${MOD}F`],
    ["Menu des notes", `${MOD}\\  ou bord gauche`],
    ["Fermer l'onglet", `${MOD}W`],
    ["Taille du texte", `${MOD}+  ${MOD}−  ${MOD}0`],
    ["Déplacer la fenêtre", "glisser une marge ou le bord du haut"],
  ];
  palette.open({
    label: "Raccourcis clavier",
    placeholder: "Filtrer…",
    items: (q) =>
      list.filter(([t]) => fuzzy(q, t)).map(([t, k]) => ({ title: t, kbd: k, icon: "keyboard", disabled: true })),
    footer: () => `<span><kbd>esc</kbd> fermer</span>`,
  });
}

function openSwitcher(step: number, byCtrl = false) {
  palette.close();
  closeSidebar();
  const ordered = [...mru.map(byId).filter((t): t is Tab => !!t), ...tabs.filter((t) => !mru.includes(t.id))];
  switcher.open(
    ordered.map((t) => ({
      id: t.id,
      title: titleOf(t),
      sub: t.kind === "draft" ? "brouillon" : "",
      icon: t.kind === "draft" ? "draft" : "note",
    })),
    step,
    byCtrl,
  );
}

function findInNote() {
  if (active.preview) togglePreview();
  requestAnimationFrame(() => openSearchPanel(view));
}

// ---------------------------------------------------------------------------
// Dossier des notes
// ---------------------------------------------------------------------------

let refreshing: Promise<void> | null = null;
function refreshNotes() {
  refreshing ??= api
    .listNotes()
    .then((n) => {
      notes = n;
      if (palette.isOpen) palette.refresh();
      if (sidebarOpen) renderSidebar();
    })
    .catch(() => {})
    .finally(() => (refreshing = null));
}

async function chooseNotesDir() {
  const picked = await openDialog({ directory: true, defaultPath: notesDir, title: "Dossier des notes (iCloud Drive, OneDrive…)" });
  if (typeof picked !== "string") return;
  try {
    notesDir = await api.setNotesDir(picked);
    refreshNotes();
    toast(`Notes enregistrées dans ${shortDir()}`);
  } catch (e) {
    toast(`Dossier inutilisable : ${e}`);
  }
}

async function revealNotesDir() {
  try {
    await revealItemInDir(notesDir);
  } catch {
    toast("Le dossier n'existe pas encore : enregistrez une première note");
  }
}

// ---------------------------------------------------------------------------
// Mises à jour (releases GitHub, signées) : vérifiées au lancement puis toutes
// les 12 h, ou à la demande depuis ⌘K.
// ---------------------------------------------------------------------------

let appVersion = "";
let pendingUpdate: Update | null = null;
let updating = false;

async function checkForUpdate(manual: boolean) {
  if (updating) return;
  if (manual) toast("Recherche de mises à jour…", 15000);
  try {
    const update = await check();
    pendingUpdate = update;
    if (!update) {
      if (manual) toast(`Billy Note est à jour (version ${appVersion})`, 3000);
    } else if (manual) {
      toastEl.classList.remove("show");
      ask(`Billy Note ${update.version} est disponible (version actuelle : ${appVersion})`, [
        { title: "Installer et redémarrer", icon: "download", run: () => installUpdate(update) },
        { title: "Plus tard", icon: "close", run: () => {} },
      ]);
    } else {
      toast(`Billy Note ${update.version} est disponible : ${MOD}K pour l'installer`, 8000);
    }
  } catch (e) {
    if (manual) toast(`Impossible de vérifier les mises à jour : ${e}`, 5000);
  }
}

async function installUpdate(update: Update) {
  if (updating) return;
  updating = true;
  try {
    // Notes et brouillons d'abord : l'installation ferme l'application.
    await flushAll();
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        received += ev.data.chunkLength;
        const pct = total ? ` ${Math.min(100, Math.round((received / total) * 100))} %` : "";
        toast(`Téléchargement de la mise à jour…${pct}`, 60000);
      } else toast("Installation de la mise à jour…", 60000);
    });
    await relaunch();
  } catch (e) {
    updating = false;
    toast(`Échec de la mise à jour : ${e}`, 5000);
  }
}

async function quit() {
  await flushAll();
  await api.quit();
}

// ---------------------------------------------------------------------------
// Petits retours visuels
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// Barre de défilement visible seulement pendant le défilement ou près du bord.
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
function onScroll(e: Event) {
  appEl.classList.add("scrolling");
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => appEl.classList.remove("scrolling"), 900);
  void e;
}
view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
previewEl.addEventListener("scroll", onScroll, { passive: true });

document.addEventListener(
  "wheel",
  (e) => {
    if (e.deltaY < -4 && !overlayEl.contains(e.target as Node) && !sidebarEl.contains(e.target as Node)) showTabs();
  },
  { passive: true },
);

document.addEventListener("mousemove", (e) => {
  appEl.classList.toggle("near-bar", e.clientX > window.innerWidth - 18);
  if (e.buttons === 0) appEl.classList.toggle("in-margin", inMargin(e));
  if (e.clientY < 44 && !sidebarOpen) showTabs(900);
});

previewEl.tabIndex = -1;
previewEl.addEventListener("dblclick", (e) => {
  if (!(e.target as HTMLElement).closest("input")) togglePreview();
});
previewEl.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
});

// Cases à cocher de la vue consultation : modifient le « [ ] » de la source.
// La n-ième case rendue correspond au n-ième marqueur de tâche de l'arbre
// syntaxique ; si les deux analyseurs ne sont pas d'accord, on ne touche à rien.
function taskMarkers(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 400) ?? syntaxTree(state);
  const out: { from: number; to: number }[] = [];
  tree.iterate({ enter: (n) => void (n.name === "TaskMarker" && out.push({ from: n.from, to: n.to })) });
  return out;
}

previewEl.addEventListener("change", (e) => {
  const box = e.target as HTMLInputElement;
  if (box.dataset.task === undefined) return;
  const marks = taskMarkers(view.state);
  const m = marks[Number(box.dataset.task)];
  if (!m || marks.length !== previewEl.querySelectorAll("input[data-task]").length) {
    box.checked = !box.checked;
    toast(`Cette case ne peut pas être cochée ici : passez en édition (${MOD}E)`);
    return;
  }
  view.dispatch({ changes: { from: m.from + 1, to: m.to - 1, insert: box.checked ? "x" : " " }, userEvent: "input.toggle" });
});

// ---------------------------------------------------------------------------
// Déplacer la fenêtre depuis les marges autour du texte (et le bord du haut).
// ---------------------------------------------------------------------------

/** Le pointeur est-il dans les marges, hors de la colonne de texte ? */
function inMargin(e: MouseEvent): boolean {
  if (!active) return false;
  const scroller = active.preview ? previewEl : view.scrollDOM;
  const col = active.preview ? previewEl.querySelector<HTMLElement>(".prose") : view.contentDOM;
  if (!col || !scroller.contains(e.target as Node)) return false;
  const box = scroller.getBoundingClientRect();
  if (e.clientX >= box.left + scroller.clientWidth) return false; // barre de défilement
  const r = col.getBoundingClientRect();
  const cs = getComputedStyle(col);
  // Un peu de tolérance autour du texte pour garder le clic « début de ligne ».
  return (
    e.clientX < r.left + parseFloat(cs.paddingLeft) - 16 ||
    e.clientX > r.right - parseFloat(cs.paddingRight) + 16 ||
    e.clientY < r.top + parseFloat(cs.paddingTop) - 16 ||
    e.clientY > r.bottom - parseFloat(cs.paddingBottom) + 40
  );
}

function onMarginDown(e: MouseEvent) {
  if (e.button !== 0 || !inMargin(e)) return;
  e.preventDefault();
  e.stopPropagation();
  // Le double-clic reste disponible (retour à l'édition depuis la consultation).
  if (e.detail === 1) void getCurrentWindow().startDragging();
}
editorEl.addEventListener("mousedown", onMarginDown, true);
previewEl.addEventListener("mousedown", onMarginDown, true);
edgeEl.addEventListener("mousedown", (e) => {
  if (e.button === 0 && e.detail === 1) void getCurrentWindow().startDragging();
});

// ---------------------------------------------------------------------------
// Clavier
// ---------------------------------------------------------------------------

function onKey(e: KeyboardEvent) {
  if (switcher.isOpen) {
    switcher.handleKey(e);
    return;
  }
  if (e.type !== "keydown" || palette.isOpen) return;

  const mod = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  const done = () => {
    e.preventDefault();
    e.stopPropagation();
  };

  // ⌃Espace / Ctrl+Tab : sélecteur d'onglets (maintenir Ctrl).
  if (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === "Space" || e.key === "Tab")) {
    done();
    return openSwitcher(e.shiftKey ? -1 : 1, true);
  }

  if (mod && !e.altKey) {
    if (k === "p") return done(), openPalette(e.shiftKey ? "/" : "");
    if (k === "k") return done(), openPalette("/");
    if (k === "n" || k === "t") return done(), newDraft();
    if (k === "s") return done(), void save();
    if (k === "w") return done(), void closeTab();
    if (k === "e") return done(), togglePreview();
    if (k === "q" && !isMac) return done(), void quit();
    if (e.code === "Backslash" || k === "\\") return done(), sidebarOpen ? closeSidebar() : openSidebar(true);
    if (k === "=" || k === "+") return done(), setZoom(zoom + 1);
    if (k === "-") return done(), setZoom(zoom - 1);
    if (e.code === "Digit0" || e.code === "Numpad0") return done(), setZoom(16);
    if (/^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      const t = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
      if (t) activate(t);
      return done();
    }
    if (k === "f" && active.preview) return done(), findInNote();
    if (k === "r" && !import.meta.env.DEV) return done();
  }
  if (e.key === "F5" && !import.meta.env.DEV) return done();
  if (e.key === "F11" && !isMac) return done(), void toggleFullscreen();
  if (e.key === "Escape") {
    if (sidebarOpen) return done(), closeSidebar();
    if (active.preview) return done(), togglePreview();
  }
}
window.addEventListener("keydown", onKey, true);
window.addEventListener("keyup", onKey, true);
window.addEventListener("blur", () => switcher.isOpen && switcher.commit());
document.addEventListener("mousemove", (e) => switcher.isOpen && !e.ctrlKey && e.buttons === 0 && switcher.byCtrl && switcher.commit());

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

async function restore() {
  const raw = await api.loadSession().catch(() => null);
  let s: Partial<Session> = {};
  try {
    s = raw ? JSON.parse(raw) : {};
  } catch {
    /* session illisible : on repart de zéro */
  }
  theme = s.theme ?? "system";
  zoom = s.zoom ?? 16;
  flatHeadings = s.flatHeadings ?? false;

  const restored = await Promise.all(
    (s.tabs ?? []).map(async (t): Promise<Tab | null> => {
      if (t.kind !== "file" || !t.path) return { ...t, kind: "draft" };
      try {
        const { content, mtime } = await api.readNote(t.path);
        // Contenu de session non vide et différent : modifications pas encore écrites.
        const pending = t.content && t.content !== content ? t.content : null;
        return { ...t, content: pending ?? content, disk: content, mtime };
      } catch {
        return t.content ? { ...t, kind: "draft", path: undefined, name: undefined } : null;
      }
    }),
  );
  tabs = restored.filter((t): t is Tab => !!t);
  mru = (s.mru ?? []).filter((id) => byId(id));
  applyTheme();
  setZoom(zoom);
  setFlatHeadings(flatHeadings);
  if (!tabs.length) tabs.push({ id: uid(), kind: "draft", content: "" });
  activate(byId(s.active) ?? tabs[0], { flash: false });
  for (const t of tabs) if (t.kind === "file" && contentOf(t) !== t.disk) scheduleWrite(t);
}

async function init() {
  appVersion = (await getVersion().catch(() => "")) || "dev";
  try {
    const info = await api.appInfo();
    notesDir = info.notes_dir;
    await restore();
    refreshNotes();
  } catch (e) {
    console.error(e);
    if (!active) {
      tabs = [{ id: uid(), kind: "draft", content: "" }];
      activate(tabs[0], { flash: false });
    }
  } finally {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
    focusContent();
  }

  window.addEventListener("focus", () => {
    void checkExternal();
    refreshNotes();
  });
  window.addEventListener("blur", () => void saveSession());
  document.addEventListener("visibilitychange", () => void saveSession());
  void syncFullscreen();
  if (!import.meta.env.DEV) {
    setTimeout(() => void checkForUpdate(false), 5000);
    setInterval(() => void checkForUpdate(false), 12 * 3600e3);
  }
  await getCurrentWindow().onResized(() => void syncFullscreen());
  await listen("quit-requested", () => void quit());
  await getCurrentWindow().onCloseRequested(async () => {
    await flushAll();
  });
}

void init();
