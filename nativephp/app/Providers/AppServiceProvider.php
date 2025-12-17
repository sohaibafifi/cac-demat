<?php

namespace App\Providers;

use App\Services\Pdf\QpdfCommandResolver;
use App\Services\Pipeline\PdfProcessingPipeline;
use App\Services\Pipeline\Stages\CleanStage;
use App\Services\Pipeline\Stages\MetadataStage;
use App\Services\Pipeline\Stages\RestrictionStage;
use App\Services\Pipeline\Stages\WatermarkStage;
use App\Support\Security\PasswordGenerator;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(PdfProcessingPipeline::class, function ($app) {
            return new PdfProcessingPipeline([
                new CleanStage(
                    $app->make(QpdfCommandResolver::class)
                ),
                new WatermarkStage($app->make(QpdfCommandResolver::class)),
                new MetadataStage(
                    $app->make(QpdfCommandResolver::class)
                ),
                new RestrictionStage(
                    $app->make(QpdfCommandResolver::class),
                    $app->make(PasswordGenerator::class)
                ),
            ]);
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
