// Appels au backend Rust.
import { invoke } from "@tauri-apps/api/core";

export interface NoteInfo { path: string; name: string; folder: string; modified: number }
export interface Created { path: string; name: string; mtime: number }

export const api = {
  appInfo: () => invoke<{ notes_dir: string; platform: string }>("app_info"),
  setNotesDir: (path: string) => invoke<string>("set_notes_dir", { path }),
  listNotes: () => invoke<NoteInfo[]>("list_notes"),
  readNote: (path: string) => invoke<{ content: string; mtime: number }>("read_note", { path }),
  readNotes: (paths: string[]) => invoke<({ content: string; mtime: number } | null)[]>("read_notes", { paths }),
  /** Enregistre une image dans « images/ » ; renvoie le lien relatif à la note. */
  saveImage: (bytes: Uint8Array, note: string, name: string) =>
    invoke<string>("save_image", bytes, { headers: { "x-note": encodeURIComponent(note), "x-name": encodeURIComponent(name) } }),
  importImage: (note: string, source: string) => invoke<string>("import_image", { note, source }),
  readImage: (path: string) => invoke<ArrayBuffer>("read_image", { path }),
  writeNote: (path: string, content: string) => invoke<number>("write_note", { path, content }),
  createNote: (name: string, content: string) => invoke<Created>("create_note", { name, content }),
  renameNote: (path: string, name: string) => invoke<Created>("rename_note", { path, name }),
  trashNote: (path: string) => invoke<void>("trash_note", { path }),
  trashImages: (paths: string[]) => invoke<number>("trash_images", { paths }),
  statNotes: (paths: string[]) => invoke<(number | null)[]>("stat_notes", { paths }),
  loadSession: () => invoke<string | null>("load_session"),
  saveSession: (data: string) => invoke<void>("save_session", { data }),
  quit: () => invoke<void>("quit"),
};
