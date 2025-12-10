<?php

namespace App\Services\Pipeline\Stages;

use App\Services\Pdf\PdfProcessingContext;
use App\Services\Pdf\QpdfCommandResolver;
use App\Services\Pipeline\Stages\Contracts\PdfProcessingStage;
use App\Support\Security\PasswordGenerator;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Symfony\Component\Process\Process;

class RestrictionStage implements PdfProcessingStage
{
    public function __construct(
        protected QpdfCommandResolver $commandResolver,
        protected PasswordGenerator $passwordGenerator
    ) {
    }

    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext
    {
        $finalPath = $context->targetPath();
        $password = $this->passwordGenerator->generate(12);

        $this->applyRestrictions($context->workingPath, $finalPath, $password, $logger);

        if ($context->useDefaultLogging) {
            $this->log($logger, sprintf(
                'Processed %s for %s (owner password: %s)',
                $context->relativePath,
                $context->recipient,
                $password
            ));
        }

        return $context
            ->withWorkingPath($finalPath, temporary: false)
            ->withPassword($password);
    }

    protected function applyRestrictions(string $inputPath, string $outputPath, string $password, ?callable $logger = null): void
    {
        $resolvedInput = realpath($inputPath);
        if ($resolvedInput === false || ! is_file($resolvedInput)) {
            throw new RuntimeException(sprintf('Fichier PDF introuvable: %s', $inputPath));
        }

        $directory = dirname($outputPath);
        if (! is_dir($directory)) {
            File::makeDirectory($directory, 0755, true, true);
        }

        $command = $this->commandResolver->resolve();

        $process = new Process([
            $command,
            '--encrypt',
            '',
            $password,
            '256',
            '--print=none',
            '--extract=n',
            '--modify=annotate',
            '--',
            $resolvedInput,
            $outputPath,
        ]);
        $process->setTimeout(null);
        $process->run(function ($type, $buffer) use ($logger) {
            $this->streamOutput($logger, $buffer);
        });

        if (! $process->isSuccessful()) {
            throw new RuntimeException(trim($process->getErrorOutput() ?: $process->getOutput()));
        }
    }

    protected function streamOutput(?callable $logger, string $buffer): void
    {
        if (! $logger) {
            return;
        }

        $lines = preg_split("/\r?\n/", trim($buffer));
        foreach ($lines as $line) {
            if ($line !== '') {
                $logger('[qpdf] '.$line);
            }
        }
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
