<?php
// api/admin_term.php  (admin only)  -  the term students are enrolling for
//   GET   ->  { ok, term: { academicYear, semester }, years: [ '2025-2026', ... ], semesters: [ '1st', '2nd', 'Summer' ] }
//   POST { academicYear: '2026-2027', semester: '1st' | '2nd' | 'Summer', enrollStart: '2026-08-01', enrollEnd: '2026-08-18' }
//        saves the term and the enrollment dates (stored in app_setting; the dates may be empty)

require __DIR__ . '/config.php';

require_login('admin');

$semesters = ['1st', '2nd', 'Summer'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $start = (int) substr($current_ay, 0, 4);
    $years = [];
    for ($y = $start - 2; $y <= $start + 5; $y++) $years[] = $y . '-' . ($y + 1);
    json_out(['ok' => true, 'term' => ['academicYear' => $current_ay, 'semester' => $current_sem, 'enrollStart' => $enroll_start, 'enrollEnd' => $enroll_end], 'years' => $years, 'semesters' => $semesters]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b   = read_body();
$ay  = trim(preg_replace('/[\\x{2010}-\\x{2015}\\s]+/u', '-', (string) ($b['academicYear'] ?? '')));   // an en dash or spaces become a hyphen
$sem = (string) ($b['semester'] ?? '');

if (!preg_match('/^(\d{4})-(\d{4})$/', $ay, $m) || (int) $m[2] !== (int) $m[1] + 1) {
    json_error('Choose a school year like 2026-2027.', 'academicYear');
}
if (!in_array($sem, $semesters, true)) json_error('Choose 1st, 2nd or Summer semester.', 'semester');

$start = trim((string) ($b['enrollStart'] ?? ''));
$end   = trim((string) ($b['enrollEnd'] ?? ''));
if ($start !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $start)) json_error('Enter a valid start date.', 'enrollStart');
if ($end !== ''   && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end))   json_error('Enter a valid end date.', 'enrollEnd');
if ($start !== '' && $end !== '' && $end < $start) json_error('The end date can’t be before the start date.', 'enrollEnd');

$st = $pdo->prepare("INSERT INTO app_setting (setting_key, setting_value) VALUES (?, ?)
                      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
$st->execute(['current_ay', $ay]);
$st->execute(['current_sem', $sem]);
$st->execute(['enroll_start', $start]);
$st->execute(['enroll_end', $end]);

json_out(['ok' => true, 'term' => ['academicYear' => $ay, 'semester' => $sem, 'enrollStart' => $start, 'enrollEnd' => $end]]);
