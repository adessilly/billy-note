// En développement hors de Tauri (simple navigateur), simule le backend Rust
// pour pouvoir travailler l'interface. Sans effet dans l'application.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  mockWindows("main");
  const files = new Map<string, { content: string; mtime: number }>([
    ["/Notes/Idées.md", { content: "# Idées\n\n- [ ] Tester **Billy Note**\n- [x] Écrire du `code`\n\n```css\nbody { color: #333; margin: 0 auto; }\n```\n\n```js\nconst hello = (name) => `Bonjour ${name}`; // salut\n```\n\n> Une citation\n\nUn [lien](https://example.com).", mtime: Date.now() - 3600e3 }],
    ["/Notes/Courses.md", { content: "# Courses\n\n1. Pain\n2. Fromage", mtime: Date.now() - 86400e3 * 3 }],
  ]);
  const name = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
  mockIPC((cmd, a: any) => {
    switch (cmd) {
      case "app_info": return { notes_dir: "/Users/demo/Library/Mobile Documents/com~apple~CloudDocs/Notes", platform: "macos" };
      case "list_notes": return [...files].map(([path, f]) => ({ path, name: name(path), folder: "", modified: f.mtime }));
      case "read_note": { const f = files.get(a.path); if (!f) throw "introuvable"; return f; }
      case "write_note": files.set(a.path, { content: a.content, mtime: Date.now() }); return Date.now();
      case "create_note": { const path = `/Notes/${a.name}.md`; files.set(path, { content: a.content, mtime: Date.now() }); return { path, name: a.name, mtime: Date.now() }; }
      case "rename_note": { const f = files.get(a.path)!; files.delete(a.path); const path = `/Notes/${a.name}.md`; files.set(path, f); return { path, name: a.name, mtime: f.mtime }; }
      case "trash_note": files.delete(a.path); return null;
      case "stat_notes": return a.paths.map((p: string) => files.get(p)?.mtime ?? null);
      case "load_session": return localStorage.getItem("session");
      case "save_session": localStorage.setItem("session", a.data); return null;
      default: return null;
    }
  }, { shouldMockEvents: true });
}
