<?php
// api/admin_unit_limits.php  (admin only)  -  the most units a student of a program can enroll in each term
//   GET  ?curriculumId=1                       ->  { ok, terms: [ { year, semester, planUnits, maxUnits } ] }
//        planUnits = total of the study plan term, maxUnits = the limit the admin set (null = use planUnits)
//   POST { curriculumId, limits: [ { year, semester, maxUnits } ] }  ->  { ok }
//        maxUnits empty = back to the study plan total

require __DIR__ . '/config.php';

require_login('admin');

$semesters = ['1st', '2nd'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = (int) ($_GET['curriculumId'] ?? 0);

    $st = $pdo->prepare(
        "SELECT spt.year_level, spt.semester, spt.max_units,
                (SELECT SUM(cs.units) FROM study_plan sp JOIN course_subject cs ON cs.subject_id = sp.subject_id
                  WHERE sp.term_id = spt.term_id AND cs.is_academic = 1 AND cs.is_active = 1) AS plan_units
           FROM study_plan_term spt
          WHERE spt.curriculum_id = ? AND spt.semester IN ('1st', '2nd')
          ORDER BY spt.year_level, spt.semester"
    );
    $st->execute([$id]);
    $terms = [];
    foreach ($st->fetchAll() as $r) {
        $terms[] = ['year' => (int) $r['year_level'], 'semester' => $r['semester'],
                    'planUnits' => (int) $r['plan_units'],
                    'maxUnits' => $r['max_units'] === null ? null : (int) $r['max_units']];
    }
    json_out(['ok' => true, 'terms' => $terms]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b  = read_body();
$id = (int) ($b['curriculumId'] ?? 0);

$st = $pdo->prepare("SELECT 1 FROM curriculum WHERE curriculum_id = ?");
$st->execute([$id]);
if (!$st->fetchColumn()) json_error('Program not found.', '', 404);

$limits = is_array($b['limits'] ?? null) ? $b['limits'] : [];
$update = $pdo->prepare("UPDATE study_plan_term SET max_units = ? WHERE curriculum_id = ? AND year_level = ? AND semester = ?");

foreach ($limits as $l) {
    $year = (int) ($l['year'] ?? 0);
    $sem  = (string) ($l['semester'] ?? '');
    $raw  = trim((string) ($l['maxUnits'] ?? ''));
    if ($year < 1 || $year > 4 || !in_array($sem, $semesters, true)) json_error('Unknown term.');

    if ($raw === '') {
        $max = null;
    } elseif (ctype_digit($raw) && (int) $raw >= 1 && (int) $raw <= 30) {
        $max = (int) $raw;
    } else {
        json_error(year_label($year) . ' ' . $sem . ' semester: enter a whole number from 1 to 30, or leave it empty.');
    }
    $update->execute([$max, $id, $year, $sem]);
}

json_out(['ok' => true]);
