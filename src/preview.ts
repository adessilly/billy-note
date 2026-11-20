// Vue consultation : rendu Markdown, avec les blocs de code colorés par les
// mêmes grammaires et la même palette que l'éditeur.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { highlightCode } from "@lezer/highlight";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightStyle } from "./editor";

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

export async function renderPreview(el: HTMLElement, source: string): Promise<void> {
  const token = ++renderToken;
  const html = DOMPurify.sanitize(await marked.parse(source), { ADD_ATTR: ["target"] });
  if (token !== renderToken) return;
  const body = document.createElement("div");
  body.className = "prose";
  body.innerHTML = html || `<p class="empty">Note vide</p>`;
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
