<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  http_response_code(405);
  echo json_encode(['status' => 'failed', 'error' => 'Method not allowed']);
  exit;
}

function get_payevo_secret_key() {
  $k = getenv('PAYEVO_SECRET_KEY');
  if (is_string($k)) {
    $k = trim($k);
    if (strlen($k) >= 2) {
      $first = $k[0];
      $last = $k[strlen($k) - 1];
      if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
        $k = trim(substr($k, 1, -1));
      }
    }
    if ($k !== '') return $k;
  }

  $file = getenv('PAYEVO_SECRET_FILE');
  if (is_string($file)) {
    $file = trim($file);
    if ($file !== '' && @is_file($file)) {
      $contents = @file_get_contents($file);
      if (is_string($contents)) {
        $contents = trim($contents);
        if (strlen($contents) >= 2) {
          $first = $contents[0];
          $last = $contents[strlen($contents) - 1];
          if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
            $contents = trim(substr($contents, 1, -1));
          }
        }
        if ($contents !== '') return $contents;
      }
    }
  }

  return '';
}

$secretKey = get_payevo_secret_key();
if ($secretKey === '') {
  http_response_code(500);
  echo json_encode(['status' => 'failed', 'error' => 'Configure PAYEVO_SECRET_KEY (env) or PAYEVO_SECRET_FILE (path)']);
  exit;
}

$code = isset($_GET['code']) ? trim((string)$_GET['code']) : '';
if ($code === '') {
  http_response_code(400);
  echo json_encode(['status' => 'failed', 'error' => 'Missing code']);
  exit;
}

$url = 'https://apiv2.payevo.com.br/functions/v1/transactions/' . rawurlencode($code);

$resp = false;
$httpCode = 0;
$curlErr = '';

if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
  curl_setopt($ch, CURLOPT_TIMEOUT, 20);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Basic ' . base64_encode($secretKey),
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
      'timeout' => 20,
      'header' => implode("\r\n", [
        'Authorization: Basic ' . base64_encode($secretKey),
        'Accept: application/json'
      ])
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

if ($resp === false) {
  http_response_code(502);
  echo json_encode(['status' => 'pending', 'error' => 'Gateway connection failed', 'details' => $curlErr]);
  exit;
}

$data = json_decode($resp, true);
if (!is_array($data)) {
  http_response_code(502);
  echo json_encode(['status' => 'pending', 'error' => 'Invalid gateway response']);
  exit;
}

function pick_status($data) {
  $paths = [
    ['status'],
    ['payment', 'status'],
    ['transaction', 'status'],
    ['pix', 'status']
  ];
  foreach ($paths as $p) {
    $cur = $data;
    $ok = true;
    foreach ($p as $k) {
      if (!is_array($cur) || !array_key_exists($k, $cur)) { $ok = false; break; }
      $cur = $cur[$k];
    }
    if ($ok && is_string($cur) && trim($cur) !== '') return trim($cur);
  }
  return '';
}

$rawStatus = strtolower(pick_status($data));

$status = 'pending';
if ($httpCode >= 200 && $httpCode < 300) {
  if ($rawStatus === '') {
    $status = 'pending';
  } elseif (strpos($rawStatus, 'paid') !== false || strpos($rawStatus, 'approved') !== false || strpos($rawStatus, 'confirm') !== false || strpos($rawStatus, 'complete') !== false || $rawStatus === 'success') {
    $status = 'paid';
  } elseif (strpos($rawStatus, 'fail') !== false || strpos($rawStatus, 'cancel') !== false || strpos($rawStatus, 'expired') !== false || strpos($rawStatus, 'refus') !== false || strpos($rawStatus, 'error') !== false) {
    $status = 'failed';
  } else {
    $status = 'pending';
  }
} else {
  $status = 'pending';
}

echo json_encode(['status' => $status]);
