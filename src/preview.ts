// Vue consultation : rendu Markdown, avec les blocs de code colorés par les
// mêmes grammaires et la même palette que l'éditeur.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { highlightCode } from "@lezer/highlight";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightStyle } from "./editor";
import { api } from "./backend";
import { resolvePath } from "./util";

marked.setOptions({ gfm: true, breaks: true });

let renderToken = 0;

const BLOCK = /^(UL|OL|P|DIV|PRE|BLOCKQUOTE|TABLE|H[1-6])$/;

/** Cases à cocher des listes de tâches : cliquables, nommées, texte entourable. */
function enableTasks(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box, i) => {
    box.removeAttribute("disabled");
    box.dataset.task = String(i);
    box.closest("li")?.classList.add("task");
    // Le texte de la tâche (jusqu'à une éventuelle sous-liste) dans un span,
    // pour l'atténuer une fois cochée sans toucher aux sous-tâches.
    const text = document.createElement("span");
    text.className = "task-text";
    while (box.nextSibling && !(box.nextSibling instanceof HTMLElement && BLOCK.test(box.nextSibling.tagName))) {
      text.append(box.nextSibling);
    }
    if (text.firstChild instanceof Text) text.firstChild.data = text.firstChild.data.replace(/^\s+/, "");
    box.after(text);
    const label = text.textContent?.trim().replace(/\s+/g, " ").slice(0, 120);
    box.setAttribute("aria-label", label || "Tâche");
  });
}

const MIME: Record<string, string> = { svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const imageUrls = new Map<string, Promise<string | null>>();

/** URL affichable d'une image du dossier des notes (lue par le backend, mise en cache). */
function imageUrl(path: string): Promise<string | null> {
  let url = imageUrls.get(path);
  if (!url) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    url = api
      .readImage(path)
      .then((buf) => (buf ? URL.createObjectURL(new Blob([buf], { type: MIME[ext] ?? "image/png" })) : null))
      .catch(() => null);
    imageUrls.set(path, url);
    // Une image absente pourra être retrouvée plus tard (synchro en cours…).
    void url.then((u) => u || imageUrls.delete(path));
  }
  return url;
}

/** Images à chemin relatif (« images/… ») : résolues depuis le dossier de la note. */
function loadImages(root: ParentNode, baseDir: string) {
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!src || /^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(src)) continue;
    let rel = src;
    try {
      rel = decodeURIComponent(src);
    } catch {
      /* chemin non encodé */
    }
    img.removeAttribute("src");
    void imageUrl(resolvePath(baseDir, rel)).then((url) => {
      if (url) img.src = url;
      else img.classList.add("missing");
    });
  }
}

export async function renderPreview(el: HTMLElement, source: string, baseDir = ""): Promise<void> {
  const token = ++renderToken;
  const html = DOMPurify.sanitize(await marked.parse(source), { ADD_ATTR: ["target"] });
  if (token !== renderToken) return;
  const body = document.createElement("div");
  body.className = "prose";
  // Gabarit inerte : les images relatives ne sont pas chargées avant d'être résolues.
  const tpl = document.createElement("template");
  tpl.innerHTML = html || `<p class="empty">Note vide</p>`;
  if (baseDir) loadImages(tpl.content, baseDir);
  body.append(tpl.content);
  el.replaceChildren(body);
  enableTasks(body);

  for (const code of Array.from(body.querySelectorAll<HTMLElement>("pre > code"))) {
    const lang = Array.from(code.classList).find((c) => c.startsWith("language-"))?.slice(9);
    if (!lang) continue;
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    if (!desc) continue;
    try {
      const support = desc.support ?? (await desc.load());
      if (token !== renderToken) return;
      const text = code.textContent ?? "";
      const tree = support.language.parser.parse(text);
      const frag = document.createDocumentFragment();
      highlightCode(
        text,
        tree,
        highlightStyle,
        (txt, cls) => {
          if (!cls) return frag.append(txt);
          const span = document.createElement("span");
          span.className = cls;
          span.textContent = txt;
          frag.append(span);
        },
        () => frag.append("\n"),
      );
      code.replaceChildren(frag);
      code.parentElement?.setAttribute("data-lang", desc.name);
    } catch {
      /* langage indisponible : on laisse le texte brut */
    }
  }
}
