import { mkdir, readFile, unlink, writeFile, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
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

export class WatermarkStage implements PdfProcessingStage {
  constructor(private readonly commandResolver: QpdfCommandResolver) {}

  async process(context: PdfProcessingContext, logger?: PipelineLogger): Promise<PdfProcessingContext> {
    const output = path.join(os.tmpdir(), `cac_demat_watermark_${randomUUID()}.pdf`);
    await this.applyWatermark(context.workingPath, output, context.recipient);

    if (context.useDefaultLogging) {
      this.log(logger, `  → ${context.relativePath}: watermark ${context.recipient} applied`);
    }

    return context.withWorkingPath(output);
  }

  private async applyWatermark(sourcePath: string, outputPath: string, label: string): Promise<void> {
    const info = await stat(sourcePath);
    if (!info.isFile()) {
      throw new Error(`Source PDF introuvable: ${sourcePath}`);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });

    const text = this.prepareText(label);
    const pages = await this.getPageDimensions(sourcePath);
    const overlayPath = await this.generateOverlayPdf(pages, text);

    try {
      await this.applyOverlayWithQpdf(sourcePath, overlayPath, outputPath);
    } finally {
      if (await fileExists(overlayPath)) {
        await unlink(overlayPath).catch(() => undefined);
      }
    }

    await this.optimisePdfWithQpdf(outputPath);
  }

  private prepareText(label: string): string {
    const trimmed = label.trim();
    if (trimmed === '') {
      return 'WATERMARK';
    }

    const upper = trimmed.toUpperCase();
    const normalised = upper.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return normalised;
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

    const objectStorage = new Map<number, string>();
    objectStorage.set(1, '');
    objectStorage.set(2, '');
    let nextObjectId = 2;

    const addObject = (content: string): number => {
      nextObjectId += 1;
      objectStorage.set(nextObjectId, content);
      return nextObjectId;
    };

    const fontObjectId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const gstateObjectId = addObject('<< /Type /ExtGState /ca 0.2 /CA 0.2 /BM /Multiply >>');

    const kids: string[] = [];

    for (const page of pages) {
      const { width, height } = page;
      const fontSize = this.resolveFontSize(text, width);

      const contentStream = this.buildPageContent(width, height, fontSize, text);
      const contentLength = Buffer.byteLength(contentStream, 'utf-8');

      const contentObjectId = addObject(`<< /Length ${contentLength} >>\nstream\n${contentStream}endstream\n`);
      const pageObjectId = addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.formatNumber(width)} ${this.formatNumber(height)}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> /ExtGState << /GS1 ${gstateObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      );

      kids.push(`${pageObjectId} 0 R`);
    }

    objectStorage.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objectStorage.set(2, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`);

    let document = '%PDF-1.4\n';
    const offsets: number[] = new Array(nextObjectId + 1).fill(0);

    for (let objectId = 1; objectId <= nextObjectId; objectId += 1) {
      offsets[objectId] = document.length;
      const content = objectStorage.get(objectId) ?? '';
      document += `${objectId} 0 obj\n${content}\nendobj\n`;
    }

    const xrefOffset = document.length;
    document += `xref\n0 ${nextObjectId + 1}\n0000000000 65535 f \n`;

    for (let objectId = 1; objectId <= nextObjectId; objectId += 1) {
      const offset = offsets[objectId];
      document += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }

    document += `trailer\n<< /Size ${nextObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%EOF\n`;

    return document;
  }

  private buildPageContent(width: number, height: number, fontSize: number, text: string): string {
    const centerX = width / 2;
    const centerY = height / 2;
    const halfTextWidth = this.estimateTextWidth(text, fontSize) / 2;
    const baselineOffset = fontSize * 0.3;
    const angle = (45 * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const red = 220 / 255;

    const lines = [
      'q',
      '/GS1 gs',
      `${this.formatNumber(red)} 0 0 rg`,
      `1 0 0 1 ${this.formatNumber(centerX)} ${this.formatNumber(centerY)} cm`,
      `${this.formatNumber(cos)} ${this.formatNumber(sin)} ${this.formatNumber(-sin)} ${this.formatNumber(cos)} 0 0 cm`,
      'BT',
      `/F1 ${this.formatNumber(fontSize)} Tf`,
      `${this.formatNumber(-halfTextWidth)} ${this.formatNumber(-baselineOffset)} Td`,
      `(${this.escapePdfText(text)}) Tj`,
      'ET',
      'Q',
    ];

    return `${lines.join('\n')}\n`;
  }

  private resolveFontSize(text: string, pageWidth: number): number {
    let fontSize = 48;
    const maxWidth = pageWidth * 0.8;

    while (fontSize > 12) {
      const width = this.estimateTextWidth(text, fontSize);
      if (width <= maxWidth) {
        break;
      }
      fontSize -= 2;
    }

    return Math.max(fontSize, 12);
  }

  private estimateTextWidth(text: string, fontSize: number): number {
    return text.length * fontSize * 0.6;
  }

  private escapePdfText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  private async getPageDimensions(sourcePath: string): Promise<Array<{ width: number; height: number }>> {
    const command = await this.commandResolver.resolve();
    const result = await runCommand(command, ['--warning-exit-0', '--json', sourcePath]);

    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible d'analyser le PDF source avec qpdf. Commande: ${command}. Erreur: ${error}`);
    }

    let payload: any;
    try {
      payload = JSON.parse(result.stdout || 'null');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible d'analyser la sortie JSON de qpdf. Erreur: ${message}`);
    }

    const pages = this.extractPageDimensionsFromJson(payload);
    if (pages.length === 0) {
      throw new Error("Impossible de récupérer les dimensions des pages via qpdf.");
    }

    return pages;
  }

  private extractPageDimensionsFromJson(payload: any): Array<{ width: number; height: number }> {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.pages)) {
      return [];
    }

    const objects = this.buildQpdfObjectIndex(Array.isArray(payload.qpdf) ? payload.qpdf : []);
    const dimensions: Array<{ width: number; height: number }> = [];

    for (let index = 0; index < payload.pages.length; index += 1) {
      const page = payload.pages[index];
      if (!page || typeof page !== 'object' || typeof page.object !== 'string') {
        continue;
      }

      dimensions.push(this.extractPageDimensions(page.object, objects, index + 1));
    }

    return dimensions;
  }

  private buildQpdfObjectIndex(sections: any[]): Record<string, Record<string, any>> {
    const objects: Record<string, Record<string, any>> = {};

    for (const section of sections) {
      if (!section || typeof section !== 'object') {
        continue;
      }

      for (const [key, value] of Object.entries(section)) {
        if (!key.startsWith('obj:')) {
          continue;
        }

        objects[key.slice(4)] = typeof value === 'object' && value !== null ? (value as Record<string, any>) : {};
      }
    }

    return objects;
  }

  private extractPageDimensions(
    objectId: string,
    objects: Record<string, Record<string, any>>,
    pageNumber: number,
  ): { width: number; height: number } {
    const mediaBox = this.resolveInheritedEntry(objectId, '/MediaBox', objects);
    if (!Array.isArray(mediaBox) || mediaBox.length !== 4) {
      throw new Error(`Impossible de déterminer la MediaBox pour la page ${pageNumber}.`);
    }

    const numericMediaBox = mediaBox.map((value, idx) => this.castToFloat(value, `MediaBox[${idx}]`)) as [number, number, number, number];
    const rotationValue = this.resolveInheritedEntry(objectId, '/Rotate', objects);
    const rotation = typeof rotationValue === 'number' ? rotationValue : Number(rotationValue) || 0;

    const userUnitValue = this.resolveInheritedEntry(objectId, '/UserUnit', objects);
    let userUnit = typeof userUnitValue === 'number' ? userUnitValue : Number(userUnitValue) || 1;
    if (!Number.isFinite(userUnit) || userUnit <= 0) {
      userUnit = 1;
    }

    return this.calculatePageSize(numericMediaBox, rotation, userUnit);
  }

  private resolveInheritedEntry(
    objectId: string,
    key: string,
    objects: Record<string, Record<string, any>>,
  ): any {
    const visited = new Set<string>();
    let currentId: string | undefined = objectId;

    while (currentId && !visited.has(currentId) && objects[currentId]) {
      visited.add(currentId);
      const definition: Record<string, any> = objects[currentId];
      const value: any = definition.value ?? null;

      if (value && typeof value === 'object' && key in value) {
        return this.dereferenceValue(value[key], objects);
      }

      if (!value || typeof value !== 'object' || typeof value['/Parent'] !== 'string') {
        break;
      }

      currentId = value['/Parent'];
    }

    return null;
  }

  private dereferenceValue(value: any, objects: Record<string, Record<string, any>>): any {
    if (typeof value === 'string' && /^\d+ \d+ R$/.test(value)) {
      const reference = value.slice(0, -2);
      if (objects[reference] && Object.prototype.hasOwnProperty.call(objects[reference], 'value')) {
        return objects[reference].value;
      }
    }

    return value;
  }

  private castToFloat(value: any, context: string): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      const descriptor = typeof value === 'string' ? value : typeof value;
      throw new Error(`Valeur numérique attendue pour ${context}, reçue: ${descriptor}`);
    }

    return numeric;
  }

  private calculatePageSize(
    mediaBox: [number, number, number, number],
    rotation: number,
    userUnit: number,
  ): { width: number; height: number } {
    if (!Number.isFinite(userUnit) || userUnit <= 0) {
      userUnit = 1;
    }

    const [x1, y1, x2, y2] = mediaBox;
    let width = Math.abs((x2 - x1) * userUnit);
    let height = Math.abs((y2 - y1) * userUnit);

    const normalizedRotation = ((rotation % 360) + 360) % 360;
    if (normalizedRotation === 90 || normalizedRotation === 270) {
      [width, height] = [height, width];
    }

    if (width <= 0 || height <= 0) {
      throw new Error('Dimensions invalides renvoyées par qpdf.');
    }

    return { width, height };
  }

  private async applyOverlayWithQpdf(source: string, overlay: string, output: string): Promise<void> {
    const command = await this.commandResolver.resolve();
    const result = await runCommand(command, ['--warning-exit-0', '--overlay', overlay, '--', source, output]);
    const success = result.exitCode === 0 && (await fileExists(output));

    if (!success) {
      if (await fileExists(output)) {
        await unlink(output).catch(() => undefined);
      }
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible d'appliquer le filigrane via qpdf. Commande: ${command}. Erreur: ${error}`);
    }
  }

  private async optimisePdfWithQpdf(pathname: string): Promise<void> {
    const command = await this.commandResolver.resolve();
    const temporaryOutput = path.join(os.tmpdir(), `cac_demat_optimized_${randomUUID()}.pdf`);

    const result = await runCommand(command, [
      '--warning-exit-0',
      '--stream-data=compress',
      '--object-streams=generate',
      '--',
      pathname,
      temporaryOutput,
    ]);

    const success = result.exitCode === 0 && (await fileExists(temporaryOutput));
    if (!success) {
      if (await fileExists(temporaryOutput)) {
        await unlink(temporaryOutput).catch(() => undefined);
      }
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible d'optimiser le PDF généré. Commande: ${command}. Erreur: ${error}`);
    }

    const contents = await readFile(temporaryOutput);
    await writeFile(pathname, contents);
    await unlink(temporaryOutput).catch(() => undefined);
  }

  private formatNumber(value: number): string {
    return value.toFixed(4).replace(/0+$/g, '').replace(/\.$/, '');
  }

  private log(logger: PipelineLogger | undefined, message: string): void {
    logger?.(message);
  }
}
