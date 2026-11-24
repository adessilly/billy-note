# Billy Note

Bloc-notes Markdown sans interface : une zone blanche ou noire, du texte.
Tauri 2 (Rust) + CodeMirror 6. Environ 4 Mo.

## Télécharger

**[➜ Dernière version](https://github.com/adessilly/billy-note/releases/latest)** : en bas de la page, dans **Assets**, choisir :

| Système | Fichier |
|---|---|
| macOS (Apple Silicon et Intel) | `Billy.Note_X.Y.Z_universal.dmg` : ouvrir, puis glisser Billy Note dans Applications |
| Windows 10 / 11 | `Billy.Note_X.Y.Z_x64-setup.exe` : lancer l'installateur |

L'application n'est pas signée, d'où un avertissement au premier lancement :

- **Mac** : clic droit sur Billy Note → **Ouvrir**, puis confirmer (ou Réglages Système → Confidentialité et sécurité → **Ouvrir quand même**) ;
- **Windows** : SmartScreen → **Informations complémentaires** → **Exécuter quand même**.

Ensuite, l'application se met à jour toute seule (voir [Mises à jour automatiques](#mises-à-jour-automatiques)).

## Raccourcis (⌘ sur Mac, Ctrl sur Windows)

| Action | Raccourci |
|---|---|
| Rechercher une note (titre et texte) / l'ouvrir | ⌘P |
| Actions (thème, dossier, renommer…) | ⌘K, ou ⌘P puis `/` |
| Changer d'onglet (maintenir Ctrl) | Ctrl+Espace ou Ctrl+Tab |
| Onglet 1 à 9 | ⌘1…⌘9 |
| Nouvelle note | ⌘N |
| Enregistrer / nommer un brouillon | ⌘S |
| Vue consultation | ⌘E (double-clic pour revenir) |
| Rechercher dans la note (à nouveau pour fermer) | ⌘F |
| Rechercher dans toutes les notes | ⌘⇧F |
| Menu des notes | ⌘\ ou survol du bord gauche |
| Fermer l'onglet | ⌘W |
| Coller une image | ⌘V (ou ⌘K → « Coller une image ») |
| Taille du texte | ⌘+ ⌘− ⌘0 |

Les onglets apparaissent en faisant défiler vers le haut ou en survolant le haut de la fenêtre ; on les réordonne en les faisant glisser.
Pour déplacer la fenêtre : glisser depuis une marge autour du texte (haut, côtés ou sous la dernière ligne).
En vue consultation, les cases `- [ ]` se cochent d'un clic (ou Espace) et la note est mise à jour ; survoler un bloc de code fait apparaître un bouton pour le copier.

⌘⇧F ouvre la recherche dans le texte de toutes les notes (sans tenir compte des accents ni des majuscules) : les résultats sont groupés par note, une ligne par passage avec son numéro, et en choisir un ouvre la note sur le passage trouvé. Depuis la barre ⌘F, ⌘⇧F (ou son bouton) reprend la même recherche dans toutes les notes. ⌘P montre aussi les premières notes dont le texte correspond.

Les images collées ou insérées (⌘K → « Insérer une image… ») sont enregistrées dans le sous-dossier `images/` du dossier des notes et référencées en Markdown standard (`![](images/…png)`) : elles se synchronisent avec les notes et restent lisibles dans n'importe quel autre éditeur.

## Notes et brouillons

- Un **brouillon** (note jamais enregistrée) est conservé automatiquement et retrouvé au lancement.
- ⌘S lui donne un nom : il devient un fichier `.md` dans le **dossier des notes**, ensuite enregistré automatiquement.
- Dossier par défaut : `Documents/Billy Note`. Pour la synchro, choisissez un dossier iCloud Drive / OneDrive / Dropbox via ⌘K → « Choisir le dossier des notes ».
- Les modifications faites sur un autre appareil sont rechargées quand la fenêtre reprend le focus.
- ⌘K → « Exporter la note… » enregistre une copie Markdown (`.md`) de la note ouverte où l'on veut, hors du dossier des notes ; ses images sont copiées dans un sous-dossier `images/` à côté, avec les liens ajustés.
- Dans le menu des notes (⌘\), survoler une note fait apparaître **Renommer** (le nom devient modifiable sur place : Entrée valide, Échap annule) et **Mettre à la corbeille**. Si la note utilisait des images qu'aucune autre note n'emploie, la confirmation propose de les mettre à la corbeille avec elle.

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

Les deux compilations signent aussi l'archive de mise à jour : la clé privée doit être fournie par `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu). `build:mac` lit `~/.tauri/billy-note.key` ; sur Windows, définir la variable avant `npm run build:win`.

Les applications ne sont pas signées : sur un autre Mac, il faut faire clic droit → Ouvrir la première fois ; sur Windows, SmartScreen affiche « Informations complémentaires → Exécuter quand même ».

## Mises à jour automatiques

L'application vérifie au lancement (puis toutes les 12 h) si une version plus récente est publiée dans les [releases GitHub](https://github.com/adessilly/billy-note/releases), et propose de l'installer via ⌘K. ⌘K → « Rechercher une mise à jour » lance la vérification à la demande ; la version installée est affichée en bas de la palette d'actions.

Les mises à jour sont signées : la clé publique est dans `src-tauri/tauri.conf.json`, la clé privée dans `~/.tauri/billy-note.key` (hors du dépôt, à sauvegarder : sans elle, les applications installées ne peuvent plus être mises à jour) et dans le secret GitHub `TAURI_SIGNING_PRIVATE_KEY`.

### Publier une version

```bash
npm run bump 0.2.0
git commit -am "chore: release v0.2.0"
git tag v0.2.0
git push && git push origin v0.2.0
```

Le tag déclenche `.github/workflows/release.yml` : compilation Mac (universel Apple Silicon + Intel) et Windows, signature, release GitHub avec `latest.json`. Le tag doit correspondre à la version de `tauri.conf.json`.

## Licence

[MIT](LICENSE)
