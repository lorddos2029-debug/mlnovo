<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['success' => false, 'error' => 'Method not allowed']);
  exit;
}

function get_payevo_secret_key() {
  $normalize = function($v) {
    if (!is_string($v)) return '';
    $v = trim($v);
    if (strlen($v) >= 2) {
      $first = $v[0];
      $last = $v[strlen($v) - 1];
      if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
        $v = trim(substr($v, 1, -1));
      }
    }
    return $v;
  };

  $candidates = [];
  $candidates[] = getenv('PAYEVO_SECRET_KEY');
  $candidates[] = isset($_SERVER['PAYEVO_SECRET_KEY']) ? $_SERVER['PAYEVO_SECRET_KEY'] : null;
  $candidates[] = isset($_ENV['PAYEVO_SECRET_KEY']) ? $_ENV['PAYEVO_SECRET_KEY'] : null;
  foreach ($_SERVER as $kName => $kVal) {
    if (is_string($kName) && stripos($kName, 'PAYEVO_SECRET_KEY') !== false) {
      $candidates[] = $kVal;
    }
  }

  foreach ($candidates as $cand) {
    $k = $normalize($cand);
    if ($k !== '') return $k;
  }

  $fileCandidates = [];
  $fileCandidates[] = getenv('PAYEVO_SECRET_FILE');
  $fileCandidates[] = isset($_SERVER['PAYEVO_SECRET_FILE']) ? $_SERVER['PAYEVO_SECRET_FILE'] : null;
  $fileCandidates[] = isset($_ENV['PAYEVO_SECRET_FILE']) ? $_ENV['PAYEVO_SECRET_FILE'] : null;
  $fileCandidates[] = __DIR__ . '/../.payevo_secret_key';
  $fileCandidates[] = __DIR__ . '/../payevo_secret_key.txt';
  $fileCandidates[] = __DIR__ . '/../payevo_secret_key';

  foreach ($fileCandidates as $file) {
    $file = $normalize($file);
    if ($file !== '' && @is_file($file)) {
      $contents = @file_get_contents($file);
      $contents = $normalize($contents);
      if ($contents !== '') return $contents;
    }
  }

  return '';
}

$secretKey = get_payevo_secret_key();
if ($secretKey === '') {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'Configure PAYEVO_SECRET_KEY (env) or PAYEVO_SECRET_FILE (path) or create /.payevo_secret_key (or /payevo_secret_key.txt)']);
  exit;
}

$raw = file_get_contents('php://input');
$payload = json_decode($raw, true);
if (!is_array($payload)) {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
  exit;
}

$amount = isset($payload['amount']) ? (int)$payload['amount'] : 0;
if ($amount <= 0) {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Invalid amount']);
  exit;
}

$referenceId = '';
if (isset($payload['metadata']) && is_array($payload['metadata']) && isset($payload['metadata']['session_id'])) {
  $referenceId = (string)$payload['metadata']['session_id'];
}
if (!$referenceId) {
  $referenceId = bin2hex(random_bytes(8));
}

$requestBody = [
  'amount' => $amount,
  'currency' => 'BRL',
  'paymentMethod' => 'PIX',
  'referenceId' => $referenceId,
  'customer' => isset($payload['customer']) && is_array($payload['customer']) ? $payload['customer'] : new stdClass(),
  'items' => isset($payload['items']) && is_array($payload['items']) ? $payload['items'] : [],
  'metadata' => [
    'trackingParameters' => isset($payload['trackingParameters']) && is_array($payload['trackingParameters']) ? $payload['trackingParameters'] : new stdClass(),
    'checkoutMetadata' => isset($payload['metadata']) && is_array($payload['metadata']) ? $payload['metadata'] : new stdClass()
  ]
];

$bodyJson = json_encode($requestBody);
$resp = false;
$httpCode = 0;
$curlErr = '';

if (function_exists('curl_init')) {
  $ch = curl_init('https://apiv2.payevo.com.br/functions/v1/transactions');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
  curl_setopt($ch, CURLOPT_TIMEOUT, 25);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyJson);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Basic ' . base64_encode($secretKey),
    'Content-Type: application/json',
    'Accept: application/json'
  ]);
  $resp = curl_exec($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlErr = curl_error($ch);
  curl_close($ch);
} else {
  $ctx = stream_context_create([
    'http' => [
      'method' => 'POST',
      'timeout' => 25,
      'header' => implode("\r\n", [
        'Authorization: Basic ' . base64_encode($secretKey),
        'Content-Type: application/json',
        'Accept: application/json'
      ]),
      'content' => $bodyJson
    ]
  ]);
  $resp = @file_get_contents('https://apiv2.payevo.com.br/functions/v1/transactions', false, $ctx);
  if (isset($http_response_header) && is_array($http_response_header)) {
    foreach ($http_response_header as $h) {
      if (preg_match('/^HTTP\\/[0-9.]+\\s+(\\d{3})\\b/', $h, $m)) {
        $httpCode = (int)$m[1];
        break;
      }
    }
  }
}

if ($resp === false) {
  http_response_code(502);
  echo json_encode(['success' => false, 'error' => 'Gateway connection failed', 'details' => $curlErr]);
  exit;
}

$data = json_decode($resp, true);
if (!is_array($data)) {
  http_response_code(502);
  echo json_encode(['success' => false, 'error' => 'Invalid gateway response']);
  exit;
}

function pick_first_string($candidates) {
  foreach ($candidates as $v) {
    if (is_string($v)) {
      $s = trim($v);
      if ($s !== '') return $s;
    }
  }
  return '';
}

function dig($arr, $path) {
  $cur = $arr;
  foreach ($path as $k) {
    if (!is_array($cur) || !array_key_exists($k, $cur)) return null;
    $cur = $cur[$k];
  }
  return $cur;
}

$pixText = pick_first_string([
  dig($data, ['pix', 'qrcode_text']),
  dig($data, ['pix', 'qrcode']),
  dig($data, ['pix', 'qr_code']),
  dig($data, ['pix', 'copy_paste']),
  dig($data, ['pix', 'payload']),
  dig($data, ['pix', 'brcode']),
  dig($data, ['pix', 'emv']),
  dig($data, ['pix_qrcode_text']),
  dig($data, ['qrcode_text']),
  dig($data, ['qr_code_text']),
  dig($data, ['brcode'])
]);

$pixBase64 = pick_first_string([
  dig($data, ['pix', 'qrcode_base64']),
  dig($data, ['pix', 'qr_code_base64']),
  dig($data, ['pix_qrcode_base64']),
  dig($data, ['qrcode_base64']),
  dig($data, ['qr_code_base64'])
]);

$paymentCode = pick_first_string([
  dig($data, ['payment_code']),
  dig($data, ['id']),
  dig($data, ['transaction_id']),
  dig($data, ['code'])
]);

if ($httpCode < 200 || $httpCode >= 300 || (!$pixText && !$pixBase64) || !$paymentCode) {
  http_response_code(502);
  echo json_encode([
    'success' => false,
    'error' => 'Gateway error',
    'http_code' => $httpCode,
    'gateway' => $data
  ]);
  exit;
}

echo json_encode([
  'success' => true,
  'payment_code' => $paymentCode,
  'pix_qrcode_text' => $pixText,
  'pix_qrcode_base64' => $pixBase64
]);
