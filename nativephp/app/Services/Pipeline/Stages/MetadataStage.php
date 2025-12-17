<?php

namespace App\Services\Pipeline\Stages;

use App\Services\Pdf\PdfProcessingContext;
use App\Services\Pdf\QpdfCommandResolver;
use App\Services\Pipeline\Stages\Contracts\PdfProcessingStage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\Process\Process;

class MetadataStage implements PdfProcessingStage
{
    public function __construct(
        protected QpdfCommandResolver $commandResolver
    ) {
    }

    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext
    {
        $qdfPath = $this->convertToQdf($context->workingPath);

        try {
            $this->rewriteMetadata($qdfPath, $context->recipient);
            $rebuilt = $this->rebuildPdf($qdfPath);

            if ($context->useDefaultLogging) {
                $this->log($logger, sprintf('  → %s: métadonnées nettoyées et sujet appliqué', $context->relativePath));
            }

            return $context->withWorkingPath($rebuilt);
        } finally {
            @unlink($qdfPath);
        }
    }

    protected function convertToQdf(string $sourcePath): string
    {
        $command = $this->commandResolver->resolve();
        $qdfPath = sys_get_temp_dir().'/cac_demat_meta_qdf_'.Str::uuid().'.pdf';

        $process = new Process([
            $command,
            '--stream-data=uncompress',
            '--object-streams=disable',
            '--remove-metadata',
            '--qdf',
            $sourcePath,
            $qdfPath,
        ]);
        $process->setTimeout(null);
        $process->run();

        $success = $process->isSuccessful() && file_exists($qdfPath);

        if (! $success) {
            if (file_exists($qdfPath)) {
                @unlink($qdfPath);
            }

            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible de préparer le QDF pour nettoyer les métadonnées. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }

        return $qdfPath;
    }

    protected function rewriteMetadata(string $qdfPath, string $recipient): void
    {
        $contents = file_get_contents($qdfPath);
        if ($contents === false) {
            throw new RuntimeException(sprintf('Impossible de lire le fichier QDF: %s', $qdfPath));
        }

        $subject = $this->buildSubject($recipient);
        $updated = $this->injectInfoDictionary($contents, $subject);

        if (file_put_contents($qdfPath, $updated) === false) {
            throw new RuntimeException(sprintf('Impossible d\'écrire le QDF mis à jour: %s', $qdfPath));
        }
    }

    protected function buildSubject(string $recipient): string
    {
        $label = trim($recipient);
        if ($label === '') {
            $label = 'WATERMARK';
        }

        $upper = mb_strtoupper($label, 'UTF-8');
        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $upper);
        $normalized = $converted === false ? $upper : $converted;

        return 'Shared with '.$normalized;
    }

    protected function buildInfoDictionary(string $subject, ?string $existingBody = null): string
    {
        $escaped = $this->escapePdfString($subject);

        $preserved = [];
        if ($existingBody !== null) {
            $cleaned = preg_replace('/\\/(Author|Producer|Title|Subject)\\s+\\((?:\\\\.|[^\\\\)])*\\)\\s*/i', '', $existingBody);
            $chunks = preg_split('/\\r?\\n/', $cleaned ?? '') ?: [];

            foreach ($chunks as $chunk) {
                $trimmed = trim($chunk);
                if ($trimmed !== '') {
                    $preserved[] = $trimmed;
                }
            }
        }

        $lines = ['<<'];
        foreach ($preserved as $line) {
            $lines[] = '  '.$line;
        }
        $lines[] = "  /Subject ({$escaped})";
        $lines[] = '>>';

        return implode("\n", $lines);
    }

    protected function escapePdfString(string $value): string
    {
        return str_replace(
            ['\\', '(', ')'],
            ['\\\\', '\\(', '\\)'],
            $value
        );
    }

    protected function injectInfoDictionary(string $source, string $subject): string
    {
        if (! preg_match('/trailer\\s*<<[\\s\\S]*?>>/', $source, $trailerMatch)) {
            throw new RuntimeException('Impossible de localiser le trailer PDF pour mettre à jour les métadonnées.');
        }

        $trailer = $trailerMatch[0];
        $maxObjectId = $this->findMaxObjectId($source);

        if (preg_match('/\\/Info\\s+(\\d+)\\s+(\\d+)\\s+R/', $source, $infoMatch)) {
            $objectId = (int) $infoMatch[1];
            $generation = (int) $infoMatch[2];
            $pattern = sprintf(
                '/(?:\\r?\\n|^)%d\\s+%d\\s+obj\\s*<<(.*?)>>\\s*endobj/s',
                $objectId,
                $generation
            );

            if (! preg_match($pattern, $source, $objectMatch)) {
                throw new RuntimeException('Impossible de localiser l\'objet Info dans le QDF.');
            }

            $dictionary = $this->buildInfoDictionary($subject, $objectMatch[1] ?? null);
            $replacement = "\n{$objectId} {$generation} obj\n{$dictionary}\nendobj";
            $updated = preg_replace($pattern, $replacement, $source, 1);

            if ($updated === null) {
                throw new RuntimeException('Échec lors de la réécriture des métadonnées PDF.');
            }

            return $this->updateTrailer($updated, $trailer, $objectId, $generation, $maxObjectId);
        }

        $newId = $maxObjectId + 1;
        $dictionary = $this->buildInfoDictionary($subject);
        $infoObject = "\n{$newId} 0 obj\n{$dictionary}\nendobj\n";
        $updated = str_replace($trailer, $infoObject.$trailer, $source);

        return $this->updateTrailer($updated, $trailer, $newId, 0, $newId);
    }

    protected function updateTrailer(string $source, string $trailer, int $infoId, int $generation, int $maxObjectId): string
    {
        $updatedTrailer = preg_replace('/\\/Info\\s+\\d+\\s+\\d+\\s+R/', "/Info {$infoId} {$generation} R", $trailer, 1);

        if ($updatedTrailer === null) {
            throw new RuntimeException('Échec lors de la mise à jour du trailer PDF.');
        }

        if ($updatedTrailer === $trailer) {
            $updatedTrailer = preg_replace('/<</', "<< /Info {$infoId} {$generation} R ", $trailer, 1);
        }

        $updatedTrailer = preg_replace_callback('/\\/Size\\s+(\\d+)/', function (array $matches) use ($infoId, $maxObjectId) {
            $current = (int) $matches[1];
            $required = max($current, $maxObjectId + 1, $infoId + 1);

            return '/Size '.$required;
        }, $updatedTrailer, 1);

        if ($updatedTrailer === null) {
            throw new RuntimeException('Échec lors de la mise à jour de la taille du trailer PDF.');
        }

        return str_replace($trailer, $updatedTrailer, $source);
    }

    protected function findMaxObjectId(string $source): int
    {
        $max = 0;

        if (preg_match_all('/(?:^|\\n)(\\d+)\\s+\\d+\\s+obj/', $source, $matches)) {
            foreach ($matches[1] as $value) {
                $id = (int) $value;
                if ($id > $max) {
                    $max = $id;
                }
            }
        }

        return $max;
    }

    protected function rebuildPdf(string $qdfPath): string
    {
        $command = $this->commandResolver->resolve();
        $outputPath = sys_get_temp_dir().'/cac_demat_metadata_'.Str::uuid().'.pdf';

        $process = new Process([
            $command,
            $qdfPath,
            $outputPath,
        ]);
        $process->setTimeout(null);
        $process->run();

        $success = $process->isSuccessful() && file_exists($outputPath);

        if (! $success) {
            if (file_exists($outputPath)) {
                @unlink($outputPath);
            }

            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible de reconstruire le PDF sans métadonnées. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }

        return $outputPath;
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
