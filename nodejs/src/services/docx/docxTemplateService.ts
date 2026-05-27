import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { deflateRawSync, inflateRawSync } from 'zlib';
import type { CandidateMetadata } from '../assignments/csvAssignmentLoader.js';

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  dataStart: number;
  dataEnd: number;
}

interface OutputZipEntry {
  name: string;
  data: Buffer;
}

interface TextToken {
  text: string;
  plainStart: number;
  plainEnd: number;
  xmlEnd: number;
}

export interface RipecTemplateCopy {
  targetName: string;
  reviewerName: string;
  reviewerNumber: number;
  candidate?: CandidateMetadata;
  targetDirectory: string;
}

export interface AvancementTemplateCopy {
  targetName: string;
  reviewerName: string;
  reviewerNumber: number;
  candidate?: CandidateMetadata;
  targetDirectory: string;
}

const DOCUMENT_XML_PATH = 'word/document.xml';
const TEMPLATE_REVIEWER_LABEL = 'rapporteur 1';
const SPLIT_REVIEWER_LABEL_PATTERN = /<w:t>rapporteur<\/w:t>((?:(?!<w:t>rapporteur<\/w:t>)[\s\S]){0,500}?)<w:t>1<\/w:t>/;
const AVANCEMENT_TITLE_TOKEN = '<w:t>Rapport de</w:t>';
const AVANCEMENT_SIGNATURE_PHRASE = 'Signature du rapporteur';
const RIPEC_SIGNATURE_PHRASE = 'Signature';
const RIPEC_TITLE_PATTERN = /(<w:t>Rapport<\/w:t>(?:(?!<w:t>)[\s\S]){0,300}?<w:t)>de<\/w:t>/;

export class DocxTemplateService {
  async createRipecReport(copy: RipecTemplateCopy): Promise<string[]> {
    const templatePath = await this.resolveRipecTemplatePath();
    const template = await readFile(templatePath);
    const targetName = this.sanitizeFilePart(copy.targetName);
    const n = copy.reviewerNumber;
    const anonymousTitleLabel = `${n} Anonyme`;
    const namedTitleLabel = `${n} de : ${copy.reviewerName}`;
    const anonymousFileLabel = `R${n} - Anonyme`;
    const namedFileLabel = `R${n} - ${copy.reviewerName}`;
    const candidate = copy.candidate ?? {};

    await mkdir(copy.targetDirectory, { recursive: true, mode: 0o755 });

    const anonymousPath = path.join(
      copy.targetDirectory,
      `Rapport RIPEC - ${targetName} - ${this.sanitizeFilePart(anonymousFileLabel)}.docx`,
    );
    const namedPath = path.join(
      copy.targetDirectory,
      `Rapport RIPEC - ${targetName} - ${this.sanitizeFilePart(namedFileLabel)}.docx`,
    );

    await writeFile(anonymousPath, this.renderRipecDocx(template, anonymousTitleLabel, candidate, true));
    await writeFile(namedPath, this.renderRipecDocx(template, namedTitleLabel, candidate, false));

    return [anonymousPath, namedPath];
  }

  async createAvancementReports(copy: AvancementTemplateCopy): Promise<string[]> {
    const templatePath = await this.resolveAvancementTemplatePath();
    const template = await readFile(templatePath);
    const targetName = this.sanitizeFilePart(copy.targetName);
    const anonymousLabel = `Rapporteur #${copy.reviewerNumber}`;
    const anonymousFileLabel = `Rapporteur ${copy.reviewerNumber}`;
    const candidate = copy.candidate ?? {};

    await mkdir(copy.targetDirectory, { recursive: true, mode: 0o755 });

    const anonymousPath = path.join(
      copy.targetDirectory,
      `Rapport Avancement - ${targetName} - ${this.sanitizeFilePart(anonymousFileLabel)}.docx`,
    );
    const namedPath = path.join(
      copy.targetDirectory,
      `Rapport Avancement - ${targetName} - ${this.sanitizeFilePart(copy.reviewerName)}.docx`,
    );

    await writeFile(anonymousPath, this.renderAvancementDocx(template, anonymousLabel, candidate, true));
    await writeFile(namedPath, this.renderAvancementDocx(template, copy.reviewerName, candidate, false));

    return [anonymousPath, namedPath];
  }

  private renderAvancementDocx(
    template: Buffer,
    reviewerLabel: string,
    candidate: CandidateMetadata,
    anonymous: boolean,
  ): Buffer {
    const entries = this.readZipEntries(template);
    const outputEntries = entries.map((entry) => {
      const data = this.readEntryData(template, entry);
      if (entry.name !== DOCUMENT_XML_PATH) {
        return { name: entry.name, data };
      }

      const xml = data.toString('utf8');
      const replacement = this.escapeXmlText(reviewerLabel);
      let updated = this.insertAvancementReviewerLabel(xml, replacement);
      updated = this.fillCandidateFields(updated, candidate);
      if (anonymous) {
        updated = this.removeAvancementSignaturePhrase(updated);
      }
      return { name: entry.name, data: Buffer.from(updated, 'utf8') };
    });

    return this.writeZipEntries(outputEntries);
  }

  private insertAvancementReviewerLabel(xml: string, replacement: string): string {
    if (!xml.includes(AVANCEMENT_TITLE_TOKEN)) {
      throw new Error('Titre "Rapport de" introuvable dans le template Avancement.');
    }

    return xml.replace(
      AVANCEMENT_TITLE_TOKEN,
      `<w:t xml:space="preserve">Rapport de ${replacement}</w:t>`,
    );
  }

  private removeAvancementSignaturePhrase(xml: string): string {
    return this.updateParagraphs(xml, (paragraph) => {
      if (!paragraph.includes(AVANCEMENT_SIGNATURE_PHRASE)) {
        return paragraph;
      }

      let updated = paragraph.replace(
        /<w:t(?:\s[^>]*)?>[^<]*Signature du rapporteur<\/w:t>/,
        '<w:t>Date</w:t>',
      );
      updated = updated.replace(
        /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t(?:\s[^>]*)?>\s*:\s*<\/w:t>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/,
        '',
      );
      return updated;
    });
  }

  private renderRipecDocx(
    template: Buffer,
    reviewerLabel: string,
    candidate: CandidateMetadata,
    anonymous: boolean,
  ): Buffer {
    const entries = this.readZipEntries(template);
    const outputEntries = entries.map((entry) => {
      const data = this.readEntryData(template, entry);
      if (entry.name !== DOCUMENT_XML_PATH) {
        return { name: entry.name, data };
      }

      const xml = data.toString('utf8');
      const replacement = this.escapeXmlText(reviewerLabel);
      let updated = this.fillCandidateFields(
        this.replaceReviewerLabel(xml, replacement),
        candidate,
        { skipCandidatureAppend: true },
      );
      if (anonymous) {
        updated = this.removeRipecSignaturePhrase(updated);
      }
      return { name: entry.name, data: Buffer.from(updated, 'utf8') };
    });

    return this.writeZipEntries(outputEntries);
  }

  private removeRipecSignaturePhrase(xml: string): string {
    return this.updateParagraphs(xml, (paragraph) => {
      if (!paragraph.includes(RIPEC_SIGNATURE_PHRASE)) {
        return paragraph;
      }

      return paragraph.replace(
        /<w:t(?:\s[^>]*)?>\s*Signature\s*<\/w:t>/g,
        '<w:t></w:t>',
      );
    });
  }

  private replaceReviewerLabel(xml: string, replacement: string): string {
    if (xml.includes(TEMPLATE_REVIEWER_LABEL)) {
      return xml.replace(new RegExp(TEMPLATE_REVIEWER_LABEL, 'g'), replacement);
    }

    const splitUpdated = xml.replace(SPLIT_REVIEWER_LABEL_PATTERN, (_match, between: string) => {
      return `<w:t>${replacement}</w:t>${between}<w:t></w:t>`;
    });
    if (splitUpdated !== xml) {
      return splitUpdated;
    }

    return xml.replace(
      RIPEC_TITLE_PATTERN,
      (_match, prefix: string) => `${prefix} xml:space="preserve">${replacement}</w:t>`,
    );
  }

  private fillCandidateFields(
    xml: string,
    candidate: CandidateMetadata,
    options: { skipCandidatureAppend?: boolean } = {},
  ): string {
    const candidateFullName = [candidate.lastName, candidate.firstName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' ');

    return this.updateParagraphs(xml, (paragraph) => {
      const text = this.getParagraphText(paragraph);

      if (candidateFullName && !options.skipCandidatureAppend && text.includes('sur la candidature de')) {
        return this.appendTextToParagraph(paragraph, ` ${candidateFullName}`);
      }

      if (text.includes('Nom') && text.includes('Prénom')) {
        return this.fillParagraphFields(paragraph, [
          { label: 'Nom', value: candidate.lastName },
          { label: 'Prénom', value: candidate.firstName },
        ]);
      }

      if (text.includes('CNU') && text.includes('Grade')) {
        return this.fillParagraphFields(paragraph, [
          { label: 'CNU', value: candidate.cnu },
          { label: 'Grade', value: candidate.grade },
        ]);
      }

      if (text.includes('Composante') && text.includes('Unité de recherche')) {
        return this.fillParagraphFields(paragraph, [
          { label: 'Composante', value: candidate.composante },
          { label: 'Unité de recherche', value: candidate.researchUnit },
        ]);
      }

      return paragraph;
    });
  }

  private updateParagraphs(xml: string, updater: (paragraph: string) => string): string {
    return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => updater(paragraph));
  }

  private fillParagraphFields(
    paragraph: string,
    fields: Array<{ label: string; value?: string }>,
  ): string {
    const tokens = this.getTextTokens(paragraph);
    const text = tokens.map((token) => token.text).join('');
    const insertions: Array<{ index: number; value: string }> = [];

    for (const field of fields) {
      const value = field.value?.trim();
      if (!value) {
        continue;
      }

      const labelIndex = text.indexOf(field.label);
      if (labelIndex === -1) {
        continue;
      }

      const colonIndex = text.indexOf(':', labelIndex + field.label.length);
      if (colonIndex === -1) {
        continue;
      }

      const token = tokens.find((candidate) => colonIndex >= candidate.plainStart && colonIndex < candidate.plainEnd);
      if (!token) {
        continue;
      }

      insertions.push({ index: token.xmlEnd, value: ` ${value}` });
    }

    return this.applyTextInsertions(paragraph, insertions);
  }

  private appendTextToParagraph(paragraph: string, value: string): string {
    const tokens = this.getTextTokens(paragraph);
    const lastToken = tokens[tokens.length - 1];
    if (!lastToken) {
      return paragraph;
    }

    return this.applyTextInsertions(paragraph, [{ index: lastToken.xmlEnd, value }]);
  }

  private applyTextInsertions(paragraph: string, insertions: Array<{ index: number; value: string }>): string {
    let updated = paragraph;

    for (const insertion of insertions.sort((a, b) => b.index - a.index)) {
      updated = `${updated.slice(0, insertion.index)}${this.createTextRun(insertion.value)}${updated.slice(insertion.index)}`;
    }

    return updated;
  }

  private getParagraphText(paragraph: string): string {
    return this.getTextTokens(paragraph).map((token) => token.text).join('');
  }

  private getTextTokens(paragraph: string): TextToken[] {
    const tokens: TextToken[] = [];
    const textPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let plainOffset = 0;
    let match: RegExpExecArray | null;

    while ((match = textPattern.exec(paragraph)) !== null) {
      const text = this.decodeXmlText(match[1]);
      const plainStart = plainOffset;
      plainOffset += text.length;
      tokens.push({
        text,
        plainStart,
        plainEnd: plainOffset,
        xmlEnd: match.index + match[0].length,
      });
    }

    return tokens;
  }

  private createTextRun(value: string): string {
    return `<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${this.escapeXmlText(value)}</w:t></w:r>`;
  }

  private readZipEntries(buffer: Buffer): ZipEntry[] {
    const eocdOffset = this.findEndOfCentralDirectory(buffer);
    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries: ZipEntry[] = [];
    let cursor = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('Template DOCX invalide: répertoire ZIP central introuvable.');
      }

      const method = buffer.readUInt16LE(cursor + 10);
      const crc32 = buffer.readUInt32LE(cursor + 16);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const fileNameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
      const nameStart = cursor + 46;
      const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;

      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        crc32,
        localHeaderOffset,
        dataStart,
        dataEnd,
      });

      cursor = nameStart + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  private findEndOfCentralDirectory(buffer: Buffer): number {
    for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
      if (buffer.readUInt32LE(offset) === 0x06054b50) {
        return offset;
      }
    }

    throw new Error('Template DOCX invalide: fin ZIP introuvable.');
  }

  private readEntryData(buffer: Buffer, entry: ZipEntry): Buffer {
    const compressed = buffer.subarray(entry.dataStart, entry.dataEnd);

    if (entry.method === 0) {
      return Buffer.from(compressed);
    }

    if (entry.method === 8) {
      return inflateRawSync(compressed);
    }

    throw new Error(`Template DOCX invalide: compression ZIP non supportée (${entry.method}) pour ${entry.name}.`);
  }

  private writeZipEntries(entries: OutputZipEntry[]): Buffer {
    const parts: Buffer[] = [];
    const centralDirectoryParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuffer = Buffer.from(entry.name, 'utf8');
      const compressedData = deflateRawSync(entry.data);
      const crc = crc32(entry.data);
      const localHeader = Buffer.alloc(30 + nameBuffer.length);

      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(8, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(compressedData.length, 18);
      localHeader.writeUInt32LE(entry.data.length, 22);
      localHeader.writeUInt16LE(nameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);
      nameBuffer.copy(localHeader, 30);

      parts.push(localHeader, compressedData);

      const centralDirectoryHeader = Buffer.alloc(46 + nameBuffer.length);
      centralDirectoryHeader.writeUInt32LE(0x02014b50, 0);
      centralDirectoryHeader.writeUInt16LE(20, 4);
      centralDirectoryHeader.writeUInt16LE(20, 6);
      centralDirectoryHeader.writeUInt16LE(0, 8);
      centralDirectoryHeader.writeUInt16LE(8, 10);
      centralDirectoryHeader.writeUInt16LE(0, 12);
      centralDirectoryHeader.writeUInt16LE(0, 14);
      centralDirectoryHeader.writeUInt32LE(crc, 16);
      centralDirectoryHeader.writeUInt32LE(compressedData.length, 20);
      centralDirectoryHeader.writeUInt32LE(entry.data.length, 24);
      centralDirectoryHeader.writeUInt16LE(nameBuffer.length, 28);
      centralDirectoryHeader.writeUInt16LE(0, 30);
      centralDirectoryHeader.writeUInt16LE(0, 32);
      centralDirectoryHeader.writeUInt16LE(0, 34);
      centralDirectoryHeader.writeUInt16LE(0, 36);
      centralDirectoryHeader.writeUInt32LE(0, 38);
      centralDirectoryHeader.writeUInt32LE(offset, 42);
      nameBuffer.copy(centralDirectoryHeader, 46);
      centralDirectoryParts.push(centralDirectoryHeader);

      offset += localHeader.length + compressedData.length;
    }

    const centralDirectoryOffset = offset;
    const centralDirectory = Buffer.concat(centralDirectoryParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(centralDirectoryOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...parts, centralDirectory, eocd]);
  }

  private async resolveRipecTemplatePath(): Promise<string> {
    return this.resolveTemplatePath('ripec.docx', 'Template RIPEC introuvable (nodejs/templates/ripec.docx).');
  }

  private async resolveAvancementTemplatePath(): Promise<string> {
    return this.resolveTemplatePath(
      'avancement.docx',
      'Template Avancement introuvable (nodejs/templates/avancement.docx).',
    );
  }

  private async resolveTemplatePath(fileName: string, errorMessage: string): Promise<string> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(currentDir, '..', '..', 'templates', fileName),
      path.join(process.cwd(), 'dist', 'templates', fileName),
      path.join(process.cwd(), 'templates', fileName),
      path.join(process.resourcesPath ?? '', 'dist', 'templates', fileName),
    ];

    for (const candidate of candidates) {
      try {
        await readFile(candidate);
        return candidate;
      } catch {
        // try next candidate
      }
    }

    throw new Error(errorMessage);
  }

  private sanitizeFilePart(value: string): string {
    const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const safe = normalized
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return safe || 'rapporteur';
  }

  private escapeXmlText(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private decodeXmlText(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}
