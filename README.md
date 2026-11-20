# Billy Note

Bloc-notes Markdown sans interface : une zone blanche ou noire, du texte.
Tauri 2 (Rust) + CodeMirror 6. Environ 4 Mo.

## Raccourcis (⌘ sur Mac, Ctrl sur Windows)

| Action | Raccourci |
|---|---|
| Rechercher / ouvrir une note | ⌘P |
| Actions (thème, dossier, renommer…) | ⌘K, ou ⌘P puis `/` |
| Changer d'onglet (maintenir Ctrl) | Ctrl+Espace ou Ctrl+Tab |
| Onglet 1 à 9 | ⌘1…⌘9 |
| Nouvelle note | ⌘N |
| Enregistrer / nommer un brouillon | ⌘S |
| Vue consultation | ⌘E (double-clic pour revenir) |
| Rechercher dans la note | ⌘F |
| Menu des notes | ⌘\ ou survol du bord gauche |
| Fermer l'onglet | ⌘W |
| Taille du texte | ⌘+ ⌘− ⌘0 |

Les onglets apparaissent en faisant défiler vers le haut ou en survolant le haut de la fenêtre.
Pour déplacer la fenêtre : glisser depuis une marge autour du texte (haut, côtés ou sous la dernière ligne).
En vue consultation, les cases `- [ ]` se cochent d'un clic (ou Espace) et la note est mise à jour.

## Notes et brouillons

- Un **brouillon** (note jamais enregistrée) est conservé automatiquement et retrouvé au lancement.
- ⌘S lui donne un nom : il devient un fichier `.md` dans le **dossier des notes**, ensuite enregistré automatiquement.
- Dossier par défaut : `Documents/Billy Note`. Pour la synchro, choisissez un dossier iCloud Drive / OneDrive / Dropbox via ⌘K → « Choisir le dossier des notes ».
- Les modifications faites sur un autre appareil sont rechargées quand la fenêtre reprend le focus.

## Développement

```bash
npm install
npm run app            # application native en développement
npm run dev            # interface seule dans un navigateur (backend simulé)
```

## Générer l'application

**Mac** (sur le Mac) :

```bash
npm run build:mac
```

Résultat dans `src-tauri/target/release/bundle/` : `macos/Billy Note.app` (à glisser dans Applications) et `dmg/Billy Note_0.1.0_aarch64.dmg`.

**Windows** (sur un PC Windows, avec Node, Rust et les « Build Tools » de Visual Studio installés) :

```bash
npm install
npm run build:win
```

Résultat : `src-tauri\target\release\billy-note.exe` (portable) et l'installateur `src-tauri\target\release\bundle\nsis\Billy Note_0.1.0_x64-setup.exe`.

La compilation Windows depuis un Mac n'est pas prise en charge de façon fiable : utiliser un PC Windows ou GitHub Actions.

Les applications ne sont pas signées : sur un autre Mac, il faut faire clic droit → Ouvrir la première fois ; sur Windows, SmartScreen affiche « Informations complémentaires → Exécuter quand même ».

## Licence

[MIT](LICENSE)
