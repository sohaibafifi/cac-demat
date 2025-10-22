<?php

namespace App\Services\Pdf;

class PdfProcessingContext
{
    /**
     * @param  array<int, string>  $temporaryPaths
     */
    public function __construct(
        public string $workingPath,
        public readonly string $relativePath,
        public readonly string $recipient,
        public readonly string $targetDirectory,
        public readonly string $basename,
        public array $temporaryPaths = [],
        public ?string $password = null,
        public bool $useDefaultLogging = true,
    ) {
    }

    public function targetPath(): string
    {
        return $this->targetDirectory.'/'.$this->basename;
    }

    public function withWorkingPath(string $path, bool $temporary = true): self
    {
        $clone = clone $this;
        if ($temporary && ! in_array($path, $clone->temporaryPaths, true)) {
            $clone->temporaryPaths[] = $path;
        }
        $clone->workingPath = $path;

        return $clone;
    }

    public function withPassword(string $password): self
    {
        $clone = clone $this;
        $clone->password = $password;

        return $clone;
    }

    public function withDefaultLogging(bool $enabled): self
    {
        $clone = clone $this;
        $clone->useDefaultLogging = $enabled;

        return $clone;
    }
}
