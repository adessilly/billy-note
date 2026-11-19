//! Backend de Billy Note : accès aux fichiers du dossier de notes (iCloud,
//! OneDrive…), persistance de la session (brouillons non enregistrés, onglets)
//! et réglages de la fenêtre sans bordure.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Configuration (dossier des notes)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Default)]
struct Config {
    notes_dir: Option<String>,
}

fn config_path(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_config_dir().map_err(err)?.join("config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &Config) -> Res<()> {
    let p = config_path(app)?;
    write_atomic(&p, serde_json::to_string_pretty(cfg).map_err(err)?.as_bytes())
}

fn default_notes_dir(app: &AppHandle) -> Res<PathBuf> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(err)?;
    Ok(base.join("Billy Note"))
}

fn notes_dir(app: &AppHandle) -> Res<PathBuf> {
    match load_config(app).notes_dir {
        Some(d) => Ok(PathBuf::from(d)),
        None => default_notes_dir(app),
    }
}

/// Vérifie qu'un chemin reçu du front reste bien dans le dossier des notes.
fn ensure_inside(app: &AppHandle, path: &Path) -> Res<PathBuf> {
    let root = notes_dir(app)?;
    let root = root.canonicalize().unwrap_or(root);
    let parent = path.parent().ok_or("chemin invalide")?;
    let parent = parent.canonicalize().map_err(err)?;
    let name = path.file_name().ok_or("chemin invalide")?;
    if !parent.starts_with(&root) {
        return Err("ce fichier n'est pas dans le dossier des notes".into());
    }
    Ok(parent.join(name))
}

// ---------------------------------------------------------------------------
// Utilitaires fichiers
// ---------------------------------------------------------------------------

fn write_atomic(path: &Path, data: &[u8]) -> Res<()> {
    let dir = path.parent().ok_or("chemin invalide")?;
    fs::create_dir_all(dir).map_err(err)?;
    let name = path.file_name().ok_or("chemin invalide")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.~tmp"));
    fs::write(&tmp, data).map_err(err)?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(e)
    })
}

fn mtime(path: &Path) -> Option<f64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as f64)
}

fn is_note(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("md" | "markdown" | "txt")
    )
}

/// Nettoie un nom de note pour en faire un nom de fichier valide partout.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.is_empty() {
        "Sans titre".into()
    } else {
        cleaned
    }
}

fn with_md_ext(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt") {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "md".into());
    (2..)
        .map(|i| dir.join(format!("{stem} {i}.{ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AppInfo {
    notes_dir: String,
    platform: &'static str,
}

#[tauri::command]
fn app_info(app: AppHandle) -> Res<AppInfo> {
    Ok(AppInfo {
        notes_dir: notes_dir(&app)?.to_string_lossy().into(),
        platform: std::env::consts::OS,
    })
}

#[tauri::command]
fn set_notes_dir(app: AppHandle, path: String) -> Res<String> {
    let p = PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(err)?;
    let mut cfg = load_config(&app);
    cfg.notes_dir = Some(path.clone());
    save_config(&app, &cfg)?;
    Ok(path)
}

#[derive(Serialize)]
struct NoteInfo {
    path: String,
    name: String,
    /// Sous-dossier relatif au dossier des notes ("" si à la racine).
    folder: String,
    modified: f64,
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<NoteInfo>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if depth < 4 {
                walk(root, &path, depth + 1, out);
            }
        } else if ft.is_file() && is_note(&path) {
            let folder = path
                .parent()
                .and_then(|p| p.strip_prefix(root).ok())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(NoteInfo {
                name: path.file_stem().map(|s| s.to_string_lossy().into()).unwrap_or_default(),
                modified: mtime(&path).unwrap_or(0.0),
                path: path.to_string_lossy().into(),
                folder,
            });
        }
    }
}

#[tauri::command]
fn list_notes(app: AppHandle) -> Res<Vec<NoteInfo>> {
    let root = notes_dir(&app)?;
    let mut out = Vec::new();
    if root.exists() {
        walk(&root, &root, 0, &mut out);
    }
    out.sort_by(|a, b| b.modified.total_cmp(&a.modified));
    Ok(out)
}

#[derive(Serialize)]
struct NoteContent {
    content: String,
    mtime: f64,
}

#[tauri::command]
fn read_note(app: AppHandle, path: String) -> Res<NoteContent> {
    let p = ensure_inside(&app, Path::new(&path))?;
    let bytes = fs::read(&p).map_err(err)?;
    let content = String::from_utf8(bytes)
        .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
    // Retire un éventuel BOM UTF-8 (fichiers créés par le Bloc-notes Windows).
    let content = content.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(content);
    Ok(NoteContent { content, mtime: mtime(&p).unwrap_or(0.0) })
}

#[tauri::command]
fn write_note(app: AppHandle, path: String, content: String) -> Res<f64> {
    let p = ensure_inside(&app, Path::new(&path))?;
    write_atomic(&p, content.as_bytes())?;
    Ok(mtime(&p).unwrap_or(0.0))
}

#[derive(Serialize)]
struct Created {
    path: String,
    name: String,
    mtime: f64,
}

#[tauri::command]
fn create_note(app: AppHandle, name: String, content: String) -> Res<Created> {
    let root = notes_dir(&app)?;
    fs::create_dir_all(&root).map_err(err)?;
    let p = unique_path(&root, &with_md_ext(&sanitize(&name)));
    write_atomic(&p, content.as_bytes())?;
    Ok(Created {
        name: p.file_stem().map(|s| s.to_string_lossy().into()).unwrap_or_default(),
        mtime: mtime(&p).unwrap_or(0.0),
        path: p.to_string_lossy().into(),
    })
}

#[tauri::command]
fn rename_note(app: AppHandle, path: String, name: String) -> Res<Created> {
    let src = ensure_inside(&app, Path::new(&path))?;
    let dir = src.parent().ok_or("chemin invalide")?.to_path_buf();
    let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_else(|| "md".into());
    let base = sanitize(&name);
    let target_name = format!("{base}.{ext}");
    let dst = if dir.join(&target_name) == src {
        src.clone()
    } else {
        unique_path(&dir, &target_name)
    };
    fs::rename(&src, &dst).map_err(err)?;
    Ok(Created {
        name: dst.file_stem().map(|s| s.to_string_lossy().into()).unwrap_or_default(),
        mtime: mtime(&dst).unwrap_or(0.0),
        path: dst.to_string_lossy().into(),
    })
}

#[tauri::command]
fn trash_note(app: AppHandle, path: String) -> Res<()> {
    let p = ensure_inside(&app, Path::new(&path))?;
    trash::delete(&p).map_err(err)
}

/// Dates de modification des fichiers ouverts, pour détecter les changements
/// apportés par la synchronisation (iCloud, OneDrive…) ou un autre appareil.
#[tauri::command]
fn stat_notes(paths: Vec<String>) -> Vec<Option<f64>> {
    paths.iter().map(|p| mtime(Path::new(p))).collect()
}

fn session_path(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(err)?.join("session.json"))
}

#[tauri::command]
fn load_session(app: AppHandle) -> Res<Option<String>> {
    let p = session_path(&app)?;
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
fn save_session(app: AppHandle, data: String) -> Res<()> {
    write_atomic(&session_path(&app)?, data.as_bytes())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------

/// macOS : barre de titre transparente (coins arrondis et ombre natifs) dont on
/// masque les trois boutons, pour ne garder que la zone de texte.
#[cfg(target_os = "macos")]
fn hide_traffic_lights(win: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    let Ok(ptr) = win.ns_window() else { return };
    // SAFETY : pointeur NSWindow fourni par Tauri, utilisé sur le thread principal.
    let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(kind) {
            button.setHidden(true);
        }
    }
}

#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
    // Menu natif macOS (dans la barre du haut de l'écran, pas dans la fenêtre).
    // Pas de « Fermer la fenêtre » : ⌘W ferme l'onglet courant côté éditeur.
    let quit = MenuItemBuilder::with_id("quit", "Quitter Billy Note")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Billy Note")
        .item(&PredefinedMenuItem::about(app, Some("À propos de Billy Note"), None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Édition")
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Fenêtre")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    MenuBuilder::new(app).items(&[&app_menu, &edit, &window]).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_window_state::StateFlags;

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // La fenêtre est affichée par le front une fois le thème appliqué.
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::DECORATIONS)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            app_info,
            set_notes_dir,
            list_notes,
            read_note,
            write_note,
            create_note,
            rename_note,
            trash_note,
            stat_notes,
            load_session,
            save_session,
            quit
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let menu = build_menu(app.handle())?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        // Le front enregistre la session puis appelle `quit`.
                        let _ = app.emit("quit-requested", ());
                    }
                });
                if let Some(win) = app.get_webview_window("main") {
                    hide_traffic_lights(&win);
                    let w = win.clone();
                    win.on_window_event(move |e| {
                        if matches!(
                            e,
                            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true)
                        ) {
                            hide_traffic_lights(&w);
                        }
                    });
                }
            }
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Billy Note");
}
