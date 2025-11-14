Cette application permet de gérer la dématérialisation des dossiers de candidature au CAC de l'Université d'Artois.



# Publication des releases CAC Demat


Le dépôt embarque deux applications :

- **`nativephp/`** : app Laravel + NativePHP empaquetée via `php artisan native:*`.
- **`nodejs/`** : app Electron publiée via `npm run publish` (Electron Forge).

> ℹ️  La variante **NodeJS/Electron** est aujourd'hui la plus optimisée et la plus rapide, surtout sous Windows. La version **NativePHP (Laravel + Livewire)** reste fonctionnelle mais embarque l'écosystème Laravel complet, ce qui la rend plus lourde à exécuter et à packager.
>
> ✅ Les workflows **automatiques** github se déclenchent à chaque `git push` contenant un tag SemVer (`v1.2.3`) et produisent les binaires macOS + Windows sans intervention manuelle.  
> ✅ La version applicative est **unique** et synchronisée automatiquement entre `nodejs/` et `nativephp/` via `npm run version:patch|minor|major` (racine).

---

## Vue d’ensemble des workflows

| Workflow | Fichier | Déclencheur | Rôle |
| --- | --- | --- | --- |
| Native build/publish | `.github/workflows/native-build.yml` | `push` sur un tag `v*` (ou `workflow_dispatch`) | Installe PHP/Composer, exécute `native:build` et `native:publish`, uploade `nativephp/dist/**`. |
| Node build/publish | `.github/workflows/nodejs-build.yml` | `push` sur un tag `v*` (ou `workflow_dispatch`) | Installe Node 22, exécute `npm run electron:package` puis `npm run publish`, uploade `nodejs/dist/**`. |

Les deux workflows utilisent `secrets.GITHUB_TOKEN` : ils créent/complètent automatiquement la release GitHub associée au tag. Si la release existe déjà, les artefacts sont mis à jour.

---

## Commandes racine utiles

| Commande | Description |
| --- | --- |
| `npm run version:patch|minor|major` | Incrémente la version SemVer dans `nodejs/package.json` + `package-lock.json` **et** synchronise `nativephp/.env(.example)` et `nativephp/package.json`. |
| `npm run build` | Construit les deux variantes en local (`electron:package` pour NodeJS, `php artisan native:build` via `--build-only` pour NativePHP). |
| `npm run release` | Enchaîne les releases `nodejs` puis `nativephp` (sans increment). |
| `npm run release:patch|minor|major` | Prépare la release : appel direct à `version:patch|minor|major` (bump synchronisé). À compléter par un commit puis `npm run release`. |
| `npm run release:node` / `npm run release:native` | Déclenche uniquement la release Electron ou NativePHP. |
| `npm run publish` | Exécute `npm run publish:node` puis `npm run publish:native` pour pousser les artefacts localement. |
| `npm run publish:node` / `npm run publish:native` | Respectivement `npm --prefix nodejs run publish` (Electron Forge) et `npm --prefix nativephp run publish` (alias de `release`). |

Ces scripts se trouvent dans `package.json` à la racine et peuvent être appelés depuis n’importe où (`npm --prefix nodejs run release`...).

---

## Procédure de release (NativePHP & NodeJS)

1. **Préparer la version**
   - Lancer `npm run release:patch|minor|major` (ou `npm run version:patch|minor|major`). Cette commande met à jour `nodejs/package.json` + `package-lock.json`, puis synchronise `nativephp/.env(.example)` et `nativephp/package.json`.
   - Vérifier les variables `GITHUB_OWNER`, `GITHUB_REPO`, paramètres updater, etc.

2. **Vérifier les changements Git**
   - Inspecter `git status`.
   - Ajouter/committer les fichiers de version : `nodejs/package.json`, `nodejs/package-lock.json`, `nativephp/.env.example`, `nativephp/package.json` (et laisser `.env` non versionné).

3. **Tester localement** : lint, tests, build rapide (`npm run build`).

4. **Pousser sur `main`** (ou la branche cible) et `git push`.

5. **Lancer la release/publish locale (optionnel)** :
   - `npm run release` pour exécuter les release scripts NodeJS + NativePHP (build + tag + publish GitHub si configuré).
   - `npm run publish` si vous souhaitez forcer immédiatement la publication via Electron Forge + `native:publish`.

6. **Suivre les Actions**
   - Jobs NativePHP : `NativePHP (macOS)` / `NativePHP (windows)`.
   - Jobs NodeJS : `Electron (macOS|Windows)` + `Electron Publish`.
   - Chaque job publie un résumé et dépose ses artefacts (binaries, archives, etc.).

7. **Finaliser la release GitHub**
   - Une release `vX.Y.Z` est créée en mode **brouillon** si elle n’existe pas, ou enrichie sinon.
   - Relisez les notes automatiques d’Electron/NativePHP, ajoutez vos commentaires, puis passez la release en “Publish”.

---

## Conseils & optimisation

- **Privilégier NodeJS pour Windows** : l’appli Electron reste plus légère et rapide.
- **Tags = vérité** : utilisez toujours des tags `vX.Y.Z`. Ils verrouillent le commit and identifient les builds auto-update.
- **Artefacts Actions** : téléchargez-les depuis l’onglet “Artifacts” si vous voulez tester un binaire sans attendre la publication officielle.

---

## Générer les packages en local (sans GitHub Actions)

Le flux “root build” permet de reproduire les artefacts des workflows Actions directement sur votre machine :

| Commande | Effet |
| --- | --- |
| `npm run build` | Lance `npm run build:node` **puis** `npm run build:native`. |
| `npm run build:node` | Exécute `npm --prefix nodejs run electron:package` (packages Electron dans `nodejs/dist/`). |
| `npm run build:native` | Exécute `node nativephp/scripts/native-release.cjs --build-only` (packages NativePHP dans `nativephp/dist/` sans publication). |

### NativePHP (détails)

1. **Prérequis** : PHP 8.3, Composer, Node/npm (pour les assets front), dépendances NativePHP.
2. **Installer et préparer** (si nécessaire, sinon utilisez directement `npm run build:native`) :
   ```bash
   cd nativephp
   composer install --no-interaction --prefer-dist
   npm install        # si l’app utilise Vite/Livewire pour les assets
   cp .env.example .env   # si absent
   php artisan key:generate
   ```
3. **Construire pour une plateforme** :
   ```bash
   php artisan native:build mac   # ou win / linux
   ```
   Les binaires sont générés dans `nativephp/dist/<plateforme>/`. `npm run build:native` automatise ces étapes (copie .env, génération de clé, build multi-plateformes selon l’OS courant) sans exécuter `native:publish`.  
4. **Publier manuellement (optionnel)** : si vous souhaitez pousser la release vous-même, lancez `php artisan native:publish <cible>` ou `npm --prefix nativephp run release` (sans `--build-only`).

### NodeJS / Electron (détails)

1. **Prérequis** : Node 22, npm, toolchains natives (Xcode pour macOS, Visual Studio Build Tools pour Windows). Certaines cibles ne peuvent être construites que depuis l’OS correspondant.
2. **Installer et préparer** (si vous n’utilisez pas `npm run build:node`) :
   ```bash
   cd nodejs
   npm ci
   ```
3. **Construire les packages** :
   ```bash
   npm run electron:package        # multi-cibles selon la config electron-builder
   npm run electron:package:mac
   npm run electron:package:win
   npm run electron:package:linux
   ```
   Les fichiers apparaissent dans `nodejs/dist/` puis `nodejs/release/`. `npm run build:node` encapsule simplement `npm --prefix nodejs run electron:package`.
4. **Publier manuellement (optionnel)** :
   ```bash
   GH_TOKEN=... npm run publish
   ```
   Ceci pousse la release GitHub sans passer par Actions si nécessaire.

   > 💡 `npm run release` (racine) enchaîne les scripts de publication NodeJS puis NativePHP (sans bump). Couplez-le avec `npm run release:patch|minor|major` + un commit pour reproduire le pipeline complet en local.

---
