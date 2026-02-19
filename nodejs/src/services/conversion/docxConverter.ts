import { access, mkdir, unlink, readdir, rename, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { runCommand } from '../../utils/process.js';

/**
 * Mutex for serializing LibreOffice conversions.
 * LibreOffice cannot run multiple instances simultaneously (single user profile).
 */
class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// Global mutex for LibreOffice - only one conversion at a time
const sofficeMutex = new Mutex();

// Global mutex for Word COM automation - only one conversion at a time
const wordMutex = new Mutex();

const fileExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const getSofficeCandidates = (): string[] => {
  if (process.platform === 'darwin') {
    return [
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/Applications/OpenOffice.app/Contents/MacOS/soffice',
      path.join(process.env.HOME ?? '', 'Applications/LibreOffice.app/Contents/MacOS/soffice'),
    ];
  }

  if (process.platform === 'linux') {
    return [
      '/usr/bin/soffice',
      '/usr/bin/libreoffice',
      '/usr/local/bin/soffice',
      '/usr/local/bin/libreoffice',
      '/opt/libreoffice/program/soffice',
    ];
  }

  // Windows - LibreOffice locations (fallback if Word not available)
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  return [
    path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
  ];
};

const resolveExecutableInPath = async (command: string): Promise<string | null> => {
  const searchPath = process.env.PATH ?? '';
  if (searchPath === '') {
    return null;
  }

  const directories = searchPath.split(path.delimiter).filter((entry) => entry && entry.trim() !== '');
  if (directories.length === 0) {
    return null;
  }

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .map((ext) => ext.trim())
          .filter((ext) => ext !== '')
      : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32' && extension !== ''
          ? path.join(directory, `${command}${extension}`)
          : path.join(directory, command);

      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

const resolveSoffice = async (): Promise<string | null> => {
  const envCommand = process.env.SOFFICE_COMMAND?.trim();
  if (envCommand) {
    return envCommand;
  }

  for (const command of ['soffice', 'libreoffice']) {
    const found = await resolveExecutableInPath(command);
    if (found) {
      return found;
    }
  }

  for (const candidate of getSofficeCandidates()) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
};

export class DocxConverter {
  private sofficePathCache: string | null = null;
  private sofficeChecked = false;

  async convert(inputPath: string, outputPath: string, abortSignal?: AbortSignal): Promise<void> {
    if (process.platform === 'win32') {
      await this.convertWithWord(inputPath, outputPath, abortSignal);
    } else {
      await this.convertWithSoffice(inputPath, outputPath, abortSignal);
    }
  }

  private async convertWithSoffice(inputPath: string, outputPath: string, abortSignal?: AbortSignal): Promise<void> {
    const soffice = await this.resolveSofficePath();
    if (!soffice) {
      throw new Error(
        "LibreOffice (soffice) introuvable. Veuillez installer LibreOffice ou définir la variable d'environnement SOFFICE_COMMAND.",
      );
    }

    // Acquire mutex - LibreOffice cannot run multiple instances simultaneously
    await sofficeMutex.acquire();

    const tempDir = path.join(os.tmpdir(), `cac_demat_soffice_${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      const result = await runCommand(
        soffice,
        [
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          tempDir,
          inputPath,
        ],
        { abortSignal, timeoutMs: 120000 },
      );

      if (result.exitCode !== 0) {
        const error = result.stderr.trim() || result.stdout.trim() || 'erreur inconnue';
        throw new Error(`Échec de la conversion LibreOffice: ${error}`);
      }

      const files = await readdir(tempDir);
      const pdfFile = files.find((f) => f.toLowerCase().endsWith('.pdf'));

      if (!pdfFile) {
        throw new Error('Aucun fichier PDF généré par LibreOffice.');
      }

      const generatedPath = path.join(tempDir, pdfFile);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await rename(generatedPath, outputPath);
    } finally {
      await this.cleanupDir(tempDir);
      sofficeMutex.release();
    }
  }

  private async convertWithWord(inputPath: string, outputPath: string, abortSignal?: AbortSignal): Promise<void> {
    const scriptPath = path.join(os.tmpdir(), 'cac_demat_convert_docx.ps1');
    await this.createPowerShellScript(scriptPath);

    const absoluteInput = path.resolve(inputPath);
    const absoluteOutput = path.resolve(outputPath);

    await mkdir(path.dirname(absoluteOutput), { recursive: true });

    // Acquire mutex - Word COM cannot run multiple instances simultaneously
    await wordMutex.acquire();
    let wordError: string | null = null;

    try {
      const result = await runCommand(
        'powershell.exe',
        [
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-inputPath',
          absoluteInput,
          '-outputPath',
          absoluteOutput,
        ],
        { abortSignal, timeoutMs: 120000 },
      );

      if (result.exitCode === 0 && (await fileExists(absoluteOutput))) {
        return;
      }

      wordError = result.stderr.trim() || result.stdout.trim() || 'Le fichier PDF n\'a pas été généré.';
    } finally {
      wordMutex.release();
    }

    const soffice = await this.resolveSofficePath();
    if (soffice) {
      await this.convertWithSoffice(inputPath, outputPath, abortSignal);
      return;
    }

    throw new Error(`Échec de la conversion Word: ${wordError ?? 'erreur inconnue'}`);
  }

  private async createPowerShellScript(scriptPath: string): Promise<void> {
    const script = `param (
    [string]$inputPath,
    [string]$outputPath
)

if (-not (Test-Path $inputPath)) {
    Write-Error "Input file does not exist: $inputPath"
    exit 1
}

try {
    $word = $null
    $doc = $null

    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    # Open read-only and export with fixed-format API to preserve interactive links reliably.
    $doc = $word.Documents.Open($inputPath, [ref]$false, [ref]$true)
    $doc.ExportAsFixedFormat(
        $outputPath,  # OutputFileName
        17,           # wdExportFormatPDF
        $false,       # OpenAfterExport
        0,            # wdExportOptimizeForPrint
        0,            # wdExportAllDocument
        1,            # From
        1,            # To
        0,            # wdExportDocumentContent
        $true,        # IncludeDocProps
        $true,        # KeepIRM
        1,            # wdExportCreateHeadingBookmarks
        $true,        # DocStructureTags
        $true,        # BitmapMissingFonts
        $false        # UseISO19005_1
    )

    Write-Host "Conversion completed: $inputPath -> $outputPath"
    exit 0
} catch {
    Write-Error "Conversion failed: $_"
    exit 1
} finally {
    if ($doc -ne $null) {
        $doc.Close([ref]$false)
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null
    }
    if ($word -ne $null) {
        $word.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
`;

    await mkdir(path.dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, script, 'utf-8');
  }

  private async resolveSofficePath(): Promise<string | null> {
    if (this.sofficeChecked) {
      return this.sofficePathCache;
    }

    this.sofficePathCache = await resolveSoffice();
    this.sofficeChecked = true;
    return this.sofficePathCache;
  }

  private async cleanupDir(dirPath: string): Promise<void> {
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        await unlink(path.join(dirPath, file)).catch(() => undefined);
      }
      const { rmdir } = await import('fs/promises');
      await rmdir(dirPath).catch(() => undefined);
    } catch {
      // Ignore cleanup errors
    }
  }
}
