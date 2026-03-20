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

function get_notify_url() {
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
  $candidates[] = getenv('SHOPPEGOU_NOTIFY_URL');
  $candidates[] = getenv('NOTIFY_URL');
  $candidates[] = isset($_SERVER['SHOPPEGOU_NOTIFY_URL']) ? $_SERVER['SHOPPEGOU_NOTIFY_URL'] : null;
  $candidates[] = isset($_SERVER['NOTIFY_URL']) ? $_SERVER['NOTIFY_URL'] : null;
  foreach ($candidates as $cand) {
    $u = $normalize($cand);
    if ($u !== '') return $u;
  }
  return '';
}

function get_notify_token() {
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
  $candidates[] = getenv('SHOPPEGOU_NOTIFY_TOKEN');
  $candidates[] = getenv('NOTIFY_TOKEN');
  $candidates[] = isset($_SERVER['SHOPPEGOU_NOTIFY_TOKEN']) ? $_SERVER['SHOPPEGOU_NOTIFY_TOKEN'] : null;
  $candidates[] = isset($_SERVER['NOTIFY_TOKEN']) ? $_SERVER['NOTIFY_TOKEN'] : null;
  foreach ($candidates as $cand) {
    $t = $normalize($cand);
    if ($t !== '') return $t;
  }
  return '';
}

function payment_store_dir() {
  $base = rtrim((string)@sys_get_temp_dir(), "\\/ \t\r\n");
  if ($base === '') $base = __DIR__;
  $dir = $base . DIRECTORY_SEPARATOR . 'ml_payments';
  if (!@is_dir($dir)) {
    @mkdir($dir, 0700, true);
  }
  return $dir;
}

function payment_store_path($paymentCode) {
  $safe = preg_replace('/[^a-zA-Z0-9_-]+/', '_', (string)$paymentCode);
  return payment_store_dir() . DIRECTORY_SEPARATOR . $safe . '.json';
}

function load_payment_context($paymentCode) {
  $path = payment_store_path($paymentCode);
  if (!@is_file($path)) return null;
  $raw = @file_get_contents($path);
  if (!is_string($raw) || $raw === '') return null;
  $data = json_decode($raw, true);
  return is_array($data) ? $data : null;
}

function save_payment_context($paymentCode, $ctx) {
  if (!is_array($ctx)) return false;
  $path = payment_store_path($paymentCode);
  $json = json_encode($ctx);
  if (!is_string($json) || $json === '') return false;
  $tmp = $path . '.tmp';
  $ok = @file_put_contents($tmp, $json, LOCK_EX);
  if ($ok === false) return false;
  @rename($tmp, $path);
  return true;
}

function notify_event($event, $ctx) {
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
    if (strlen($v) >= 4 && substr($v, 0, 2) === '__' && substr($v, -2) === '__') {
      $v = trim(substr($v, 2, -2));
    }
    return $v;
  };

  $utmifyToken = $normalize(getenv('UTMIFY_API_TOKEN'));
  if ($utmifyToken === '' && isset($_SERVER['UTMIFY_API_TOKEN'])) $utmifyToken = $normalize($_SERVER['UTMIFY_API_TOKEN']);
  if ($utmifyToken === '' && isset($_ENV['UTMIFY_API_TOKEN'])) $utmifyToken = $normalize($_ENV['UTMIFY_API_TOKEN']);
  if ($utmifyToken === '') $utmifyToken = $normalize(getenv('UTMIFY_TOKEN'));
  if ($utmifyToken === '' && isset($_SERVER['UTMIFY_TOKEN'])) $utmifyToken = $normalize($_SERVER['UTMIFY_TOKEN']);
  if ($utmifyToken === '' && isset($_ENV['UTMIFY_TOKEN'])) $utmifyToken = $normalize($_ENV['UTMIFY_TOKEN']);

  if ($utmifyToken !== '') {
    if (!is_array($ctx)) $ctx = [];

    $platform = $normalize(getenv('UTMIFY_PLATFORM'));
    if ($platform === '' && isset($_SERVER['UTMIFY_PLATFORM'])) $platform = $normalize($_SERVER['UTMIFY_PLATFORM']);
    if ($platform === '' && isset($_ENV['UTMIFY_PLATFORM'])) $platform = $normalize($_ENV['UTMIFY_PLATFORM']);
    if ($platform === '') $platform = 'ShopPegou';

    $status = null;
    $approvedDate = null;
    if ($event === 'pix_generated') {
      $status = 'waiting_payment';
      $approvedDate = null;
    } elseif ($event === 'pix_approved') {
      $status = 'paid';
      $approvedDate = isset($ctx['utmify_approved_at']) ? $normalize($ctx['utmify_approved_at']) : '';
      if ($approvedDate === '') $approvedDate = gmdate('Y-m-d H:i:s');
    } else {
      return ['sent' => false, 'error' => 'unsupported_event'];
    }

    $createdAt = isset($ctx['utmify_created_at']) ? $normalize($ctx['utmify_created_at']) : '';
    if ($createdAt === '') {
      $createdAt = gmdate('Y-m-d H:i:s');
    }

    $paymentMethod = isset($ctx['payment_method']) ? strtolower((string)$ctx['payment_method']) : 'pix';
    if ($paymentMethod !== 'pix') $paymentMethod = 'pix';

    $orderId = '';
    if (isset($ctx['utmify_order_id'])) $orderId = $normalize($ctx['utmify_order_id']);
    if ($orderId === '' && isset($ctx['payment_code'])) $orderId = $normalize($ctx['payment_code']);
    if ($orderId === '' && isset($ctx['reference_id'])) $orderId = $normalize($ctx['reference_id']);
    if ($orderId === '') $orderId = bin2hex(random_bytes(8));

    $cleanDigits = function($v) use ($normalize) {
      $v = $normalize($v);
      if ($v === '') return null;
      $d = preg_replace('/\\D+/', '', $v);
      return $d !== '' ? $d : null;
    };

    $customerIn = isset($ctx['customer']) && is_array($ctx['customer']) ? $ctx['customer'] : [];
    $custName = isset($customerIn['name']) ? $normalize($customerIn['name']) : '';
    $custEmail = isset($customerIn['email']) ? $normalize($customerIn['email']) : '';
    $custPhone = isset($customerIn['phone']) ? $cleanDigits($customerIn['phone']) : null;
    $custDoc = isset($customerIn['document']) ? $cleanDigits($customerIn['document']) : null;
    $custCountry = isset($customerIn['country']) ? $normalize($customerIn['country']) : '';
    $custIp = null;
    if (isset($customerIn['ip'])) $custIp = $normalize($customerIn['ip']);
    if (($custIp === null || $custIp === '') && isset($ctx['client_ip'])) $custIp = $normalize($ctx['client_ip']);
    if ($custIp === '') $custIp = null;

    $itemsIn = isset($ctx['products']) && is_array($ctx['products']) ? $ctx['products'] : [];
    $products = [];
    foreach ($itemsIn as $it) {
      if (!is_array($it)) continue;
      $pid = isset($it['id']) ? $normalize($it['id']) : '';
      $pname = isset($it['name']) ? $normalize($it['name']) : '';
      $qty = isset($it['quantity']) ? (int)$it['quantity'] : 1;
      if ($qty <= 0) $qty = 1;
      $priceCents = 0;
      if (isset($it['priceInCents'])) $priceCents = (int)$it['priceInCents'];
      else if (isset($it['price'])) $priceCents = (int)$it['price'];
      if ($priceCents < 0) $priceCents = 0;
      if ($pid === '' && $pname === '') continue;
      $products[] = [
        'id' => $pid !== '' ? $pid : $pname,
        'name' => $pname !== '' ? $pname : $pid,
        'planId' => null,
        'planName' => null,
        'quantity' => $qty,
        'priceInCents' => $priceCents
      ];
    }

    $tpIn = isset($ctx['trackingParameters']) && is_array($ctx['trackingParameters']) ? $ctx['trackingParameters'] : [];
    $tpPick = function($k) use ($tpIn, $normalize) {
      if (!array_key_exists($k, $tpIn)) return null;
      $v = $normalize($tpIn[$k]);
      return $v === '' ? null : $v;
    };
    $trackingParameters = [
      'src' => $tpPick('src'),
      'sck' => $tpPick('sck'),
      'utm_source' => $tpPick('utm_source'),
      'utm_campaign' => $tpPick('utm_campaign'),
      'utm_medium' => $tpPick('utm_medium'),
      'utm_content' => $tpPick('utm_content'),
      'utm_term' => $tpPick('utm_term')
    ];

    $totalPriceInCents = isset($ctx['amount']) ? (int)$ctx['amount'] : 0;
    if ($totalPriceInCents < 0) $totalPriceInCents = 0;

    $commission = [
      'totalPriceInCents' => $totalPriceInCents,
      'gatewayFeeInCents' => 0,
      'userCommissionInCents' => $totalPriceInCents
    ];

    $payload = [
      'orderId' => $orderId,
      'platform' => $platform,
      'paymentMethod' => $paymentMethod,
      'status' => $status,
      'createdAt' => $createdAt,
      'approvedDate' => $approvedDate,
      'refundedAt' => null,
      'customer' => [
        'name' => $custName,
        'email' => $custEmail,
        'phone' => $custPhone,
        'document' => $custDoc
      ],
      'products' => $products,
      'trackingParameters' => $trackingParameters,
      'commission' => $commission
    ];
    if ($custCountry !== '') $payload['customer']['country'] = $custCountry;
    if ($custIp !== null) $payload['customer']['ip'] = $custIp;

    $bodyJson = json_encode($payload);
    if (!is_string($bodyJson) || $bodyJson === '') {
      return ['sent' => false, 'error' => 'invalid_json_body'];
    }

    $httpCode = 0;
    $resp = false;
    $curlErr = '';
    $headers = [
      'Content-Type: application/json',
      'Accept: application/json',
      'x-api-token: ' . $utmifyToken
    ];

    $url = 'https://api.utmify.com.br/api-credentials/orders';
    if (function_exists('curl_init')) {
      $ch = curl_init($url);
      curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
      curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
      curl_setopt($ch, CURLOPT_TIMEOUT, 10);
      curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyJson);
      curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
      $resp = curl_exec($ch);
      $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $curlErr = curl_error($ch);
      curl_close($ch);
    } else {
      $ctxStream = stream_context_create([
        'http' => [
          'method' => 'POST',
          'timeout' => 10,
          'header' => implode("\r\n", $headers),
          'content' => $bodyJson
        ]
      ]);
      $resp = @file_get_contents($url, false, $ctxStream);
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
      return ['sent' => false, 'error' => 'notify_failed', 'http_code' => $httpCode, 'details' => $curlErr, 'channel' => 'utmify'];
    }

    if ($httpCode !== 0 && ($httpCode < 200 || $httpCode >= 300)) {
      return ['sent' => false, 'error' => 'notify_http_error', 'http_code' => $httpCode, 'response' => is_string($resp) ? substr($resp, 0, 800) : null, 'channel' => 'utmify'];
    }

    return ['sent' => true, 'http_code' => $httpCode, 'channel' => 'utmify'];
  }

  $url = get_notify_url();
  if ($url === '') {
    return ['sent' => false, 'error' => 'missing_notify_url'];
  }
  if (!is_array($ctx)) $ctx = [];
  $token = get_notify_token();
  $body = [
    'event' => $event,
    'data' => $ctx,
    'sent_at' => gmdate('c')
  ];
  $bodyJson = json_encode($body);
  if (!is_string($bodyJson) || $bodyJson === '') {
    return ['sent' => false, 'error' => 'invalid_json_body'];
  }

  $httpCode = 0;
  $resp = false;
  $curlErr = '';
  $headers = [
    'Content-Type: application/json',
    'Accept: application/json'
  ];
  if ($token !== '') {
    $tLower = strtolower($token);
    if (strpos($tLower, 'bearer ') === 0 || strpos($tLower, 'basic ') === 0) {
      $headers[] = 'Authorization: ' . $token;
    } else {
      $headers[] = 'Authorization: Bearer ' . $token;
    }
  }

  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyJson);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $resp = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);
  } else {
    $ctxStream = stream_context_create([
      'http' => [
        'method' => 'POST',
        'timeout' => 10,
        'header' => implode("\r\n", $headers),
        'content' => $bodyJson
      ]
    ]);
    $resp = @file_get_contents($url, false, $ctxStream);
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
    return ['sent' => false, 'error' => 'notify_failed', 'http_code' => $httpCode, 'details' => $curlErr];
  }

  if ($httpCode !== 0 && ($httpCode < 200 || $httpCode >= 300)) {
    return ['sent' => false, 'error' => 'notify_http_error', 'http_code' => $httpCode, 'response' => is_string($resp) ? substr($resp, 0, 800) : null];
  }

  return ['sent' => true, 'http_code' => $httpCode];
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

$paymentCtx = [
  'payment_code' => $paymentCode,
  'amount' => $amount,
  'currency' => 'BRL',
  'payment_method' => 'pix',
  'status' => 'generated',
  'reference_id' => $referenceId,
  'utmify_order_id' => $paymentCode,
  'utmify_created_at' => gmdate('Y-m-d H:i:s'),
  'client_ip' => isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : null,
  'customer' => isset($payload['customer']) && is_array($payload['customer']) ? $payload['customer'] : new stdClass(),
  'products' => isset($payload['items']) && is_array($payload['items']) ? $payload['items'] : [],
  'trackingParameters' => isset($payload['trackingParameters']) && is_array($payload['trackingParameters']) ? $payload['trackingParameters'] : new stdClass(),
  'commission' => isset($payload['commission']) && is_array($payload['commission']) ? $payload['commission'] : null,
  'metadata' => isset($payload['metadata']) && is_array($payload['metadata']) ? $payload['metadata'] : new stdClass(),
  'created_at' => gmdate('c'),
  'notified' => [
    'pix_generated' => false,
    'pix_approved' => false
  ]
];

$existingCtx = load_payment_context($paymentCode);
if (is_array($existingCtx)) {
  $paymentCtx['notified'] = isset($existingCtx['notified']) && is_array($existingCtx['notified']) ? $existingCtx['notified'] : $paymentCtx['notified'];
}
save_payment_context($paymentCode, $paymentCtx);

$notifyGenerated = null;
if (!isset($paymentCtx['notified']['pix_generated']) || $paymentCtx['notified']['pix_generated'] !== true) {
  $notifyGenerated = notify_event('pix_generated', $paymentCtx);
  if (is_array($notifyGenerated) && isset($notifyGenerated['sent']) && $notifyGenerated['sent'] === true) {
    $paymentCtx['notified']['pix_generated'] = true;
    save_payment_context($paymentCode, $paymentCtx);
  }
}

echo json_encode([
  'success' => true,
  'payment_code' => $paymentCode,
  'pix_qrcode_text' => $pixText,
  'pix_qrcode_base64' => $pixBase64,
  'notify' => [
    'pix_generated' => $notifyGenerated
  ]
]);
