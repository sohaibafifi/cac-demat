# CAC Demat – Agent Handbook

This repo hosts two desktop variants of the CAC Demat tool:

- `nodejs/`: Electron/TypeScript implementation (recommended for Windows).
- `nativephp/`: Laravel + NativePHP app that bundles Electron assets from `nativephp/vendor/nativephp/electron`.

Use this document as a quick briefing before hacking on the project.

## Getting Started

1. Install Node.js 22+, PHP 8.3, Composer, and a system toolchain suitable for building native modules (Xcode CLT on macOS, Build Tools on Windows).
2. Run `npm install` at the repo root (installs only the orchestration scripts).
3. Install sub-project dependencies as needed:
   - `npm --prefix nodejs ci`
   - `composer install` and `npm install` inside `nativephp/`.
4. Copy `nativephp/.env.example` to `.env`, then `php artisan key:generate`.

## Core Commands

| Goal | Command |
| --- | --- |
| Build both apps locally | `npm run build` |
| Run Electron dev app | `npm --prefix nodejs run dev` |
| Run NativePHP dev app | `cd nativephp && php artisan native:serve --no-interaction` *(see “Pitfalls”)* |
| Release orchestrator | `npm run release` |
| Bump version | `npm run release:patch` / `:minor` / `:major` |
| Publish artifacts only | `npm run publish` |

### Release Flow

1. Run `npm run release:patch|minor|major` to bump `nodejs/package.json`, `nodejs/package-lock.json`, `nativephp/.env.example`, `nativephp/package.json`, and propagate env vars.
2. Commit those files.
3. Execute `npm run release` to:
   - build & tag the Node app,
   - build the NativePHP app (skips tagging to avoid duplicate tags),
   - generate artifacts under each sub-project’s `dist/` or `release/`.
4. Push commits and tags to `main`. GitHub Actions handle publishing on tag push.

## Testing & Linting

- Node/Electron: run `npm --prefix nodejs test` (if present) and `npm --prefix nodejs run lint`.
- NativePHP: leverage Laravel test tooling (`php artisan test`) and any front-end lint scripts (`npm --prefix nativephp run lint`).
- New features should include automated coverage when practical; otherwise document manual verification steps in PRs.

## Pitfalls & Notes

- **NativePHP dev server:** `php artisan native:serve` defaults to TTY mode and will fail in non-interactive terminals (`TTY mode requires /dev/tty`). Use `php artisan native:serve --no-interaction` inside `nativephp/` if running under a CI shell.
- **Electron dependencies:** the NativePHP tree ships its own Electron project at `nativephp/vendor/nativephp/electron/resources/js`. If `php artisan native:serve` complains about missing `fs-extra` / chromedriver, run `npm install` in that directory to refresh dependencies.
- **Tagging:** Both release scripts support `--skip-tag` (or `SKIP_GIT_TAG=1`). The root `npm run release` already skips the Native tag to prevent duplicate tag creation.
- **Native targets:** `nativephp/scripts/native-release.cjs` auto-selects a platform based on the host OS unless `NATIVE_TARGETS` or CLI targets are provided.
- **Sensitive data:** `.env` files contain signing/OAuth secrets and must **never** be committed.

## Useful Paths

- `nodejs/src/renderer/*`: UI logic (TypeScript + HTML).
- `nodejs/scripts/release.cjs`: Node release pipeline (build, commit, tag).
- `nativephp/app/Livewire/Dashboard.php`: Core UI state machine for the NativePHP dashboard.
- `nativephp/scripts/native-release.cjs`: Native release pipeline.
- `nativephp/resources/views/livewire/dashboard.blade.php`: Livewire UI template.
- `nativephp/public/css/app.css`: Shared styling for the Livewire dashboard.

## Adding Features

1. Touch both variants whenever the feature affects shared functionality (CSV parsing, workspace, pipeline stages, etc.).
2. Update docs/README + version bumps as part of the release script.
3. Confirm both workflows still pass with `npm run build`.
4. Document notable manual steps here or in the README so future agents can pick up quickly.

Happy shipping! 🚀
