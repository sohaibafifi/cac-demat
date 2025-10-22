<?php

namespace App\Providers;

use Native\Laravel\Facades\Menu;
use Native\Laravel\Facades\Window;
use Native\Laravel\Contracts\ProvidesPhpIni;

class NativeAppServiceProvider implements ProvidesPhpIni
{
    /**
     * Executed once the native application has been booted.
     * Use this method to open windows, register global shortcuts, etc.
     */
    public function boot(): void
    {
        Menu::create(
            Menu::app(),
            Menu::edit(),
            Menu::view()
        );
        Window::open()
                ->showDevTools(false)
                ->title(config('app.name', 'CAC Demat'))
                ->width(1100)
                ->height(1100)
                ->minWidth(960)
                ->minHeight(720);
    }

    /**
     * Return an array of php.ini f to be set.
     */
    public function phpIni(): array
    {
        return [
            'memory_limit' => '512M',
            'error_reporting' => 'E_ALL',
            'max_execution_time' => '0',
            'max_input_time' => '0',
        ];
    }
}
