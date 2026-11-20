<?php
// api/admin_applications.php  (admin only)  -  admissions applicants (table application)
//   GET   ->  { ok, applications: [ { id, code, name, program, date, status } ] }
//   POST { action: 'add', name, program }              new applicant, status "review"
//   POST { action: 'setStatus', id, status: 'review' | 'pending' | 'approved' | 'rejected' }
//   POST { action: 'update', id, name, program }       edit the applicant's name and program
//   POST { action: 'delete', id }                      remove the application

require __DIR__ . '/config.php';

require_login('admin');

$statuses = ['review', 'pending', 'approved', 'rejected'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $pdo->query("SELECT application_id, app_code, applicant_name, program_name, status, submitted_at
                           FROM application ORDER BY submitted_at DESC, CAST(application_id AS UNSIGNED) DESC")->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $out[] = ['id' => (int) $r['application_id'], 'code' => $r['app_code'], 'name' => $r['applicant_name'],
                  'program' => $r['program_name'], 'submittedAt' => $r['submitted_at'], 'status' => $r['status']];
    }
    json_out(['ok' => true, 'applications' => $out]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b      = read_body();
$action = (string) ($b['action'] ?? '');

if ($action === 'setStatus') {
    $status = (string) ($b['status'] ?? '');
    if (!in_array($status, $statuses, true)) json_error('Unknown status.');
    $st = $pdo->prepare("UPDATE application SET status = ? WHERE application_id = ?");
    $st->execute([$status, (int) ($b['id'] ?? 0)]);
    json_out(['ok' => true]);
}

if ($action === 'update') {
    $id      = (int) ($b['id'] ?? 0);
    $name    = trim(preg_replace('/\s+/', ' ', (string) ($b['name'] ?? '')));
    $program = trim((string) ($b['program'] ?? ''));
    if ($name === '' || mb_strlen($name) > 120)       json_error('Enter the applicant’s name.', 'name');
    if ($program === '' || mb_strlen($program) > 150) json_error('Choose or enter a program.', 'program');
    $st = $pdo->prepare("UPDATE application SET applicant_name = ?, program_name = ? WHERE application_id = ?");
    $st->execute([$name, $program, $id]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $st = $pdo->prepare("DELETE FROM application WHERE application_id = ?");
    $st->execute([(int) ($b['id'] ?? 0)]);
    if ($st->rowCount() === 0) json_error('That application no longer exists.', '', 404);
    json_out(['ok' => true]);
}

if ($action === 'add') {
    $name    = trim(preg_replace('/\s+/', ' ', (string) ($b['name'] ?? '')));
    $program = trim((string) ($b['program'] ?? ''));
    if ($name === '' || mb_strlen($name) > 120)       json_error('Enter the applicant’s name.', 'name');
    if ($program === '' || mb_strlen($program) > 150) json_error('Choose or enter a program.', 'program');

    try {
        $id = (int) next_id($pdo, 'application', 'application_id');
        // APP-25041 style code: the year plus a running number
        $code = 'APP-' . date('y') . str_pad((string) $id, 3, '0', STR_PAD_LEFT);
        $pdo->prepare("INSERT INTO application (application_id, app_code, applicant_name, program_name, status, submitted_at)
                       VALUES (?, ?, ?, ?, 'review', ?)")->execute([$id, $code, $name, $program, now_str()]);
    } catch (PDOException $e) {
        json_error(db_message($e));
    }
    json_out(['ok' => true, 'id' => $id, 'code' => $code]);
}

json_error('Unknown action.');
