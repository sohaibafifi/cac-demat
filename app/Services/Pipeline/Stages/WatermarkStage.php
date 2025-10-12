<?php

namespace App\Services\Pipeline\Stages;

use App\Services\Pdf\QpdfCommandResolver;
use App\Services\Pipeline\Contracts\PdfProcessingStage;
use App\Services\Pipeline\PdfProcessingContext;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use JsonException;
use RuntimeException;
use Symfony\Component\Process\Process;

class WatermarkStage implements PdfProcessingStage
{
    public function __construct(
        protected QpdfCommandResolver $commandResolver
    ) {
    }

    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext
    {
        $output = sys_get_temp_dir().'/cac_demat_watermark_'.Str::uuid().'.pdf';
        $this->applyWatermark($context->workingPath, $output, $context->recipient);

        if ($context->useDefaultLogging) {
            $this->log($logger, sprintf('  → %s: watermark %s applied', $context->relativePath, $context->recipient));
        }

        return $context->withWorkingPath($output);
    }

    protected function applyWatermark(string $sourcePath, string $outputPath, string $label): void
    {
        $resolvedSource = realpath($sourcePath);
        if ($resolvedSource === false || ! is_file($resolvedSource)) {
            throw new RuntimeException(sprintf('Source PDF introuvable: %s', $sourcePath));
        }

        $directory = dirname($outputPath);
        if (! is_dir($directory)) {
            File::makeDirectory($directory, 0755, true, true);
        }

        $text = $this->prepareText($label);
        $pages = $this->getPageDimensions($resolvedSource);
        $overlayPath = $this->generateOverlayPdf($pages, $text);

        try {
            $this->applyOverlayWithQpdf($resolvedSource, $overlayPath, $outputPath);
        } finally {
            if (file_exists($overlayPath)) {
                @unlink($overlayPath);
            }
        }

        $this->optimisePdfWithQpdf($outputPath);
    }

    protected function prepareText(string $label): string
    {
        $text = trim($label);
        if ($text === '') {
            $text = 'WATERMARK';
        }

        $upper = mb_strtoupper($text, 'UTF-8');
        $converted = @iconv('UTF-8', 'ISO-8859-1//TRANSLIT', $upper);

        return $converted === false ? strtoupper($text) : $converted;
    }

    /**
     * @param  array<int, array{width: float, height: float}>  $pages
     */
    protected function generateOverlayPdf(array $pages, string $text): string
    {
        $document = $this->buildOverlayDocument($pages, $text);
        $path = sys_get_temp_dir().'/cac_demat_overlay_'.Str::uuid().'.pdf';

        if (file_put_contents($path, $document) === false) {
            throw new RuntimeException(sprintf('Impossible d\'écrire le fichier de filigrane temporaire (%s).', $path));
        }

        return $path;
    }

    /**
     * Construit un PDF minimal contenant une page de filigrane par page du document source.
     *
     * @param  array<int, array{width: float, height: float}>  $pages
     */
    protected function buildOverlayDocument(array $pages, string $text): string
    {
        if (empty($pages)) {
            throw new RuntimeException('Aucune page détectée pour générer le filigrane.');
        }

        $objectStorage = [];
        $objectStorage[1] = '';
        $objectStorage[2] = '';
        $nextObjectId = 2;

        $addObject = function (string $content) use (&$objectStorage, &$nextObjectId): int {
            $nextObjectId++;
            $objectStorage[$nextObjectId] = $content;

            return $nextObjectId;
        };

        $fontObjectId = $addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
        $gstateObjectId = $addObject('<< /Type /ExtGState /ca 0.2 /CA 0.2 /BM /Multiply >>');

        $kids = [];

        foreach ($pages as $page) {
            $width = $page['width'];
            $height = $page['height'];
            $fontSize = $this->resolveFontSize($text, $width);

            $contentStream = $this->buildPageContent($width, $height, $fontSize, $text);
            $contentLength = strlen($contentStream);

            $contentObjectId = $addObject(sprintf(
                "<< /Length %d >>\nstream\n%sendstream\n",
                $contentLength,
                $contentStream
            ));

            $pageObjectId = $addObject(sprintf(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /Font << /F1 %d 0 R >> /ExtGState << /GS1 %d 0 R >> >> /Contents %d 0 R >>",
                $this->formatNumber($width),
                $this->formatNumber($height),
                $fontObjectId,
                $gstateObjectId,
                $contentObjectId
            ));

            $kids[] = sprintf('%d 0 R', $pageObjectId);
        }

        $objectStorage[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objectStorage[2] = sprintf(
            '<< /Type /Pages /Count %d /Kids [%s] >>',
            count($kids),
            implode(' ', $kids)
        );

        $document = "%PDF-1.4\n";
        $offsets = [0];

        for ($objectId = 1; $objectId <= $nextObjectId; $objectId++) {
            $offsets[$objectId] = strlen($document);
            $document .= sprintf("%d 0 obj\n%s\nendobj\n", $objectId, $objectStorage[$objectId]);
        }

        $xrefOffset = strlen($document);
        $document .= sprintf("xref\n0 %d\n0000000000 65535 f \n", $nextObjectId + 1);

        for ($objectId = 1; $objectId <= $nextObjectId; $objectId++) {
            $document .= sprintf("%010d 00000 n \n", $offsets[$objectId]);
        }

        $document .= sprintf(
            "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%EOF\n",
            $nextObjectId + 1,
            $xrefOffset
        );

        return $document;
    }

    protected function buildPageContent(float $width, float $height, float $fontSize, string $text): string
    {
        $centerX = $width / 2;
        $centerY = $height / 2;
        $halfTextWidth = $this->estimateTextWidth($text, $fontSize) / 2;
        $baselineOffset = $fontSize * 0.3;
        $angle = deg2rad(45);

        $cos = cos($angle);
        $sin = sin($angle);
        $red = 220 / 255;

        $lines = [
            'q',
            '/GS1 gs',
            sprintf('%s 0 0 rg', $this->formatNumber($red)),
            sprintf(
                '1 0 0 1 %s %s cm',
                $this->formatNumber($centerX),
                $this->formatNumber($centerY)
            ),
            sprintf(
                '%s %s %s %s 0 0 cm',
                $this->formatNumber($cos),
                $this->formatNumber($sin),
                $this->formatNumber(-$sin),
                $this->formatNumber($cos)
            ),
            'BT',
            sprintf('/F1 %s Tf', $this->formatNumber($fontSize)),
            sprintf(
                '%s %s Td',
                $this->formatNumber(-$halfTextWidth),
                $this->formatNumber(-$baselineOffset)
            ),
            sprintf('(%s) Tj', $this->escapePdfText($text)),
            'ET',
            'Q',
        ];

        return implode("\n", $lines)."\n";
    }

    protected function resolveFontSize(string $text, float $pageWidth): float
    {
        $fontSize = 48.0;
        $maxWidth = $pageWidth * 0.8;

        while ($fontSize > 12.0) {
            $width = $this->estimateTextWidth($text, $fontSize);
            if ($width <= $maxWidth) {
                break;
            }

            $fontSize -= 2.0;
        }

        return max($fontSize, 12.0);
    }

    protected function estimateTextWidth(string $text, float $fontSize): float
    {
        $length = strlen($text);

        return $length * $fontSize * 0.6;
    }

    protected function escapePdfText(string $text): string
    {
        return str_replace(
            ['\\', '(', ')'],
            ['\\\\', '\\(', '\\)'],
            $text
        );
    }

    /**
     * @return array<int, array{width: float, height: float}>
     */
    protected function getPageDimensions(string $path): array
    {
        $command = $this->commandResolver->resolve();

        $process = new Process([$command, '--json', $path]);
        $process->setTimeout(null);
        $process->run();

        if (! $process->isSuccessful()) {
            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible d\'analyser le PDF source avec qpdf. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }

        try {
            /** @var array<string, mixed> $payload */
            $payload = json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException(sprintf(
                'Impossible d\'analyser la sortie JSON de qpdf. Erreur: %s',
                $exception->getMessage()
            ), 0, $exception);
        }

        $pages = $this->extractPageDimensionsFromJson($payload);

        if (empty($pages)) {
            throw new RuntimeException('Impossible de récupérer les dimensions des pages via qpdf.');
        }

        return $pages;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<int, array{width: float, height: float}>
     */
    protected function extractPageDimensionsFromJson(array $payload): array
    {
        if (! isset($payload['pages']) || ! is_array($payload['pages'])) {
            return [];
        }

        $objects = $this->buildQpdfObjectIndex($payload['qpdf'] ?? []);
        $dimensions = [];

        foreach ($payload['pages'] as $index => $page) {
            if (! is_array($page) || ! isset($page['object']) || ! is_string($page['object'])) {
                continue;
            }

            try {
                $dimensions[] = $this->extractPageDimensions($page['object'], $objects, (int) $index + 1);
            } catch (RuntimeException $exception) {
                throw new RuntimeException(
                    'Impossible de récupérer les dimensions des pages via qpdf.',
                    0,
                    $exception
                );
            }
        }

        return $dimensions;
    }

    /**
     * @param  array<int, mixed>  $sections
     * @return array<string, array<string, mixed>>
     */
    protected function buildQpdfObjectIndex(array $sections): array
    {
        $objects = [];

        foreach ($sections as $section) {
            if (! is_array($section)) {
                continue;
            }

            foreach ($section as $key => $value) {
                if (! is_string($key) || ! str_starts_with($key, 'obj:')) {
                    continue;
                }

                $objects[substr($key, 4)] = is_array($value) ? $value : [];
            }
        }

        return $objects;
    }

    /**
     * @param  array<string, array<string, mixed>>  $objects
     * @return array{width: float, height: float}
     */
    protected function extractPageDimensions(string $objectId, array $objects, int $pageNumber): array
    {
        $mediaBox = $this->resolveInheritedEntry($objectId, '/MediaBox', $objects);

        if (! is_array($mediaBox) || count($mediaBox) !== 4) {
            throw new RuntimeException(sprintf(
                'Impossible de déterminer la MediaBox pour la page %d.',
                $pageNumber
            ));
        }

        $mediaBox = array_map(
            fn ($value) => $this->castToFloat($value, 'MediaBox'),
            array_values($mediaBox)
        );

        $rotationValue = $this->resolveInheritedEntry($objectId, '/Rotate', $objects);
        $rotation = is_numeric($rotationValue) ? (int) $rotationValue : 0;

        $userUnitValue = $this->resolveInheritedEntry($objectId, '/UserUnit', $objects);
        $userUnit = is_numeric($userUnitValue) ? (float) $userUnitValue : 1.0;

        if ($userUnit <= 0.0) {
            $userUnit = 1.0;
        }

        return $this->calculatePageSize($mediaBox, $rotation, $userUnit);
    }

    /**
     * @param  array<string, array<string, mixed>>  $objects
     */
    protected function resolveInheritedEntry(string $objectId, string $key, array $objects): mixed
    {
        $visited = [];

        while (isset($objects[$objectId]) && ! isset($visited[$objectId])) {
            $visited[$objectId] = true;
            $definition = $objects[$objectId];
            $value = $definition['value'] ?? null;

            if (is_array($value) && array_key_exists($key, $value)) {
                return $this->dereferenceValue($value[$key], $objects);
            }

            if (! is_array($value) || ! isset($value['/Parent']) || ! is_string($value['/Parent'])) {
                break;
            }

            $objectId = $value['/Parent'];
        }

        return null;
    }

    /**
     * @param  array<string, array<string, mixed>>  $objects
     */
    protected function dereferenceValue(mixed $value, array $objects): mixed
    {
        if (is_string($value) && preg_match('/^\\d+ \\d+ R$/', $value) === 1) {
            $reference = substr($value, 0, -2);

            if (isset($objects[$reference]['value'])) {
                return $objects[$reference]['value'];
            }
        }

        return $value;
    }

    protected function castToFloat(mixed $value, string $context): float
    {
        if (is_numeric($value)) {
            return (float) $value;
        }

        throw new RuntimeException(sprintf(
            'Valeur numérique attendue pour %s, reçue: %s',
            $context,
            is_scalar($value) ? (string) $value : gettype($value)
        ));
    }

    /**
     * @param  array{0: float, 1: float, 2: float, 3: float}  $mediaBox
     * @return array{width: float, height: float}
     */
    protected function calculatePageSize(array $mediaBox, int $rotation, float $userUnit): array
    {
        if ($userUnit <= 0.0) {
            $userUnit = 1.0;
        }

        [$x1, $y1, $x2, $y2] = $mediaBox;

        $width = abs(($x2 - $x1) * $userUnit);
        $height = abs(($y2 - $y1) * $userUnit);

        $normalizedRotation = (($rotation % 360) + 360) % 360;
        if (in_array($normalizedRotation, [90, 270], true)) {
            [$width, $height] = [$height, $width];
        }

        if ($width <= 0.0 || $height <= 0.0) {
            throw new RuntimeException('Dimensions invalides renvoyées par qpdf.');
        }

        return [
            'width' => $width,
            'height' => $height,
        ];
    }

    protected function applyOverlayWithQpdf(string $source, string $overlay, string $output): void
    {
        $command = $this->commandResolver->resolve();

        $process = new Process([
            $command,
            '--overlay',
            $overlay,
            '--',
            $source,
            $output,
        ]);
        $process->setTimeout(null);
        $process->run();

        $success = $process->isSuccessful() && file_exists($output);

        if (! $success) {
            if (file_exists($output)) {
                @unlink($output);
            }

            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible d\'appliquer le filigrane via qpdf. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }
    }

    protected function optimisePdfWithQpdf(string $path): void
    {
        $command = $this->commandResolver->resolve();
        $temporaryOutput = sys_get_temp_dir().'/cac_demat_optimized_'.Str::uuid().'.pdf';

        $process = new Process([
            $command,
            '--stream-data=compress',
            '--object-streams=generate',
            '--',
            $path,
            $temporaryOutput,
        ]);
        $process->setTimeout(null);
        $process->run();

        $success = $process->isSuccessful() && file_exists($temporaryOutput);

        if (! $success) {
            if (file_exists($temporaryOutput)) {
                @unlink($temporaryOutput);
            }

            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible d\'optimiser le PDF généré. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }

        $contents = file_get_contents($temporaryOutput);
        if ($contents === false) {
            @unlink($temporaryOutput);

            throw new RuntimeException(sprintf(
                'Impossible de lire le PDF optimisé généré par qpdf (%s).',
                $temporaryOutput
            ));
        }

        if (file_put_contents($path, $contents) === false) {
            @unlink($temporaryOutput);

            throw new RuntimeException(sprintf(
                'Impossible d\'écrire le PDF optimisé (%s).',
                $path
            ));
        }

        @unlink($temporaryOutput);
    }

    protected function formatNumber(float $value): string
    {
        return rtrim(rtrim(sprintf('%.4f', $value), '0'), '.');
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
