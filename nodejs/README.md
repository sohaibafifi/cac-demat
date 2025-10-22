# CAC Demat – Node.js Translation

This directory contains a TypeScript/Node.js port of the NativePHP Laravel application. The goal is feature parity: generating reviewer and member PDF packages with watermarking, restriction, and cleaning applied through `qpdf`.

## Structure

- `src/app/dashboardCoordinator.ts` – Orchestrates the pipeline (state & business rules derived from Livewire component).
- `src/services` – Service layer translated from PHP, including CSV ingestion, PDF processing pipeline, and workspace helpers.
- `src/utils` – Utility helpers (CSV parsing, process management).
- `src/electron` – Electron main & preload processes wiring the pipeline into a desktop shell.
- `src/renderer` – Minimal UI rendered inside Electron, mirroring the NativePHP experience.

## Usage

1. Install dependencies (requires local `npm`/`pnpm` with internet access):
   ```bash
   npm install
   npm run build
   ```

## Electron desktop shell

To work inside an Electron window (similar to the NativePHP build), use the bundled renderer:

```bash
npm install
npm run electron
```

During development you can rebuild TypeScript continuously while leaving Electron running in a separate terminal:

```bash
npm run build:watch
# in another terminal start Electron without rebuilding
npx electron .
```

Package the desktop app with:

```bash
npm run electron:package
```

## Notes

- `qpdf` must be available through the same lookup rules as the PHP version (`QPDF_COMMAND` env var or embedded binaries under `nativephp/resources/commands`).
- CSV parsing covers quoted fields, multi-line records, and both comma/semicolon delimiters.
- The Electron shell calls the same coordinator used by the Laravel Livewire component, so behaviour and logs stay consistent between stacks.
