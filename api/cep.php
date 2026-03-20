<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Methods: GET, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  http_response_code(405);
  echo json_encode(['erro' => true, 'message' => 'Method not allowed']);
  exit;
}

$cep = isset($_GET['cep']) ? (string)$_GET['cep'] : '';
$cep = preg_replace('/\\D+/', '', $cep);
if (strlen($cep) !== 8) {
  http_response_code(400);
  echo json_encode(['erro' => true, 'message' => 'Invalid CEP']);
  exit;
}

$url = 'https://viacep.com.br/ws/' . $cep . '/json/';
$resp = false;
$httpCode = 0;
$curlErr = '';

if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
  curl_setopt($ch, CURLOPT_TIMEOUT, 12);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: application/json'
  ]);
  $resp = curl_exec($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlErr = curl_error($ch);
  curl_close($ch);
} else {
  $ctx = stream_context_create([
    'http' => [
      'method' => 'GET',
      'timeout' => 12,
      'header' => "Accept: application/json\r\n"
    ]
  ]);
  $resp = @file_get_contents($url, false, $ctx);
  if (isset($http_response_header) && is_array($http_response_header)) {
    foreach ($http_response_header as $h) {
      if (preg_match('/^HTTP\\/[0-9.]+\\s+(\\d{3})\\b/', $h, $m)) {
        $httpCode = (int)$m[1];
        break;
      }
    }
  }
}

if ($resp === false || $resp === '') {
  http_response_code(502);
  echo json_encode(['erro' => true, 'message' => 'CEP lookup failed', 'details' => $curlErr]);
  exit;
}

$data = json_decode($resp, true);
if (!is_array($data)) {
  http_response_code(502);
  echo json_encode(['erro' => true, 'message' => 'Invalid ViaCEP response']);
  exit;
}

if ($httpCode !== 0 && ($httpCode < 200 || $httpCode >= 300)) {
  http_response_code(502);
  echo json_encode(['erro' => true, 'message' => 'ViaCEP http error', 'http_code' => $httpCode, 'via_cep' => $data]);
  exit;
}

echo json_encode($data);
