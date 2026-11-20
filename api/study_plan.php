<?php
// api/study_plan.php  -  GET  ->  { ok, gwa, terms: [ { year, semester, subjects: [ ... ] } ] }
// the signed-in student's curriculum checklist: every subject of the study plan with the latest grade,
// the prerequisites they still miss, and whether they can take it now

require __DIR__ . '/config.php';

$user = require_login('student');

$rows = checklist_rows($pdo, $user['id']);

// missing prerequisites per subject
$missing = [];
foreach (missing_prereq_rows($pdo, $user['id']) as $m) $missing[$m['subject_id']][] = $m['missing_prereq_code'];

// year standing per subject, and the student's own year level
$st = $pdo->prepare("SELECT cs.subject_id, cs.min_year_standing, cs.is_active FROM course_subject cs
                       JOIN student s ON s.curriculum_id = cs.curriculum_id WHERE s.student_number = ?");
$st->execute([$user['id']]);
$standing = [];
$active   = [];
foreach ($st->fetchAll() as $r) {
    $standing[$r['subject_id']] = $r['min_year_standing'];
    $active[$r['subject_id']]   = (int) $r['is_active'];
}

// every prerequisite of each subject (the missing ones are listed above)
$st = $pdo->prepare("SELECT p.subject_id, pre.course_code
                       FROM prerequisite p
                       JOIN course_subject cs  ON cs.subject_id = p.subject_id
                       JOIN course_subject pre ON pre.subject_id = p.prereq_subject_id
                       JOIN student s          ON s.curriculum_id = cs.curriculum_id
                      WHERE s.student_number = ?
                      ORDER BY pre.course_code");
$st->execute([$user['id']]);
$allPrereqs = [];
foreach ($st->fetchAll() as $p) $allPrereqs[$p['subject_id']][] = $p['course_code'];

$st = $pdo->prepare("SELECT year_level, registration_status FROM student WHERE student_number = ?");
$st->execute([$user['id']]);
$me = $st->fetch();
$yearLevel = (int) $me['year_level'];
$rules = student_unit_rules($pdo, $user['id'], $current_sem);

$gwa = student_gwa($pdo, $user['id']);

// grades recorded for the current term (the Enrollment records page shows them next to the subjects in the plan)
$st = $pdo->prepare(
    "SELECT subject_id, final_grade, remark FROM academic_record
      WHERE student_number = ? AND academic_year = ? AND semester = ?
      ORDER BY CAST(attempt_no AS UNSIGNED)"
);
$st->execute([$user['id'], $current_ay, $current_sem]);
$currentGrades = [];
foreach ($st->fetchAll() as $g) $currentGrades[(int) $g['subject_id']] = ['grade' => $g['final_grade'], 'remark' => $g['remark']];

$terms = [];
foreach ($rows as $r) {
    if (empty($active[$r['subject_id']])) continue;      // inactive subjects are hidden from students
    $key = $r['year_level'] . '-' . $r['semester'];
    if (!isset($terms[$key])) {
        $terms[$key] = ['year' => (int) $r['year_level'], 'semester' => $r['semester'], 'subjects' => []];
    }
    $passed = $r['remark'] === 'PASSED';
    $miss   = $missing[$r['subject_id']] ?? [];
    $need   = $standing[$r['subject_id']] ?? null;          // minimum year standing, null when none
    $standOk = $need === null || $yearLevel >= (int) $need;
    $offeredNow = $current_sem === 'Summer' || $r['semester'] === $current_sem;          // opens only in its own semester of the study plan

    $terms[$key]['subjects'][] = [
        'subjectId'      => (int) $r['subject_id'],
        'code'           => $r['course_code'],
        'title'          => $r['course_title'],
        'units'          => (int) $r['units'],
        'isAcademic'     => (bool) $r['is_academic'],
        'grade'          => $r['final_grade'],       // null when there is no record yet
        'remark'         => $r['remark'],
        'academicYear'   => $r['academic_year'],     // school year the grade was recorded in, null when there is no record
        'prereqs'        => $allPrereqs[$r['subject_id']] ?? [],
        'missingPrereqs' => $miss,
        'passed'         => $passed,
        'minYearStanding' => $need === null ? null : (int) $need,
        'offeredNow'     => $offeredNow,                 // false when the subject opens in the other semester
        'eligible'       => !$passed && count($miss) === 0 && $standOk && $offeredNow,
    ];
}

// the school year of a term = the school year most of its recorded grades belong to (null when nothing is graded yet)
foreach ($terms as $k => $t) {
    $count = [];
    foreach ($t['subjects'] as $sub) {
        if ($sub['remark'] !== null && $sub['academicYear'] !== null && $sub['academicYear'] !== '') {
            $count[$sub['academicYear']] = ($count[$sub['academicYear']] ?? 0) + 1;
        }
    }
    arsort($count);
    $terms[$k]['academicYear'] = $count ? (string) array_key_first($count) : null;
}

json_out(['ok' => true, 'yearLevel' => $yearLevel, 'regStatus' => $me['registration_status'],
          'baseMaxUnits' => $rules['base'], 'canOverload' => $rules['canOverload'], 'gwa' => $gwa, 'currentGrades' => (object) $currentGrades, 'terms' => array_values($terms)]);
