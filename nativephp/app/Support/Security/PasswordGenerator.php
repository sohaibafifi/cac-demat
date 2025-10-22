<?php

namespace App\Support\Security;

class PasswordGenerator
{
    public function generate(int $bytes = 24): string
    {
        do {
            $password = rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
        } while ($password !== '' && str_starts_with($password, '-'));

        return $password;
    }
}
