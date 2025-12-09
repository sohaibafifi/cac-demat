import { mkdir, readFile, unlink, writeFile, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger, SharedResourceStage } from './contracts/pdfProcessingStage.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { runCommand } from '../../../utils/process.js';

const fileExists = async (candidate: string): Promise<boolean> => {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
};

export class WatermarkStage implements PdfProcessingStage, SharedResourceStage {
  constructor(private readonly commandResolver: QpdfCommandResolver) {}
  private readonly pageDimensionsCache = new Map<
    string,
    { signature: string; result: Promise<Array<{ width: number; height: number }>> }
  >();

  async process(context: PdfProcessingContext, logger?: PipelineLogger): Promise<PdfProcessingContext> {
    const output = path.join(os.tmpdir(), `cac_demat_watermark_${randomUUID()}.pdf`);
    await this.applyWatermark(context.workingPath, output, context.recipient);

    if (context.useDefaultLogging) {
      logger?.(`  → ${context.relativePath}: watermark ${context.recipient} applied`);
    }

    return context.withWorkingPath(output);
  }

  private async applyWatermark(sourcePath: string, outputPath: string, label: string): Promise<void> {
    await mkdir(path.dirname(outputPath), { recursive: true });

    const text = label.trim().toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '') || 'WATERMARK';
    const pages = await this.getPageDimensions(sourcePath);
    const overlayPath = await this.generateOverlayPdf(pages, text);

    try {
      await this.applyOverlayWithQpdf(sourcePath, overlayPath, outputPath);
    } finally {
      await unlink(overlayPath).catch(() => undefined);
    }

    await this.optimisePdfWithQpdf(outputPath);
  }

  private async generateOverlayPdf(pages: Array<{ width: number; height: number }>, text: string): Promise<string> {
    const document = this.buildOverlayDocument(pages, text);
    const pathName = path.join(os.tmpdir(), `cac_demat_overlay_${randomUUID()}.pdf`);
    await writeFile(pathName, document, 'utf-8');
    return pathName;
  }

  private buildOverlayDocument(pages: Array<{ width: number; height: number }>, text: string): string {
    if (pages.length === 0) {
      throw new Error('Aucune page détectée pour générer le filigrane.');
    }

    const objects: string[] = ['', '<< /Type /Catalog /Pages 2 0 R >>', ''];
    const kids: string[] = [];

    const fontId = objects.length;
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    const gstateId = objects.length;
    objects.push('<< /Type /ExtGState /ca 0.2 /CA 0.2 /BM /Multiply >>');

    for (const page of pages) {
      const { width, height } = page;
      const fontSize = Math.max(12, Math.min(48, (width * 0.8) / (text.length * 0.6)));
      const contentStream = this.buildPageContent(width, height, fontSize, text);
      const contentLength = Buffer.byteLength(contentStream, 'utf-8');

      const contentId = objects.length;
      objects.push(`<< /Length ${contentLength} >>\nstream\n${contentStream}endstream\n`);

      const pageId = objects.length;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /F1 ${fontId} 0 R >> /ExtGState << /GS1 ${gstateId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );

      kids.push(`${pageId} 0 R`);
    }

    objects[2] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;

    // Build PDF
    let document = '%PDF-1.4\n';
    const offsets: number[] = [0];

    for (let i = 1; i < objects.length; i++) {
      offsets.push(document.length);
      document += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = document.length;
    document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

    for (let i = 1; i < objects.length; i++) {
      document += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
    }

    document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return document;
  }

  private buildPageContent(width: number, height: number, fontSize: number, text: string): string {
    const centerX = width / 2;
    const centerY = height / 2;
    const halfTextWidth = (text.length * fontSize * 0.6) / 2;
    const baselineOffset = fontSize * 0.3;
    const angle = Math.PI / 4; // 45 degrees
    const cos = Math.cos(angle).toFixed(4);
    const sin = Math.sin(angle).toFixed(4);
    const red = (220 / 255).toFixed(4);
    const escapedText = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    return [
      'q',
      '/GS1 gs',
      `${red} 0 0 rg`,
      `1 0 0 1 ${centerX.toFixed(2)} ${centerY.toFixed(2)} cm`,
      `${cos} ${sin} -${sin} ${cos} 0 0 cm`,
      'BT',
      `/F1 ${fontSize.toFixed(2)} Tf`,
      `${(-halfTextWidth).toFixed(2)} ${(-baselineOffset).toFixed(2)} Td`,
      `(${escapedText}) Tj`,
      'ET',
      'Q',
      '',
    ].join('\n');
  }

  async disposeSharedResources(): Promise<void> {
    this.pageDimensionsCache.clear();
  }

  private async getPageDimensions(sourcePath: string): Promise<Array<{ width: number; height: number }>> {
    const signature = await this.buildSignature(sourcePath);
    const cached = this.pageDimensionsCache.get(sourcePath);

    if (cached && cached.signature === signature) {
      return cached.result;
    }

    const result = this.loadPageDimensions(sourcePath).catch((error) => {
      this.pageDimensionsCache.delete(sourcePath);
      throw error;
    });

    this.pageDimensionsCache.set(sourcePath, { signature, result });
    return result;
  }

  private async loadPageDimensions(sourcePath: string): Promise<Array<{ width: number; height: number }>> {
    const command = await this.commandResolver.resolve();
    const result = await runCommand(command, ['--warning-exit-0', '--json', sourcePath]);

    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible d'analyser le PDF source avec qpdf. Erreur: ${error}`);
    }

    const payload = JSON.parse(result.stdout || 'null');
    if (!payload?.pages || !Array.isArray(payload.pages) || payload.pages.length === 0) {
      throw new Error("Impossible de récupérer les dimensions des pages via qpdf.");
    }

    const objects = this.buildObjectIndex(payload.qpdf || []);
    const dimensions: Array<{ width: number; height: number }> = [];

    for (let i = 0; i < payload.pages.length; i++) {
      const page = payload.pages[i];
      if (page?.object) {
        dimensions.push(this.extractPageSize(page.object, objects, i + 1));
      }
    }

    return dimensions;
  }

  private async buildSignature(pathname: string): Promise<string> {
    const info = await stat(pathname);
    return `${info.mtimeMs}-${info.size}`;
  }

  private buildObjectIndex(sections: any[]): Record<string, any> {
    const objects: Record<string, any> = {};

    for (const section of sections) {
      if (section && typeof section === 'object') {
        for (const [key, value] of Object.entries(section)) {
          if (key.startsWith('obj:')) {
            objects[key.slice(4)] = value;
          }
        }
      }
    }

    return objects;
  }

  private extractPageSize(objectId: string, objects: Record<string, any>, pageNumber: number): { width: number; height: number } {
    const mediaBox = this.getInheritedValue(objectId, '/MediaBox', objects);
    if (!Array.isArray(mediaBox) || mediaBox.length !== 4) {
      throw new Error(`Impossible de déterminer la MediaBox pour la page ${pageNumber}.`);
    }

    const [x1, y1, x2, y2] = mediaBox.map(Number);
    let width = Math.abs(x2 - x1);
    let height = Math.abs(y2 - y1);

    const rotation = Number(this.getInheritedValue(objectId, '/Rotate', objects) || 0);
    if (rotation === 90 || rotation === 270) {
      [width, height] = [height, width];
    }

    const userUnit = Number(this.getInheritedValue(objectId, '/UserUnit', objects) || 1);
    return { width: width * userUnit, height: height * userUnit };
  }

  private getInheritedValue(objectId: string, key: string, objects: Record<string, any>): any {
    const visited = new Set<string>();
    let current = objectId;

    while (current && !visited.has(current) && objects[current]) {
      visited.add(current);
      const obj = objects[current]?.value;

      if (obj && typeof obj === 'object' && key in obj) {
        return obj[key];
      }

      current = obj?.['/Parent'];
      if (!current) break;
    }

    return null;
  }

  private async applyOverlayWithQpdf(sourcePath: string, overlayPath: string, outputPath: string): Promise<void> {
    const command = await this.commandResolver.resolve();
    const result = await runCommand(command, [
      '--warning-exit-0',
      sourcePath,
      '--overlay',
      overlayPath,
      '--repeat=1-z',
      '--',
      outputPath,
    ]);

    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim();
      throw new Error(error || "Échec de l'application du filigrane.");
    }
  }

  private async optimisePdfWithQpdf(pdfPath: string): Promise<void> {
    const command = await this.commandResolver.resolve();
    const tempPath = `${pdfPath}.tmp`;

    const result = await runCommand(command, [
      '--warning-exit-0',
      '--optimize-images',
      '--compress-streams=y',
      pdfPath,
      tempPath,
    ]);

    if (result.exitCode === 0 && (await fileExists(tempPath))) {
      await unlink(pdfPath).catch(() => undefined);
      await writeFile(pdfPath, await readFile(tempPath));
      await unlink(tempPath).catch(() => undefined);
    }
  }
}
