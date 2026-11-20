<?php
// api/admin_programs.php  (admin only)
//   POST { action: 'add',    code, name, effectiveYear?, collegeId? }            ->  { ok, curriculumId, collegeId, name }
//        creates a new program (curriculum) with no subjects yet, inside the chosen college (the first active college if omitted).
//   POST { action: 'update', curriculumId, code, name, effectiveYear?, collegeId } ->  { ok, name, collegeId }
//        edits a program. Its subjects, study plan and students move with it.
//   POST { action: 'delete', curriculumId }                                       ->  { ok, name }
//        removes the program with its subjects, sections, study plan and prerequisites. Refused while students are enrolled
//        in it or any of its subjects has grades or enrollment plans (shift the students first).
// the list of programs and colleges comes from programs.php

require __DIR__ . '/config.php';
require __DIR__ . '/program_lib.php';

require_login('admin');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use POST.', '', 405);

$b      = read_body();
$action = (string) ($b['action'] ?? '');
if (!in_array($action, ['add', 'update', 'delete'], true)) json_error('Unknown action.');

// ---- delete ----------------------------------------------------------------------------------------------------------
if ($action === 'delete') {
    $id = (int) ($b['curriculumId'] ?? 0);
    $st = $pdo->prepare("SELECT curriculum_name FROM curriculum WHERE curriculum_id = ?");
    $st->execute([$id]);
    $name = $st->fetchColumn();
    if ($name === false) json_error('Program not found.', '', 404);

    $why = program_block_reason($pdo, $id);
    if ($why !== null) json_error($why);

    try {
        $pdo->beginTransaction();
        program_remove($pdo, $id);
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_error(db_message($e));
    }
    json_out(['ok' => true, 'name' => $name]);
}

// ---- add / update ----------------------------------------------------------------------------------------------------
$code = strtoupper(trim((string) ($b['code'] ?? '')));
$name = trim(preg_replace('/\s+/', ' ', (string) ($b['name'] ?? '')));
$year = (int) ($b['effectiveYear'] ?? 0);

if ($name === '' || mb_strlen($name) > 150)             json_error('Enter the program name (up to 150 characters).', 'name');
if (!preg_match('/^[A-Z0-9][A-Z0-9 _-]{1,19}$/', $code)) json_error('The code needs 2 to 20 letters or numbers, for example BSCS.', 'code');
if ($year !== 0 && ($year < 2000 || $year > 2100))       json_error('Enter a year like 2024, or leave it empty.', 'year');

$college = (int) ($b['collegeId'] ?? 0);
if ($college) {
    $st = $pdo->prepare("SELECT college_id FROM college WHERE college_id = ? AND is_active = 1");
    $st->execute([$college]);
    if ($st->fetchColumn() === false) json_error('Choose a college.', 'college');
} elseif ($action === 'add') {
    $college = $pdo->query("SELECT college_id FROM college WHERE is_active = 1 ORDER BY CAST(college_id AS UNSIGNED) LIMIT 1")->fetchColumn();
    if ($college === false) json_error('There is no active college to add the program to.');
} else {
    json_error('Choose a college.', 'college');
}

$id = (int) ($b['curriculumId'] ?? 0);
if ($action === 'update') {
    $st = $pdo->prepare("SELECT 1 FROM curriculum WHERE curriculum_id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) json_error('Program not found.', '', 404);
}

// the same name twice would make the typed Program box ambiguous
$st = $pdo->prepare("SELECT 1 FROM curriculum WHERE LOWER(curriculum_name) = LOWER(?) AND curriculum_id <> ?");
$st->execute([$name, $id]);
if ($st->fetchColumn()) json_error('A program with that name already exists.', 'name');

// the same code for the same year in the same college is not allowed
$st = $pdo->prepare("SELECT 1 FROM curriculum WHERE college_id = ? AND course_code = ? AND COALESCE(effective_year, '') = ? AND curriculum_id <> ?");
$st->execute([$college, $code, $year === 0 ? '' : (string) $year, $id]);
if ($st->fetchColumn()) json_error('That code is already used for the same year in this college.', 'code');

try {
    if ($action === 'add') {
        $id = (int) next_id($pdo, 'curriculum', 'curriculum_id');
        $pdo->prepare("INSERT INTO curriculum (curriculum_id, college_id, course_code, curriculum_name, effective_year, is_active) VALUES (?, ?, ?, ?, ?, '1')")
            ->execute([$id, $college, $code, $name, $year === 0 ? null : $year]);
    } else {
        $pdo->prepare("UPDATE curriculum SET college_id = ?, course_code = ?, curriculum_name = ?, effective_year = ? WHERE curriculum_id = ?")
            ->execute([$college, $code, $name, $year === 0 ? null : $year, $id]);
    }
} catch (PDOException $e) {
    json_error(db_message($e));
}

json_out(['ok' => true, 'curriculumId' => $id, 'collegeId' => (int) $college, 'name' => $name]);
