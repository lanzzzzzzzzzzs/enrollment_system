<?php
// api/admin_registrations.php  (admin only)  -  new student sign-ups waiting for a check of their checklist PDF
//   GET                       ->  { ok, registrations: [ ... ] }    Pending first, each with the grades read from the PDF
//   GET  ?download=12         ->  the pdf itself (shown in the browser)
//   POST { registrationId, decision: 'Approved' | 'Rejected', remarks }   remarks are required for Rejected
// Approved: the student account and the grades from the PDF are created now. Rejected: no account, the student sees the remark when signing in.

require __DIR__ . '/config.php';
require __DIR__ . '/registration_lib.php';

$admin = require_login('admin');
ensure_registration_table($pdo);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    if (!empty($_GET['download'])) {
        $st = $pdo->prepare("SELECT file_name, file_path FROM registration WHERE registration_id = ?");
        $st->execute([(int) $_GET['download']]);
        $f = $st->fetch();
        $full = $f ? dirname(__DIR__) . '/' . $f['file_path'] : '';
        if (!$f || $f['file_path'] === '' || !is_file($full)) { http_response_code(404); header('Content-Type: text/plain'); echo 'File not found.'; exit; }

        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]+/', '_', $f['file_name']) . '"');
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($full));
        readfile($full);
        exit;
    }

    $rows = $pdo->query(
        "SELECT r.registration_id, r.student_number, r.curriculum_id, r.last_name, r.first_name, r.middle_name, r.year_level,
                r.registration_status, r.grades_json, r.file_name, r.status, r.remarks, r.submitted_at, c.curriculum_name
           FROM registration r JOIN curriculum c ON c.curriculum_id = r.curriculum_id
          ORDER BY FIELD(r.status, 'Pending', 'Rejected', 'Approved'), r.submitted_at DESC"
    )->fetchAll();

    $out = [];
    foreach ($rows as $r) {
        $grades = [];
        foreach (registration_grade_rows($pdo, (int) $r['curriculum_id'], $r['student_number'], json_decode($r['grades_json'], true) ?: []) as $g) {
            $grades[] = ['code' => $g[1], 'title' => $g[2], 'grade' => $g[5]];
        }
        $out[] = [
            'id'        => (int) $r['registration_id'],
            'studentId' => $r['student_number'],
            'name'      => trim($r['first_name'] . ' ' . ($r['middle_name'] ?? '') . ' ' . $r['last_name']),
            'program'   => $r['curriculum_name'],
            'year'      => year_label($r['year_level']),
            'regStatus' => $r['registration_status'],
            'fileName'  => $r['file_name'],
            'status'    => $r['status'],
            'remarks'   => $r['remarks'],
            'submittedAt' => $r['submitted_at'],
            'grades'    => $grades,
        ];
    }
    json_out(['ok' => true, 'registrations' => $out]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b        = read_body();
$id       = (int) ($b['registrationId'] ?? 0);
$decision = (string) ($b['decision'] ?? '');
$remarks  = trim((string) ($b['remarks'] ?? ''));
if (!in_array($decision, ['Approved', 'Rejected'], true)) json_error('Unknown decision.');
if ($decision === 'Rejected' && $remarks === '') json_error('Add a remark so the student knows why.', 'remarks');
if (mb_strlen($remarks) > 500) json_error('Keep the remark under 500 characters.', 'remarks');

$st = $pdo->prepare("SELECT * FROM registration WHERE registration_id = ?");
$st->execute([$id]);
$r = $st->fetch();
if (!$r) json_error('That registration no longer exists.', '', 404);
if ($r['status'] !== 'Pending') json_error('That registration was already ' . strtolower($r['status']) . '.');

if ($decision === 'Rejected') {
    $pdo->prepare("UPDATE registration SET status = 'Rejected', remarks = ?, decided_at = ?, decided_by = ? WHERE registration_id = ?")
        ->execute([$remarks, now_str(), $admin['id'], $id]);
    json_out(['ok' => true]);
}

// ---- approve: create the account and the grades from the PDF ----
$sn = $r['student_number'];

$st = $pdo->prepare("SELECT 1 FROM student WHERE student_number = ?");
$st->execute([$sn]);
if ($st->fetchColumn()) json_error('That student ID already has an account.');

$st = $pdo->prepare("SELECT 1 FROM curriculum WHERE curriculum_id = ? AND is_active = 1");
$st->execute([$r['curriculum_id']]);
if (!$st->fetchColumn()) json_error('The program of this student is no longer active.');

$rows = registration_grade_rows($pdo, (int) $r['curriculum_id'], $sn, json_decode($r['grades_json'], true) ?: []);
if ((int) $r['year_level'] !== 1 && count($rows) === 0) json_error('None of the subjects in that file match the program.');

try {
    $pdo->beginTransaction();
    $pdo->prepare(
        "INSERT INTO student (student_number, curriculum_id, last_name, first_name, middle_name,
                              year_level, batch_year, registration_status, password_hash, account_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)"
    )->execute([$sn, $r['curriculum_id'], $r['last_name'], $r['first_name'], $r['middle_name'],
                $r['year_level'], (string) (int) substr($sn, 0, 4), $r['registration_status'], $r['password_hash'], now_str()]);

    // the grades read from the checklist PDF are the first attempt of each subject
    foreach ($rows as $g) add_grade($pdo, $sn, $g[0], $g[3], $g[4], $g[5], $admin['id'], 1);

    $pdo->prepare("UPDATE registration SET status = 'Approved', remarks = NULL, decided_at = ?, decided_by = ? WHERE registration_id = ?")
        ->execute([now_str(), $admin['id'], $id]);
    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    json_error(db_message($e));
}

json_out(['ok' => true]);
