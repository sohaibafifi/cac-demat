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
| `npm run release:patch|minor|major` | Bump de version + release complète des deux apps. |
| `npm run release:node` / `npm run release:native` | Déclenche uniquement la release Electron ou NativePHP. |

Ces scripts se trouvent dans `package.json` à la racine et peuvent être appelés depuis n’importe où (`npm --prefix nodejs run release`...).

---

## Procédure de release (NativePHP & NodeJS)

1. **Préparer la version**
   - Lancer `npm run version:patch|minor|major` à la racine (ou `npm --prefix nodejs run version:patch`). Cette commande met à jour `nodejs/package.json` + `package-lock.json`, puis synchronise `nativephp/.env(.example)` et `nativephp/package.json`.
   - Vérifier les variables `GITHUB_OWNER`, `GITHUB_REPO`, paramètres updater, etc.

2. **Tester localement** : lint, tests, build rapide selon le module concerné.

3. **Commiter/pousser sur `main`** (ou la branche cible).

4. **Créer un tag SemVer** sur le commit validé :
   ```bash
   git tag -a v1.4.0 -m "Release 1.4.0"
   git push origin v1.4.0
   ```
   Le `push` déclenche automatiquement les deux workflows.

5. **Suivre les Actions**
   - Jobs NativePHP : `NativePHP (macOS)` / `NativePHP (windows)`.
   - Jobs NodeJS : `Electron (macOS|Windows)` + `Electron Publish`.
   - Chaque job publie un résumé et dépose ses artefacts (binaries, archives, etc.).

6. **Finaliser la release GitHub**
   - Une release `vX.Y.Z` est créée en mode **brouillon** si elle n’existe pas, ou enrichie sinon.
   - Relisez les notes automatiques d’Electron/NativePHP, ajoutez vos commentaires, puis passez la release en “Publish”.

---

## Conseils & optimisation

- **Privilégier NodeJS pour Windows** : l’appli Electron reste plus légère et rapide.
- **Tags = vérité** : utilisez toujours des tags `vX.Y.Z`. Ils verrouillent le commit and identifient les builds auto-update.
- **Artefacts Actions** : téléchargez-les depuis l’onglet “Artifacts” si vous voulez tester un binaire sans attendre la publication officielle.

---

## Générer les packages en local (sans GitHub Actions)

Il est parfois utile de produire les exécutables en local (tests rapides, démos hors connexion, validation avant de créer un tag). Les deux variantes peuvent être empaquetées manuellement.

### NativePHP

1. **Prérequis** : PHP 8.3, Composer, Node/npm (pour les assets front), dépendances NativePHP.
2. **Installer et préparer** :
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
   Les binaires sont générés dans `nativephp/dist/<plateforme>/`.
4. **Optionnel : publier sans GitHub**  
   Si vous ne souhaitez qu’un package local, arrêtez-vous après `native:build`. La commande `native:publish` suppose une configuration updater (GitHub/S3). Vous pouvez néanmoins la lancer en pointant vers un dépôt de test ou en gardant `NATIVEPHP_UPDATER_ENABLED=false`.  
   > Astuce : `npm run build:native` (à la racine) exécute `node nativephp/scripts/native-release.cjs --build-only`, ce qui prépare l’environnement et lance `native:build` sans publication.

### NodeJS / Electron

1. **Prérequis** : Node 22, npm, outils natives (Xcode pour macOS, Visual Studio Build Tools pour Windows). Certaines cibles ne peuvent être construites que sur l’OS correspondant.
2. **Installer et préparer** :
   ```bash
   cd nodejs
   npm ci
   ```
3. **Construire les packages** :
   - Tous les OS (depuis macOS avec Xcode et `wine` installés) :
     ```bash
     npm run electron:package
     ```
   - Cibles spécifiques (exemples) :
     ```bash
     npm run electron:package:mac
     npm run electron:package:win
     npm run electron:package:linux
     ```
   Les fichiers apparaissent sous `nodejs/dist/` puis dans `nodejs/release/` selon la configuration d’`electron-builder`.
   > Astuce : `npm run build:node` (à la racine) exécute `npm --prefix nodejs run electron:package`.
4. **Vérifier le résultat** : installez/ouvrez le binaire localement. Une fois validé, vous pouvez exécuter `npm run publish` avec un token personnel (`GH_TOKEN`) pour pousser la release sans attendre GitHub Actions.

> 💡 Le script `npm run release` enchaîne version bump + build + package. Utilisez-le si vous voulez simuler la release complète localement avant de pusher.

---
