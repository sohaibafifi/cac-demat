<?php

namespace App\Services\Pipeline;

use App\Services\Pdf\PdfProcessingContext;
use App\Services\Pipeline\Stages\Contracts\PdfProcessingStage;

class PdfProcessingPipeline
{
    /**
     * @param  PdfProcessingStage[]  $stages
     */
    public function __construct(
        protected array $stages
    ) {
    }

    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext
    {
        foreach ($this->stages as $stage) {
            $context = $stage->process($context, $logger);
        }

        $this->cleanup($context);

        return $context;
    }

    protected function cleanup(PdfProcessingContext $context): void
    {
        $finalPath = $context->workingPath;

        foreach ($context->temporaryPaths as $path) {
            if ($path === $finalPath) {
                continue;
            }

            if (is_string($path) && $path !== '' && file_exists($path)) {
                @unlink($path);
            }
        }
    }
}
