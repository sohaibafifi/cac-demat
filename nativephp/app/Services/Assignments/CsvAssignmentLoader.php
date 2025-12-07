<?php

namespace App\Services\Assignments;

use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use League\Csv\Exception;
use League\Csv\Reader;
use League\Csv\SyntaxError;
use League\Csv\UnavailableStream;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use RuntimeException;

class CsvAssignmentLoader
{
    /**
     * @param  array<int, string>  $availableFiles
     * @return array<int, array{file: string, reviewers: array<int, string>, source: string, label?: string}>
     */
    public function reviewers(string $path, array $availableFiles = []): array
    {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        if (in_array($extension, ['xlsx', 'xls'], true)) {
            return $this->reviewersFromWorkbook($path, $availableFiles);
        }

        return $this->reviewersFromCsvFile($path);
    }

    /**
     * @return array<int, array{file: string, reviewers: array<int, string>, source: string, label?: string}>
     */
    protected function reviewersFromCsvFile(string $path): array
    {
        $table = $this->readCsv($path);
        $headers = collect($table['headers']);

        $fileHeader = $headers
            ->first(fn ($header) => Str::lower((string) $header) === 'file')
            ?? ($headers->first() ?? 'file');

        $assignments = [];

        foreach ($table['records'] as $row) {
            $file = trim((string) ($row[$fileHeader] ?? ''));
            if ($file === '') {
                continue;
            }

            $reviewers = [];
            foreach ($row as $key => $value) {
                if (Str::startsWith(Str::lower((string) $key), 'reviewer')) {
                    $candidate = trim((string) $value);
                    if ($candidate !== '') {
                        $reviewers[] = $candidate;
                    }
                }
            }

            if ($reviewers === []) {
                continue;
            }

            $assignments[] = [
                'file' => $file,
                'reviewers' => $reviewers,
                'source' => 'csv',
                'label' => $file,
            ];
        }

        return $assignments;
    }

    /**
     * @param  array<int, string>  $availableFiles
     * @return array<int, array{name: string, source: string, files: array<int, string>}>
     * @throws Exception
     * @throws SyntaxError
     * @throws UnavailableStream
     */
    public function members(string $path, array $availableFiles = []): array
    {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        if (in_array($extension, ['xlsx', 'xls'], true)) {
            return $this->membersFromWorkbook($path, $availableFiles);
        }

        $table = $this->readCsv($path);

        $headers = collect($table['headers'])
            ->map(fn ($header) => trim((string) $header))
            ->filter()
            ->values();

        $memberHeader = $headers
            ->first(function ($header) {
                $normalized = Str::lower((string) $header);
                return in_array($normalized, ['member', 'membre'], true);
            });

        $matcher = $availableFiles !== [] ? new PdfFileMatcher($availableFiles) : null;

        if ($memberHeader !== null) {
            $assignments = [];

            foreach ($table['records'] as $row) {
                $memberName = trim((string) ($row[$memberHeader] ?? ''));

                if ($memberName === '') {
                    continue;
                }

                $paths = collect($row)
                    ->except($memberHeader)
                    ->flatMap(function ($value) {
                        return collect(preg_split('/[;\r\n]/', (string) $value) ?: [])
                            ->map(fn ($candidate) => trim((string) $candidate))
                            ->filter();
                    })
                    ->values()
                    ->all();

                $normalizedPaths = collect($paths)
                    ->map(fn ($candidate) => $this->resolveMemberReference($candidate, $matcher))
                    ->filter()
                    ->values()
                    ->all();

                $key = Str::lower($memberName);

                if (! isset($assignments[$key])) {
                    $assignments[$key] = [
                        'name' => $memberName,
                        'files' => [],
                        'source' => 'csv',
                    ];
                }

                if ($normalizedPaths !== []) {
                    $assignments[$key]['files'] = array_values(array_unique(array_merge(
                        $assignments[$key]['files'],
                        $normalizedPaths
                    )));
                }
            }

            return array_values($assignments);
        }

        $names = $headers->values();

        foreach ($table['records'] as $row) {
            foreach ($row as $value) {
                $member = trim((string) $value);
                if ($member !== '') {
                    $names->push($member);
                }
            }
        }

        return $names
            ->unique()
            ->map(fn ($name) => [
                'name' => $name,
                'files' => [],
                'source' => 'csv',
            ])
            ->values()
            ->all();
    }

    /**
     * @param  array<int, string>  $availableFiles
     * @return array<int, array{file: string, reviewers: array<int, string>, source: string, label?: string}>
     */
    protected function reviewersFromWorkbook(string $path, array $availableFiles = []): array
    {
        try {
            $spreadsheet = IOFactory::load($path);
        } catch (\Throwable $e) {
            throw new RuntimeException(sprintf('Impossible de lire le fichier Excel: %s. %s', $path, $e->getMessage()));
        }

        $sheet = $spreadsheet->getSheet(0);
        if ($sheet === null) {
            return [];
        }

        $rows = $this->readVisibleSheetRows($sheet);
        $normalizedRows = array_map(fn ($row) => $this->normalizeSpreadsheetRow($row), $rows);
        $matcher = $availableFiles !== [] ? new PdfFileMatcher($availableFiles) : null;

        $assignments = [];

        foreach ($normalizedRows as $row) {
            $lastName = $this->getFirstNonEmpty($row, ['nomdusage', 'nomusage', 'nom']);
            $firstName = $this->getFirstNonEmpty($row, ['prenom', 'prenoms']);
            $reviewers = $this->extractReviewersFromRow($row);

            if ($reviewers === []) {
                continue;
            }

            if ($lastName === '' && $firstName === '') {
                continue;
            }

            $matchedFile = $matcher?->findBestMatch($firstName, $lastName);
            $fallbackFile = $this->buildFallbackFileName($firstName, $lastName);

            $assignments[] = [
                'file' => $matchedFile ?? $fallbackFile,
                'reviewers' => $reviewers,
                'source' => 'csv',
                'label' => $this->buildDisplayName($firstName, $lastName),
            ];
        }

        return $assignments;
    }

    /**
     * @param  array<int, string>  $availableFiles
     * @return array<int, array{name: string, source: string, files: array<int, string>}>
     */
    protected function membersFromWorkbook(string $path, array $availableFiles = []): array
    {
        try {
            $spreadsheet = IOFactory::load($path);
        } catch (\Throwable $e) {
            throw new RuntimeException(sprintf('Impossible de lire le fichier Excel: %s. %s', $path, $e->getMessage()));
        }

        $sheet = $spreadsheet->getSheet(0);
        if ($sheet === null) {
            return [];
        }

        $rows = $this->readVisibleSheetRows($sheet);
        $normalizedRows = array_map(fn ($row) => $this->normalizeSpreadsheetRow($row), $rows);
        $matcher = $availableFiles !== [] ? new PdfFileMatcher($availableFiles) : null;

        $assignments = [];

        foreach ($normalizedRows as $row) {
            $name = $row['nom']
                ?? $row['nomdusage']
                ?? $row['name']
                ?? $row['membre']
                ?? '';

            $name = trim($name);
            if ($name === '') {
                continue;
            }

            $files = [];
            foreach ($row as $key => $value) {
                if (in_array($key, ['nom', 'nomdusage', 'name', 'membre'], true)) {
                    continue;
                }

                $parts = preg_split('/[;\r\n]/', (string) $value) ?: [];
                foreach ($parts as $candidate) {
                    $candidate = trim((string) $candidate);
                    if ($candidate !== '') {
                        $files[] = $candidate;
                    }
                }
            }

            $normalizedFiles = collect($files)
                ->map(fn ($candidate) => $this->resolveMemberReference($candidate, $matcher))
                ->filter()
                ->unique()
                ->values()
                ->all();

            $key = Str::lower($name);
            if (! isset($assignments[$key])) {
                $assignments[$key] = [
                    'name' => $name,
                    'files' => [],
                    'source' => 'csv',
                ];
            }

            if ($normalizedFiles !== []) {
                $assignments[$key]['files'] = array_values(array_unique(array_merge(
                    $assignments[$key]['files'],
                    $normalizedFiles
                )));
            }
        }

        return array_values($assignments);
    }

    /**
     * @return array<int, array<string, string>>
     */
    protected function readVisibleSheetRows(Worksheet $sheet): array
    {
        $highestRow = (int) $sheet->getHighestRow();
        $highestColumn = $sheet->getHighestColumn();
        if ($highestColumn === null || $highestColumn === '') {
            $highestColumn = 'A';
        }
        $maxColumnIndex = Coordinate::columnIndexFromString($highestColumn);

        $rows = [];
        $header = [];
        $headerInitialized = false;

        for ($rowIndex = 1; $rowIndex <= $highestRow; $rowIndex++) {
            $dimension = $sheet->getRowDimension($rowIndex);
            if ($dimension !== null && $dimension->getVisible() === false) {
                continue;
            }

            $rowValues = [];
            $hasContent = false;

            for ($columnIndex = 1; $columnIndex <= $maxColumnIndex; $columnIndex++) {
                $cell = $sheet->getCellByColumnAndRow($columnIndex, $rowIndex);
                $raw = $cell?->getFormattedValue();
                if ($raw === null || $raw === '') {
                    $raw = $cell?->getValue();
                }

                $value = trim((string) ($raw ?? ''));
                if (! $hasContent && $value !== '') {
                    $hasContent = true;
                }

                $rowValues[] = $value;
            }

            if (! $headerInitialized) {
                if (! $hasContent) {
                    continue;
                }

                foreach ($rowValues as $index => $value) {
                    $header[$index] = $value !== '' ? $value : 'col_'.$index;
                }

                $headerInitialized = true;
                continue;
            }

            if (! $hasContent) {
                continue;
            }

            $record = [];
            foreach ($header as $index => $key) {
                $record[$key] = $rowValues[$index] ?? '';
            }

            $nonEmpty = array_filter($record, fn ($value) => trim((string) $value) !== '');
            if ($nonEmpty === []) {
                continue;
            }

            $rows[] = $record;
        }

        return $rows;
    }

    /**
     * @param  array<string, string>  $row
     * @return array<string, string>
     */
    protected function normalizeSpreadsheetRow(array $row): array
    {
        $normalized = [];

        foreach ($row as $key => $value) {
            $normalizedKey = $this->normalizeHeader($key);
            if ($normalizedKey === '') {
                continue;
            }

            $normalized[$normalizedKey] = trim((string) $value);
        }

        return $normalized;
    }

    /**
     * @param  array<string, string>  $row
     * @return array<int, string>
     */
    protected function extractReviewersFromRow(array $row): array
    {
        $reviewers = [];

        foreach ($row as $key => $value) {
            if ($value === '') {
                continue;
            }

            if (str_starts_with($key, 'rapporteur') || str_starts_with($key, 'reviewer')) {
                $reviewers[] = $value;
            }
        }

        return array_values(array_unique($reviewers));
    }

    /**
     * @param  array<string, string>  $row
     * @param  array<int, string>  $keys
     */
    protected function getFirstNonEmpty(array $row, array $keys): string
    {
        foreach ($keys as $key) {
            $value = trim((string) ($row[$key] ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }

    protected function buildFallbackFileName(string $firstName, string $lastName): string
    {
        $parts = array_filter([
            trim($lastName),
            trim($firstName),
        ], fn ($part) => $part !== '');

        if ($parts === []) {
            return 'document.pdf';
        }

        $label = trim(preg_replace('/\s+/', ' ', implode(' ', $parts)) ?? '');

        return ($label === '' ? 'document' : $label).'.pdf';
    }

    protected function buildDisplayName(string $firstName, string $lastName): string
    {
        $parts = array_filter([
            trim($lastName),
            trim($firstName),
        ], fn ($part) => $part !== '');

        if ($parts === []) {
            return 'Rapporteur';
        }

        return trim(preg_replace('/\s+/', ' ', implode(' ', $parts)) ?? 'Rapporteur');
    }

    protected function resolveMemberReference(string $value, ?PdfFileMatcher $matcher): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        if ($matcher === null || ! PdfFileMatcher::looksLikeNameReference($trimmed)) {
            return $trimmed;
        }

        return $matcher->findByNameReference($trimmed)
            ?? $this->buildFallbackFileNameFromReference($trimmed);
    }

    protected function buildFallbackFileNameFromReference(string $reference): string
    {
        $normalized = trim(preg_replace('/\s+/', ' ', $reference) ?? '');

        return $normalized === '' ? 'document.pdf' : $normalized.'.pdf';
    }

    protected function normalizeHeader(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $value = Str::ascii($value);
        $value = Str::lower($value);

        return preg_replace('/[^a-z0-9]+/', '', $value) ?? '';
    }

    /**
     * @param string $path
     * @return array{headers: Collection<int, string>, records: array<int, array<string, string>>}
     * @throws Exception
     * @throws SyntaxError
     * @throws UnavailableStream
     */
    protected function readCsv(string $path): array
    {
        if (! is_file($path)) {
            throw new RuntimeException(sprintf('Impossible de trouver le fichier CSV: %s', $path));
        }

        $reader = Reader::createFromPath($path, 'r');
        $reader->setHeaderOffset(0);

        return [
            'headers' => collect($reader->getHeader()),
            'records' => iterator_to_array($reader->getRecords(), false),
        ];
    }
}
