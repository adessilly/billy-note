// Éditeur CodeMirror : Markdown visible et coloré, blocs de code colorés
// selon leur langage (css, js, html, rust, python…), aucune interface.

import { EditorSelection, EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  type Panel,
  placeholder,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  search,
  searchKeymap,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

export const highlightStyle = HighlightStyle.define([
  // Markdown
  // Titres : classes CSS (voir styles.css) pour pouvoir garder la taille du texte
  // en édition si le réglage « Titres de taille normale » est actif.
  { tag: t.heading1, class: "cm-h cm-h1" },
  { tag: t.heading2, class: "cm-h cm-h2" },
  { tag: t.heading3, class: "cm-h cm-h3" },
  { tag: [t.heading4, t.heading5, t.heading6], class: "cm-h" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.88em", color: "var(--code-inline)" },
  { tag: t.quote, color: "var(--muted)" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--marker)" },
  { tag: t.labelName, color: "var(--muted)" },
  // Code
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--syn-property)" },
  { tag: t.tagName, color: "var(--syn-tag)" },
  { tag: t.attributeName, color: "var(--syn-attr)" },
  { tag: [t.operator, t.derefOperator], color: "var(--syn-operator)" },
  { tag: [t.definition(t.variableName), t.constant(t.variableName)], color: "var(--syn-def)" },
  { tag: [t.meta, t.annotation, t.self], color: "var(--syn-keyword)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

/** Décorations de lignes : fond des blocs de code, citations, règles, puces. */
const blockDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const out: Range<Decoration>[] = [];
      const doc = view.state.doc;
      const lineDeco = (from: number, to: number, cls: string) => {
        const first = doc.lineAt(from).number;
        const last = doc.lineAt(Math.max(from, to - (to > from && doc.lineAt(to).from === to ? 1 : 0))).number;
        for (let n = first; n <= last; n++) {
          let c = cls;
          if (n === first) c += ` ${cls}-first`;
          if (n === last) c += ` ${cls}-last`;
          out.push(Decoration.line({ class: c }).range(doc.line(n).from));
        }
      };
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            switch (node.name) {
              case "FencedCode":
              case "CodeBlock":
                lineDeco(node.from, node.to, "cm-codeblock");
                return false;
              case "Blockquote":
                lineDeco(node.from, node.to, "cm-quote");
                break;
              case "HorizontalRule":
                out.push(Decoration.line({ class: "cm-hr" }).range(doc.lineAt(node.from).from));
                break;
              case "ListMark":
                out.push(Decoration.mark({ class: "cm-listmark" }).range(node.from, node.to));
                break;
              case "TaskMarker":
                out.push(Decoration.mark({ class: "cm-taskmark" }).range(node.from, node.to));
                break;
            }
          },
        });
      }
      return Decoration.set(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Recherche minimaliste : un seul champ flottant, sans boutons. */
function searchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "find";
  const input = document.createElement("input");
  input.placeholder = "Rechercher dans la note";
  input.spellcheck = false;
  input.setAttribute("main-field", "true");
  input.value = getSearchQuery(view.state).search;
  const count = document.createElement("span");
  count.className = "find-count";
  dom.append(input, count);

  const refresh = () => {
    const q = getSearchQuery(view.state);
    if (!q.search || !q.valid) return (count.textContent = "");
    let n = 0;
    const cur = q.getCursor(view.state);
    while (!cur.next().done && n < 999) n++;
    count.textContent = n ? String(n) : "0";
  };
  input.addEventListener("input", () => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value })) });
    refresh();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });
  return {
    dom,
    top: true,
    mount: () => {
      input.select();
      refresh();
    },
    update: (u) => {
      if (u.docChanged) refresh();
    },
  };
}

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--fg)", backgroundColor: "transparent", fontSize: "var(--fs)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-text)", lineHeight: "1.7" },
  ".cm-content": { caretColor: "var(--caret)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--caret)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--sel) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--match)" },
  ".cm-searchMatch": { backgroundColor: "var(--match)", borderRadius: "2px" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--match-strong)" },
  ".cm-matchingBracket": { backgroundColor: "var(--match)", outline: "none" },
  ".cm-placeholder": { color: "var(--marker)" },
});

/** Petit texte d'accueil affiché quand la note est vide. */
function emptyHint(isMac: boolean): HTMLElement {
  const el = document.createElement("span");
  const mod = isMac ? "⌘" : "Ctrl+";
  el.innerHTML = `Écrivez…<br><span class="hint">${mod}P rechercher · ${mod}K actions · ${isMac ? "⌃" : "Ctrl+"}Espace onglets</span>`;
  return el;
}

export function baseExtensions(isMac: boolean, onChange: (u: ViewUpdate) => void): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off" }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
    syntaxHighlighting(highlightStyle),
    blockDecorations,
    search({ top: true, createPanel: searchPanel }),
    placeholder(emptyHint(isMac)),
    keymap.of([...markdownKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    theme,
    EditorView.updateListener.of(onChange),
  ];
}

export function createState(
  doc: string,
  extensions: Extension[],
  sel?: { anchor: number; head: number },
): EditorState {
  const len = doc.length;
  const clamp = (n: number) => Math.max(0, Math.min(len, n));
  return EditorState.create({
    doc,
    extensions,
    selection: sel ? EditorSelection.single(clamp(sel.anchor), clamp(sel.head)) : undefined,
  });
}
