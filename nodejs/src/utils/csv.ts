export interface CsvTable {
  headers: string[];
  records: Array<Record<string, string>>;
}

export function parseCsv(contents: string): CsvTable {
  const delimiter = detectDelimiter(contents);
  const rows = parseRows(contents, delimiter);

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0];
  const records: Array<Record<string, string>> = [];

  for (let i = 1; i < rows.length; i += 1) {
    const values = rows[i];
    if (values.every((value) => value.trim() === '')) {
      continue;
    }

    const record: Record<string, string> = {};
    const columnCount = Math.max(headers.length, values.length);

    for (let column = 0; column < columnCount; column += 1) {
      const header = headers[column] ?? `column_${column + 1}`;
      record[header] = values[column] ?? '';
    }

    records.push(record);
  }

  return { headers, records };
}

function detectDelimiter(text: string): string {
  let commaCount = 0;
  let semicolonCount = 0;
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      const next = text[index + 1];
      if (insideQuotes && next === '"') {
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (insideQuotes) {
      continue;
    }

    if (char === ',') {
      commaCount += 1;
    } else if (char === ';') {
      semicolonCount += 1;
    } else if (char === '\n' || char === '\r') {
      break;
    }
  }

  return semicolonCount > commaCount ? ';' : ',';
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      const next = text[index + 1];
      if (insideQuotes && next === '"') {
        currentField += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';

      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
        rows.push(currentRow);
      }

      currentRow = [];

      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }

      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField);
  if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
    rows.push(currentRow);
  }

  return rows;
}
