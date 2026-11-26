<?php
// Requires PHP 5.6+ (use a currently supported PHP version on your hosting).
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
function respond($code, $value) {
    http_response_code($code);
    echo json_encode($value);
    exit;
}
$method = $_SERVER['REQUEST_METHOD'];
$storage = __DIR__ . '/snapshot.php';
$prefix = "<?php http_response_code(404); exit; ?>\n";
// Hourly observations, not inferred uptime. Keys are UTC hour starts.
function hour_key($at) { return gmdate('Y-m-d\TH:00:00\Z', $at); }
function recent_history($history, $now) {
    $result = array();
    $cutoff = hour_key($now - 23 * 3600);
    foreach ($history as $key => $value) {
        // Daily aggregates cannot be converted to hourly observations.
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/', $key) && $key >= $cutoff && $key <= hour_key($now)) $result[$key] = $value;
    }
    return $result;
}
function status_level($value) {
    if (strpos($value, '🔴') !== false) return 6;
    if (strpos($value, '🟣') !== false) return 4;
    if (strpos($value, '🟡') !== false) return 3;
    if (strpos($value, '🕒') !== false) return 2;
    return 1;
}
function overall_history($data, $now) {
    $history = isset($data['overallHistory']) ? $data['overallHistory'] : array();
    // Seed once from real existing observations, without inventing earlier days.
    if (!isset($data['overallHistory']) && isset($data['history'])) {
        foreach ($data['history'] as $key => $entry) {
            $day = substr($key, 0, 10);
            if (!isset($history[$day])) $history[$day] = array('services' => array(), 'samples' => 0);
            $level = isset($entry['services']['Overall service']) ? $entry['services']['Overall service'] : 0;
            $previous = isset($history[$day]['services']['Overall service']) ? $history[$day]['services']['Overall service'] : 0;
            $history[$day]['services']['Overall service'] = max($previous, $level);
            $history[$day]['samples'] += $entry['samples'];
            if (!empty($entry['gap'])) $history[$day]['gap'] = true;
        }
    }
    $cutoff = gmdate('Y-m-d', $now - 89 * 86400);
    foreach (array_keys($history) as $day) if ($day < $cutoff || $day > gmdate('Y-m-d', $now)) unset($history[$day]);
    if (isset($data['receivedAt']) && $now - $data['receivedAt'] > 60) {
        $start = max($data['receivedAt'] + 60, strtotime($cutoff . ' UTC'));
        for ($at = $start; $at <= $now; $at = (floor($at / 86400) + 1) * 86400) {
            $day = gmdate('Y-m-d', $at);
            if (!isset($history[$day])) $history[$day] = array('services' => array(), 'samples' => 0);
            $history[$day]['gap'] = true;
        }
    }
    return $history;
}
function mark_gaps(&$history, $from, $to) {
    if ($to - $from <= 60) return;
    $start = max($from + 60, floor($to / 3600) * 3600 - 23 * 3600);
    for ($at = $start; $at <= $to; $at = (floor($at / 3600) + 1) * 3600) {
        $day = hour_key($at);
        if (!isset($history[$day])) $history[$day] = array('services' => array(), 'samples' => 0);
        $history[$day]['gap'] = true;
    }
}
if ($method === 'GET') {
    if (!is_file($storage)) respond(200, array('state' => 'waiting', 'receivedAt' => null, 'snapshot' => null));
    $file = @fopen($storage, 'rb');
    if (!$file || !flock($file, LOCK_SH)) respond(503, array('error' => 'Storage unavailable'));
    $raw = stream_get_contents($file);
    flock($file, LOCK_UN);
    fclose($file);
    $data = json_decode(substr($raw, strlen($prefix)), true);
    if (!is_array($data) || !isset($data['receivedAt'], $data['snapshot'])) respond(503, array('error' => 'Storage unavailable'));
    $data['ageSeconds'] = max(0, time() - $data['receivedAt']);
    $data['state'] = $data['ageSeconds'] > 60 ? 'stale' : 'fresh';
    if (!isset($data['history'])) $data['history'] = array();
    $data['overallHistory'] = overall_history($data, time());
    $data['history'] = recent_history($data['history'], time());
    mark_gaps($data['history'], $data['receivedAt'], time());
    $data['serverTime'] = time();
    respond(200, $data);
}
if ($method !== 'POST') {
    header('Allow: GET, POST');
    respond(405, array('error' => 'Method not allowed'));
}
$config = is_file(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : array();
$token = isset($config['token']) ? $config['token'] : '';
if (strlen($token) < 32 || strpos($token, 'REPLACE_') === 0) respond(503, array('error' => 'Configure token first'));
$provided = isset($_SERVER['HTTP_X_STATUS_TOKEN']) ? $_SERVER['HTTP_X_STATUS_TOKEN'] : '';
if (!hash_equals($token, $provided)) respond(401, array('error' => 'Unauthorized'));
if (isset($_SERVER['CONTENT_LENGTH']) && (int) $_SERVER['CONTENT_LENGTH'] > 32768) respond(413, array('error' => 'Payload too large'));
$stream = fopen('php://input', 'rb');
$raw = stream_get_contents($stream, 32769);
fclose($stream);
if (strlen($raw) > 32768) respond(413, array('error' => 'Payload too large'));
$input = json_decode($raw, true);
if (!is_array($input) || !isset($input['connected'], $input['color'], $input['summary'], $input['fields']) || !is_bool($input['connected']) || !is_int($input['color']) || !is_string($input['summary']) || strlen($input['summary']) > 2000 || !is_array($input['fields']) || count($input['fields']) > 25) respond(400, array('error' => 'Invalid snapshot'));
$fields = array();
foreach ($input['fields'] as $field) {
    if (!is_array($field) || !isset($field['name'], $field['value']) || !is_string($field['name']) || !is_string($field['value']) || strlen($field['name']) > 256 || strlen($field['value']) > 4000) respond(400, array('error' => 'Invalid field'));
    $fields[] = array('name' => $field['name'], 'value' => $field['value'], 'inline' => !empty($field['inline']));
}
$now = time();
$data = array('receivedAt' => $now, 'snapshot' => array('connected' => $input['connected'], 'color' => max(0, min(16777215, $input['color'])), 'summary' => $input['summary'], 'fields' => $fields));
// Read and update under one lock so concurrent pushes cannot lose history.
$file = @fopen($storage, 'c+b');
if (!$file || !flock($file, LOCK_EX)) respond(503, array('error' => 'Storage not writable'));
$old = json_decode(substr(stream_get_contents($file), strlen($prefix)), true);
$overall = overall_history($old, $now);
$history = isset($old['history']) && is_array($old['history']) ? $old['history'] : array();
$history = recent_history($history, $now);
if (isset($old['receivedAt'])) mark_gaps($history, $old['receivedAt'], $now);
$day = hour_key($now);
if (!isset($history[$day])) $history[$day] = array('services' => array(), 'samples' => 0);
$services = array('Overall service' => $input['connected'] ? status_level($input['summary']) : 6);
foreach ($fields as $field) {
    if (!$field['inline'] && strpos($field['name'], 'Recent health') !== 0) $services[$field['name']] = $input['connected'] ? status_level($field['value']) : 6;
}
foreach ($services as $name => $level) {
    $previous = isset($history[$day]['services'][$name]) ? $history[$day]['services'][$name] : 0;
    $history[$day]['services'][$name] = max($previous, $level);
}
$history[$day]['samples']++;
$data['history'] = $history;
$date = gmdate('Y-m-d', $now);
if (!isset($overall[$date])) $overall[$date] = array('services' => array(), 'samples' => 0);
$previous = isset($overall[$date]['services']['Overall service']) ? $overall[$date]['services']['Overall service'] : 0;
$overall[$date]['services']['Overall service'] = max($previous, $services['Overall service']);
$overall[$date]['samples']++;
$data['overallHistory'] = $overall;
// The PHP guard prevents direct HTTP access, including without .htaccess.
$encoded = $prefix . json_encode($data);
rewind($file);
$written = fwrite($file, $encoded);
$ok = $written === strlen($encoded) && ftruncate($file, $written) && fflush($file);
flock($file, LOCK_UN);
fclose($file);
if (!$ok) respond(503, array('error' => 'Storage not writable'));
respond(200, array('ok' => true));
