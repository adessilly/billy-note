// Palette de commandes (⌘P / Ctrl+P) et sélecteur d'onglets (⌃Espace).

import { icon } from "./icons";
import { esc } from "./util";

export interface Item {
  title: string;
  /** Titre déjà mis en forme (HTML échappé + <mark>). */
  titleHtml?: string;
  sub?: string;
  /** Sous-titre déjà mis en forme (HTML échappé + <mark>). */
  subHtml?: string;
  /** Titre de section affiché au-dessus de cet élément. */
  heading?: string;
  meta?: string;
  kbd?: string;
  icon?: string;
  active?: boolean;
  /** Élément purement informatif (non sélectionnable). */
  disabled?: boolean;
  run?: () => unknown;
}

export interface Source {
  placeholder: string;
  /** Petit libellé au-dessus du champ (mode question). */
  label?: string;
  initial?: string;
  /** Sélectionne le texte initial (utile pour renommer). */
  selectInitial?: boolean;
  items: (query: string) => Item[];
  footer: (query: string) => string;
  /** Section à afficher au-dessus de la liste selon la requête. */
  heading?: (query: string) => string | undefined;
}

export class Palette {
  private card: HTMLDivElement;
  private input: HTMLInputElement;
  private labelEl: HTMLDivElement;
  private list: HTMLDivElement;
  private foot: HTMLDivElement;
  private items: Item[] = [];
  private sel = 0;
  private src?: Source;
  isOpen = false;
  onClose?: () => void;

  constructor(private overlay: HTMLElement) {
    this.card = document.createElement("div");
    this.card.className = "palette";
    this.card.innerHTML = `<div class="pal-label"></div><div class="pal-input">${icon("search")}<input spellcheck="false" autocomplete="off" /></div><div class="pal-list" role="listbox"></div><div class="pal-foot"></div>`;
    this.labelEl = this.card.querySelector(".pal-label")!;
    this.input = this.card.querySelector("input")!;
    this.list = this.card.querySelector(".pal-list")!;
    this.foot = this.card.querySelector(".pal-foot")!;

    this.input.addEventListener("input", () => this.refresh(true));
    this.input.addEventListener("keydown", (e) => this.handleKey(e));
    // Le champ garde toujours le focus : un clic dans la carte ne le lui retire pas.
    this.card.addEventListener("mousedown", (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    // Un clic hors de la carte la ferme.
    overlay.addEventListener("mousedown", (e) => {
      if (this.isOpen && e.target === overlay) {
        e.preventDefault();
        this.close();
      }
    });
    this.list.addEventListener("mousemove", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (el && Number(el.dataset.i) !== this.sel) this.select(Number(el.dataset.i), false);
    });
    this.list.addEventListener("mousedown", (e) => e.preventDefault());
    this.list.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (el) this.run(Number(el.dataset.i));
    });
  }

  open(src: Source) {
    this.src = src;
    this.overlay.replaceChildren(this.card);
    this.overlay.hidden = false;
    this.overlay.classList.remove("switching");
    requestAnimationFrame(() => this.overlay.classList.add("show"));
    this.isOpen = true;
    this.labelEl.textContent = src.label ?? "";
    this.labelEl.hidden = !src.label;
    this.input.placeholder = src.placeholder;
    this.input.value = src.initial ?? "";
    this.card.classList.toggle("asking", !!src.label);
    this.refresh(true);
    this.input.focus();
    if (src.selectInitial) this.input.select();
  }

  /** Met à jour la liste (ex. quand les notes du dossier ont été rechargées). */
  refresh(resetSel = false) {
    if (!this.src) return;
    const q = this.input.value;
    this.items = this.src.items(q);
    if (resetSel) this.sel = 0;
    this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
    if (this.items[this.sel]?.disabled) this.sel = Math.max(0, this.items.findIndex((i) => !i.disabled));
    const heading = this.src.heading?.(q);
    this.list.innerHTML =
      (heading ? `<div class="pal-heading">${esc(heading)}</div>` : "") +
      this.items
        .map(
          (it, i) => `${it.heading ? `<div class="pal-heading">${esc(it.heading)}</div>` : ""}<div class="pal-item${i === this.sel ? " sel" : ""}${it.disabled ? " disabled" : ""}${it.active ? " current" : ""}" data-i="${it.disabled ? "" : i}" role="option">
            <span class="pal-ico">${icon(it.icon ?? "note")}</span>
            <span class="pal-text"><span class="pal-title">${it.titleHtml ?? esc(it.title)}</span>${it.subHtml ? `<span class="pal-sub">${it.subHtml}</span>` : it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ""}</span>
            ${it.meta ? `<span class="pal-meta">${esc(it.meta)}</span>` : ""}
            ${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}
          </div>`,
        )
        .join("");
    this.list.classList.toggle("empty", !this.items.length);
    this.foot.innerHTML = this.src.footer(q);
    this.scrollToSel();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.remove("show");
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
    this.onClose?.();
  }

  private select(i: number, scroll = true) {
    this.list.querySelector(".sel")?.classList.remove("sel");
    this.sel = i;
    this.list.querySelector(`[data-i="${i}"]`)?.classList.add("sel");
    if (scroll) this.scrollToSel();
  }

  private scrollToSel() {
    this.list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }

  private move(d: number) {
    const n = this.items.length;
    if (!n) return;
    let i = this.sel;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!this.items[i].disabled) break;
    }
    this.select(i);
  }

  private run(i: number) {
    const it = this.items[i];
    if (!it || it.disabled || !it.run) return;
    this.close();
    void it.run();
  }

  /** Remet le focus dans le champ (si une autre zone l'a pris). */
  focus() {
    if (document.activeElement !== this.input) this.input.focus();
  }

  handleKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      this.move(1);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p" && !e.metaKey)) {
      e.preventDefault();
      this.move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.run(this.sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "Tab") {
      // Tab complète une action : « /th » → « /thème sombre ».
      e.preventDefault();
      const it = this.items[this.sel];
      if (it && this.input.value.startsWith("/")) {
        this.input.value = "/" + it.title.toLowerCase();
        this.refresh();
      }
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.input.select();
    }
    e.stopPropagation();
  }
}

/** Sélecteur d'onglets façon Alt+Tab : maintenir Ctrl, appuyer sur Espace. */
export class Switcher {
  private card: HTMLDivElement;
  private entries: { id: string; title: string; sub: string; icon: string }[] = [];
  private sel = 0;
  isOpen = false;
  byCtrl = false;

  constructor(private overlay: HTMLElement, private onPick: (id: string) => void) {
    this.card = document.createElement("div");
    this.card.className = "switcher";
    this.card.addEventListener("mousedown", (e) => e.preventDefault());
    this.card.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (el) {
        this.sel = Number(el.dataset.i);
        this.commit();
      }
    });
  }

  open(entries: Switcher["entries"], step: number, byCtrl = false) {
    this.byCtrl = byCtrl;
    this.entries = entries;
    this.sel = entries.length > 1 ? (step > 0 ? 1 : entries.length - 1) : 0;
    this.isOpen = true;
    this.overlay.replaceChildren(this.card);
    this.overlay.hidden = false;
    this.overlay.classList.add("switching");
    requestAnimationFrame(() => this.overlay.classList.add("show"));
    this.render();
  }

  step(d: number) {
    const n = this.entries.length;
    this.sel = (this.sel + d + n) % n;
    this.render();
  }

  commit() {
    const e = this.entries[this.sel];
    this.close();
    if (e) this.onPick(e.id);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.remove("show", "switching");
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  /** Renvoie true si la touche a été consommée. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.type === "keyup") {
      if (this.byCtrl && (e.key === "Control" || !e.ctrlKey)) this.commit();
      return true;
    }
    e.preventDefault();
    if (e.code === "Space" || e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowRight") this.step(e.shiftKey ? -1 : 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") this.step(-1);
    else if (e.key === "Enter") this.commit();
    else if (e.key === "Escape") this.close();
    return true;
  }

  private render() {
    this.card.innerHTML = this.entries
      .map(
        (en, i) => `<div class="sw-item${i === this.sel ? " sel" : ""}" data-i="${i}">
          <span class="pal-ico">${icon(en.icon)}</span>
          <span class="pal-text"><span class="pal-title">${esc(en.title)}</span>${en.sub ? `<span class="pal-sub">${esc(en.sub)}</span>` : ""}</span>
        </div>`,
      )
      .join("");
    this.card.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
}
