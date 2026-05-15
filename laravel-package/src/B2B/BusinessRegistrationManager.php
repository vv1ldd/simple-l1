<?php

namespace Meanly\SimpleL1\B2B;

/**
 * Sovereign B2B Registration Logic
 * Synergy: DaData (Verification) + Passkey (Auth) + Simple-L1 (Sovereignty)
 */
class BusinessRegistrationManager
{
    /**
     * Поиск по ИНН через DaData и подготовка к якорению в L1
     */
    public function searchAndAnchor(string $inn, string $sl1Address)
    {
        $token = config('services.dadata.token') ?? env('DADATA_TOKEN');
        
        $response = \Illuminate\Support\Facades\Http::withHeaders([
            'Authorization' => "Token $token",
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ])->post('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', [
            'query' => $inn
        ]);

        if ($response->successful()) {
            $suggestions = $response->json('suggestions');
            if (!empty($suggestions)) {
                $data = $suggestions[0]['data'];
                $officialName = $suggestions[0]['value']; // Полное название компании или ИП
                
                return [
                    'verified' => true,
                    'name' => $officialName,
                    'address' => $data['address']['value'] ?? 'н/д',
                    'ogrn' => $data['ogrn'] ?? 'н/д',
                    'l1_claim_ready' => true
                ];
            }
        }

        return [
            'verified' => false,
            'error' => 'Организация не найдена'
        ];
    }
}
