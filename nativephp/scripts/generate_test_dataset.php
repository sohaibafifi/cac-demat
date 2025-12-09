#!/usr/bin/env php
<?php

declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

require __DIR__.'/../vendor/autoload.php';

// Usage:
//   php nativephp/scripts/generate_test_dataset.php [targetDir] [pdfCount]
// Defaults to data/filename_guesser_dataset with 1000 PDFs to stress-test the pipeline.

$projectRoot = dirname(__DIR__, 2);
$targetRoot = $argv[1] ?? $projectRoot.'/data/filename_guesser_dataset';
$requestedCount = isset($argv[2]) ? max(1, (int) $argv[2]) : 1000;
$pdfRoot = $targetRoot.'/pdfs';

echo "Generating filename guesser test set in {$targetRoot}\n";
echo "Requested PDF count: {$requestedCount}\n";

ensureWritableTarget($targetRoot, $projectRoot);
ensureDirectory($pdfRoot);

$basePdfEntries = [
    [
        'relative' => 'dupont_jean.pdf',
        'title' => 'Jean Dupont',
        'lines' => ['Cas simple', 'Fichier à la racine'],
    ],
    [
        'relative' => 'martin_jean-marc.pdf',
        'title' => 'Jean-Marc Martin',
        'lines' => ['Prénom composé avec tiret', 'Correspondance directe'],
    ],
    [
        'relative' => 'team-europe/van der poel luca.pdf',
        'title' => 'Luca Van Der Poel',
        'lines' => ['Nom composé avec espaces', 'Sous-dossier simple'],
    ],
    [
        'relative' => 'team-europe/van der poel - luca alt.pdf',
        'title' => 'Luca Van Der Poel (variante)',
        'lines' => ['Ordre et ponctuation différents', 'Même personne, même dossier'],
    ],
    [
        'relative' => 'nested/de la tour_jean pierre.pdf',
        'title' => 'Jean Pierre De La Tour',
        'lines' => ['Nom et prénom composés', 'Sous-dossier imbriqué'],
    ],
    [
        'relative' => "accented/García López - Élodie Anne.pdf",
        'title' => 'Élodie Anne García López',
        'lines' => ['Accents et double prénom', 'Nom de famille composé'],
    ],
    [
        'relative' => "accented/d'angelo - marco.pdf",
        'title' => "Marco D'Angelo",
        'lines' => ['Apostrophe dans le nom', 'Cas accentué'],
    ],
    [
        'relative' => 'root only/sarah_connor.pdf',
        'title' => 'Sarah Connor',
        'lines' => ['Dossier avec espace', 'Test référence "."'],
    ],
    [
        'relative' => 'nested/misc/extra wildcard.pdf',
        'title' => 'Wildcard Sample',
        'lines' => ['Pour matcher via *.pdf', 'Fichier générique'],
    ],
];

[$bulkPdfEntries, $bulkReviewers, $bulkMembers] = buildBulkDataset(
    max(0, $requestedCount - count($basePdfEntries)),
    count($basePdfEntries) + 1
);

$pdfEntries = array_merge($basePdfEntries, $bulkPdfEntries);

foreach ($pdfEntries as $entry) {
    $path = $pdfRoot.'/'.$entry['relative'];
    ensureDirectory(dirname($path));
    writeMinimalPdf($path, $entry['title'], $entry['lines']);
}

$reviewersPath = $targetRoot.'/reviewers.xlsx';
writeReviewersWorkbook($reviewersPath, [
    ['nom' => 'Dupont', 'prenom' => 'Jean', 'r1' => 'Rapporteur Alpha', 'r2' => 'Rapporteur Beta'],
    ['nom' => 'Martin', 'prenom' => 'Jean-Marc', 'r1' => 'Rapporteur Hyphen', 'r2' => ''],
    ['nom' => 'Van Der Poel', 'prenom' => 'Luca', 'r1' => 'Rapporteur Composite', 'r2' => ''],
    ['nom' => 'De La Tour', 'prenom' => 'Jean Pierre', 'r1' => 'Rapporteur Imbriqué', 'r2' => ''],
    ['nom' => 'García López', 'prenom' => 'Élodie Anne', 'r1' => 'Rapporteur Accent', 'r2' => ''],
    ['nom' => "D'Angelo", 'prenom' => 'Marco', 'r1' => 'Rapporteur Apostrophe', 'r2' => ''],
    ...$bulkReviewers,
]);

$membersPath = $targetRoot.'/members.xlsx';
writeMembersWorkbook($membersPath, [
    ['name' => 'Jean Dupont', 'files' => ['dupont_jean.pdf']],
    ['name' => 'Jean-Marc Martin', 'files' => ['martin_jean-marc.pdf']],
    ['name' => 'Luca Van Der Poel', 'files' => ['team-europe/van der poel luca.pdf']],
    ['name' => 'Jean Pierre De La Tour', 'files' => ['nested/de la tour_jean pierre.pdf']],
    ['name' => 'Élodie Anne García López', 'files' => ['accented/García López - Élodie Anne.pdf']],
    ['name' => "Marco D'Angelo", 'files' => ["accented/d'angelo - marco.pdf"]],
    ['name' => 'Sarah Connor', 'files' => ['root only/sarah_connor.pdf']],
    ['name' => 'Tous les fichiers', 'files' => []],
    ...$bulkMembers,
]);

echo "PDF source directory: {$pdfRoot}\n";
echo "Reviewers workbook   : {$reviewersPath}\n";
echo "Members workbook     : {$membersPath}\n";
echo "Total PDFs generated : ".count($pdfEntries)."\n";

/**
 * Ensure the target path exists and is inside the project to avoid accidental deletion elsewhere.
 */
function ensureWritableTarget(string $targetRoot, string $projectRoot): void
{
    $resolvedProject = realpath($projectRoot);
    if ($resolvedProject === false) {
        throw new RuntimeException('Project root introuvable.');
    }

    $resolvedTarget = realpath($targetRoot);

    if ($resolvedTarget !== false && ! str_starts_with($resolvedTarget, $resolvedProject)) {
        throw new RuntimeException(sprintf(
            'Refus de nettoyer %s (en dehors du projet). Choisissez un dossier dans %s.',
            $resolvedTarget,
            $resolvedProject
        ));
    }

    if ($resolvedTarget !== false) {
        purgeDirectory($resolvedTarget);
        return;
    }

    ensureDirectory($targetRoot);
}

function ensureDirectory(string $path): void
{
    if ($path === '' || $path === '.') {
        return;
    }

    if (is_dir($path)) {
        return;
    }

    if (! mkdir($path, 0777, true) && ! is_dir($path)) {
        throw new RuntimeException(sprintf('Impossible de créer le dossier: %s', $path));
    }
}

function purgeDirectory(string $path): void
{
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );

    foreach ($iterator as $item) {
        if ($item->isDir()) {
            rmdir($item->getPathname());
        } else {
            unlink($item->getPathname());
        }
    }

    rmdir($path);
    ensureDirectory($path);
}

function writeReviewersWorkbook(string $path, array $rows): void
{
    $spreadsheet = new Spreadsheet();
    $sheet = $spreadsheet->getActiveSheet();
    $sheet->fromArray(
        [
            ['Nom d\'usage', 'Prénom', 'Rapporteur 1', 'Rapporteur 2'],
            ...array_map(
                fn ($row) => [
                    $row['nom'],
                    $row['prenom'],
                    $row['r1'],
                    $row['r2'],
                ],
                $rows
            ),
        ]
    );

    $writer = new Xlsx($spreadsheet);
    $writer->save($path);
    $spreadsheet->disconnectWorksheets();
}

function writeMembersWorkbook(string $path, array $rows): void
{
    $maxRefs = max(array_map(fn ($row) => count($row['files']), $rows));
    $maxRefs = max(1, $maxRefs);

    $headers = ['Membre'];
    foreach (range(1, $maxRefs) as $index) {
        $headers[] = 'Fichier '.$index;
    }

    $dataRows = [];
    foreach ($rows as $row) {
        $line = [$row['name']];
        foreach ($row['files'] as $file) {
            $line[] = $file;
        }

        while (count($line) < count($headers)) {
            $line[] = '';
        }

        $dataRows[] = $line;
    }

    $spreadsheet = new Spreadsheet();
    $sheet = $spreadsheet->getActiveSheet();
    $sheet->fromArray([$headers, ...$dataRows]);

    $writer = new Xlsx($spreadsheet);
    $writer->save($path);
    $spreadsheet->disconnectWorksheets();
}

function writeMinimalPdf(string $path, string $title, array $lines): void
{
    $content = buildPdfContent($title, $lines);
    if (file_put_contents($path, $content) === false) {
        throw new RuntimeException(sprintf('Impossible d\'écrire le fichier PDF: %s', $path));
    }
}

/**
 * Very small PDF generator to avoid external dependencies.
 */
function buildPdfContent(string $title, array $lines): string
{
    $textLines = array_merge([$title], $lines);
    $stream = buildContentStream($textLines);

    $objects = [];
    $objects[] = '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj';
    $objects[] = '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj';
    $objects[] = '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj';
    $objects[] = '4 0 obj << /Length '.strlen($stream)." >> stream\n".$stream."\nendstream endobj";
    $objects[] = '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj';

    $pdf = "%PDF-1.4\n";
    $offsets = [];

    foreach ($objects as $object) {
        $offsets[] = strlen($pdf);
        $pdf .= $object."\n";
    }

    $xrefStart = strlen($pdf);

    $pdf .= "xref\n";
    $pdf .= '0 '.(count($objects) + 1)."\n";
    $pdf .= "0000000000 65535 f \n";

    foreach ($offsets as $offset) {
        $pdf .= sprintf("%010d 00000 n \n", $offset);
    }

    $pdf .= "trailer << /Size ".(count($objects) + 1)." /Root 1 0 R >>\n";
    $pdf .= "startxref\n";
    $pdf .= $xrefStart."\n";
    $pdf .= "%%EOF\n";

    return $pdf;
}

function buildContentStream(array $lines): string
{
    $parts = ['BT /F1 14 Tf 16 TL 50 780 Td'];
    $first = true;

    foreach ($lines as $line) {
        $escaped = escapePdfText(asciiOnly($line));

        if ($first) {
            $parts[] = '('.$escaped.') Tj';
            $first = false;
            continue;
        }

        $parts[] = 'T* ('.$escaped.') Tj';
    }

    $parts[] = 'ET';

    return implode(' ', $parts);
}

function escapePdfText(string $text): string
{
    return strtr($text, [
        '\\' => '\\\\',
        '(' => '\\(',
        ')' => '\\)',
        "\r" => ' ',
        "\n" => ' ',
    ]);
}

function asciiOnly(string $value): string
{
    $converted = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);

    if ($converted === false) {
        return preg_replace('/[^\x20-\x7E]/', '', $value) ?? '';
    }

    return preg_replace('/[^\x20-\x7E]/', '', $converted) ?? '';
}

/**
 * Generate a large, predictable dataset of PDFs and spreadsheet rows.
 *
 * @return array{0: array<int,array{relative:string,title:string,lines:array}>, 1: array<int,array{nom:string,prenom:string,r1:string,r2:string}>, 2: array<int,array{name:string,files:array}>}
 */
function buildBulkDataset(int $count, int $startIndex = 1): array
{
    if ($count <= 0) {
        return [[], [], []];
    }

    $pdfEntries = [];
    $reviewers = [];
    $members = [];

    for ($i = 0; $i < $count; $i++) {
        $index = $startIndex + $i;
        $batch = intdiv($i, 100);
        $slug = sprintf('bulk_%04d_dataset', $index);
        $relative = sprintf('bulk/batch_%02d/%s.pdf', $batch, $slug);

        $pdfEntries[] = [
            'relative' => $relative,
            'title' => sprintf('Bulk Dataset %04d', $index),
            'lines' => [
                sprintf('PDF auto-généré #%04d', $index),
                'Cas de charge pour tests volumétriques',
            ],
        ];

        $reviewers[] = [
            'nom' => sprintf('Bulk %04d', $index),
            'prenom' => 'Dataset',
            'r1' => sprintf('Rapporteur Lot %02d-A', $batch),
            'r2' => sprintf('Rapporteur Lot %02d-B', $batch),
        ];

        $members[] = [
            'name' => sprintf('Dataset Bulk%04d', $index),
            'files' => [$relative],
        ];
    }

    return [$pdfEntries, $reviewers, $members];
}
