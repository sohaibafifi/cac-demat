Cette application permet de gérer la dématérialisation des dossiers de candidature au CAC de l'Université d'Artois.

# Publication des releases CAC Demat

Le dépôt embarque l'application desktop **NodeJS/Electron** dans `nodejs/`.

Les workflows automatiques GitHub se déclenchent à chaque `git push` contenant un tag SemVer (`v1.2.3`) et produisent les binaires macOS + Windows sans intervention manuelle.

---

## Vue d'ensemble du workflow

| Workflow | Fichier | Déclencheur | Rôle |
| --- | --- | --- | --- |
| Node build/publish | `.github/workflows/nodejs-build.yml` | `push` sur un tag `v*` ou `workflow_dispatch` | Installe Node 22, exécute `npm run build`, puis publie les artefacts Electron. |

Le workflow utilise `secrets.GITHUB_TOKEN` pour créer ou compléter automatiquement la release GitHub associée au tag.

---

## Commandes racine utiles

| Commande | Description |
| --- | --- |
| `npm run version:patch|minor|major` | Incrémente la version SemVer dans `nodejs/package.json` et `nodejs/package-lock.json`. |
| `npm run build` | Construit l'application Electron via `npm --prefix nodejs run electron:package`. |
| `npm run release` | Déclenche la release Electron. |
| `npm run release:patch|minor|major` | Prépare la release en appelant le bump de version correspondant. À compléter par un commit puis `npm run release`. |
| `npm run release:node` | Déclenche uniquement la release Electron. |
| `npm run publish` | Exécute la publication Electron. |
| `npm run publish:node` | Exécute `npm --prefix nodejs run publish`. |

---

## Procédure de release

1. **Préparer la version**
   - Lancer `npm run release:patch|minor|major` ou `npm run version:patch|minor|major`.
   - Cette commande met à jour `nodejs/package.json` et `nodejs/package-lock.json`.
   - Pour les mises à jour automatiques Electron, les releases GitHub servent de feed à `electron-updater`. Si le dépôt reste privé, les machines qui exécutent l'application doivent définir `GH_TOKEN` ou `GITHUB_TOKEN` avec un PAT disposant du droit `repo:read`.

2. **Vérifier les changements Git**
   - Inspecter `git status`.
   - Ajouter et committer les fichiers de version : `nodejs/package.json` et `nodejs/package-lock.json`.

3. **Tester localement**
   - Lancer `npm --prefix nodejs run lint`.
   - Lancer `npm run build` pour vérifier le packaging Electron.

4. **Pousser sur la branche cible**
   - Pousser le commit et le tag SemVer `vX.Y.Z`.

5. **Suivre les Actions**
   - Jobs NodeJS : `Electron Publish (macOS)` et `Electron Publish (Windows)`.
   - Chaque job publie un résumé et dépose ses artefacts.

6. **Finaliser la release GitHub**
   - Une release `vX.Y.Z` est créée en mode brouillon si elle n'existe pas, ou enrichie sinon.
   - Relire les notes automatiques, ajouter les commentaires nécessaires, puis publier la release.

---

## Générer les packages en local

| Commande | Effet |
| --- | --- |
| `npm run build` | Lance `npm --prefix nodejs run electron:package`. |
| `npm run build:node` | Même effet que `npm run build`, explicitement ciblé sur `nodejs/`. |

### NodeJS / Electron

1. **Prérequis** : Node 22, npm et les toolchains natives de l'OS cible.
2. **Installer et préparer** :
   ```bash
   cd nodejs
   npm ci
   ```
3. **Construire les packages** :
   ```bash
   npm run electron:package
   npm run electron:package:mac
   npm run electron:package:win
   npm run electron:package:linux
   ```
   Les fichiers apparaissent dans `nodejs/dist/` puis `nodejs/release/`.
4. **Publier manuellement** :
   ```bash
   GH_TOKEN=... npm run publish
   ```

---

## Documentation utilisateur

- `docs/user_guide.md` : guide utilisateur.
- `docs/FORMAT_IMPORT.md` : format des fichiers d'import.
- `docs/screenshots/` : captures utilisées par la documentation.
