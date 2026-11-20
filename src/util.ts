// Petits utilitaires : recherche floue, dates relatives, échappement HTML.

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Correspondance floue (sous-séquence), insensible à la casse et aux accents. */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = fold(query.trim());
  if (!q) return { score: 0, hits: [] };
  const s = fold(text);
  // Bonus fort pour une sous-chaîne exacte.
  const exact = s.indexOf(q);
  if (exact >= 0) {
    const start = exact === 0 || /[\s\-_/.]/.test(s[exact - 1]) ? 30 : 0;
    return { score: 100 + start - exact * 0.5 - s.length * 0.05, hits: [...Array(q.length)].map((_, i) => exact + i) };
  }
  const hits: number[] = [];
  let score = 0, last = -2, qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] !== q[qi]) continue;
    if (q[qi] === " ") { qi++; continue; }
    score += i === last + 1 ? 5 : 1;
    if (i === 0 || /[\s\-_/.]/.test(s[i - 1])) score += 4;
    hits.push(i);
    last = i;
    qi++;
  }
  return qi === q.length ? { score: score - s.length * 0.05, hits } : null;
}

const FOLD: Record<string, string> = {};
/** Minuscules sans accents, même longueur que le texte : les positions trouvées
 *  dans la version « pliée » valent pour le texte d'origine. */
export const foldKeep = (s: string) =>
  s
    .replace(/\u0130/g, "I")
    .toLowerCase()
    .replace(/[\u00c0-\u024f\u1e00-\u1eff]/g, (c) => (FOLD[c] ??= c.normalize("NFD")[0]));

/** Chemin `rel` (séparé par « / ») résolu depuis le dossier `base`. */
export function resolvePath(base: string, rel: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const parts = base.split(/[\\/]/);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join(sep);
}

export const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Texte échappé avec les caractères trouvés mis en évidence. */
export function highlight(text: string, hits: number[]): string {
  if (!hits.length) return esc(text);
  const set = new Set(hits);
  let out = "", open = false;
  for (let i = 0; i < text.length; i++) {
    const on = set.has(i);
    if (on && !open) { out += "<mark>"; open = true; }
    if (!on && open) { out += "</mark>"; open = false; }
    out += esc(text[i]);
  }
  return open ? out + "</mark>" : out;
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
const dtf = new Intl.DateTimeFormat("fr", { day: "numeric", month: "short" });
const dtfY = new Intl.DateTimeFormat("fr", { day: "numeric", month: "short", year: "numeric" });

export function relDate(ms: number): string {
  if (!ms) return "";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 45) return "à l'instant";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 86400 * 2) return "hier";
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? dtf.format(d) : dtfY.format(d);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let h: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(h);
  return d;
}
