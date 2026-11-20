<?php
// api/admin_colleges.php  (admin only)
//   POST { action: 'add',    code, name }          ->  { ok, collegeId, name }
//   POST { action: 'update', collegeId, name }     ->  { ok, name }       renames a college (its code stays)
//   POST { action: 'delete', collegeId }           ->  { ok, name, programs }
//        removes the college together with its programs, subjects, sections and study plans. Refused while a student is
//        enrolled in one of its programs or one of its subjects has grades or enrollment plans.
// Programs are created inside a college (admin_programs.php). The list of colleges comes from programs.php.

require __DIR__ . '/config.php';
require __DIR__ . '/program_lib.php';

require_login('admin');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use POST.', '', 405);

$b      = read_body();
$action = (string) ($b['action'] ?? '');
if (!in_array($action, ['add', 'update', 'delete'], true)) json_error('Unknown action.');

// ---- delete ----------------------------------------------------------------------------------------------------------
if ($action === 'delete') {
    $id = (int) ($b['collegeId'] ?? 0);
    $st = $pdo->prepare("SELECT college_name FROM college WHERE college_id = ?");
    $st->execute([$id]);
    $name = $st->fetchColumn();
    if ($name === false) json_error('College not found.', '', 404);

    $st = $pdo->prepare("SELECT curriculum_id FROM curriculum WHERE college_id = ?");
    $st->execute([$id]);
    $programs = $st->fetchAll(PDO::FETCH_COLUMN);

    foreach ($programs as $pid) {                         // check every program before anything is removed
        $why = program_block_reason($pdo, (int) $pid);
        if ($why !== null) json_error($why);
    }

    try {
        $pdo->beginTransaction();
        foreach ($programs as $pid) program_remove($pdo, (int) $pid);
        $pdo->prepare("DELETE FROM college WHERE college_id = ?")->execute([$id]);
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_error(db_message($e));
    }
    json_out(['ok' => true, 'name' => $name, 'programs' => count($programs)]);
}

$name = trim(preg_replace('/\s+/', ' ', (string) ($b['name'] ?? '')));
if ($name === '' || mb_strlen($name) > 150) json_error('Enter the college name (up to 150 characters).', 'name');

// ---- update ----------------------------------------------------------------------------------------------------------
if ($action === 'update') {
    $id = (int) ($b['collegeId'] ?? 0);
    $st = $pdo->prepare("SELECT 1 FROM college WHERE college_id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) json_error('College not found.', '', 404);

    $st = $pdo->prepare("SELECT 1 FROM college WHERE LOWER(college_name) = LOWER(?) AND college_id <> ?");
    $st->execute([$name, $id]);
    if ($st->fetchColumn()) json_error('A college with that name already exists.', 'name');

    $pdo->prepare("UPDATE college SET college_name = ? WHERE college_id = ?")->execute([$name, $id]);
    json_out(['ok' => true, 'name' => $name]);
}

// ---- add -------------------------------------------------------------------------------------------------------------
$code = strtoupper(trim((string) ($b['code'] ?? '')));
if (!preg_match('/^[A-Z0-9][A-Z0-9 _-]{1,19}$/', $code)) json_error('The code needs 2 to 20 letters or numbers, for example CISTM.', 'code');

$st = $pdo->prepare("SELECT 1 FROM college WHERE LOWER(college_name) = LOWER(?)");
$st->execute([$name]);
if ($st->fetchColumn()) json_error('A college with that name already exists.', 'name');

$st = $pdo->prepare("SELECT 1 FROM college WHERE college_code = ?");
$st->execute([$code]);
if ($st->fetchColumn()) json_error('That college code is already used.', 'code');

try {
    $id = next_id($pdo, 'college', 'college_id');
    $pdo->prepare("INSERT INTO college (college_id, college_code, college_name, is_active) VALUES (?, ?, ?, '1')")->execute([$id, $code, $name]);
} catch (PDOException $e) {
    json_error(db_message($e));
}

json_out(['ok' => true, 'collegeId' => (int) $id, 'name' => $name]);
