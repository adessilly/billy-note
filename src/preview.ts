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

export async function renderPreview(el: HTMLElement, source: string): Promise<void> {
  const token = ++renderToken;
  const html = DOMPurify.sanitize(await marked.parse(source), { ADD_ATTR: ["target"] });
  if (token !== renderToken) return;
  const body = document.createElement("div");
  body.className = "prose";
  body.innerHTML = html || `<p class="empty">Note vide</p>`;
  el.replaceChildren(body);

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
