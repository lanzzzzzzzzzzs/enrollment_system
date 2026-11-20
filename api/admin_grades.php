<?php
// api/admin_grades.php  (admin only)  -  encode and read a student's grades
//   GET  ?student=2024-00001  (only subjects the student is enrolled in) ->  { ok, subjects: [ { subjectId, code, title, units } ], records: [ ... ] }
//   POST { student, subjectId, grade, academicYear?, semester? }  ->  { ok, records }   new grade
//   POST { student, recordId, grade }                              ->  { ok, records }   edit an existing grade
// a new grade is saved by add_grade() (rules_lib.php) as a new attempt (a retake in a later term keeps the earlier rows),
// but a subject can only be graded once per academic year and semester: change that grade with recordId instead

require __DIR__ . '/config.php';

$admin = require_login('admin');

$grades = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00', '5.00', 'INC', 'DO'];

function grade_records($pdo, $sn)
{
    $st = $pdo->prepare(
        "SELECT ar.record_id, ar.subject_id, cs.course_code, cs.course_title, cs.units, ar.academic_year, ar.semester,
                ar.attempt_no, ar.final_grade, ar.remark
           FROM academic_record ar JOIN course_subject cs ON cs.subject_id = ar.subject_id
          WHERE ar.student_number = ?
          ORDER BY ar.academic_year, FIELD(ar.semester, '1st', '2nd', 'Summer'), cs.course_code, CAST(ar.attempt_no AS UNSIGNED)"
    );
    $st->execute([$sn]);
    return $st->fetchAll();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sn = trim((string) ($_GET['student'] ?? ''));
    $st = $pdo->prepare(
        "SELECT DISTINCT cs.subject_id, cs.course_code, cs.course_title, cs.units
           FROM enrollment e
           JOIN enrolled_subjects es ON es.enrollment_id = e.enrollment_id
           JOIN course_subject cs    ON cs.subject_id = es.subject_id
          WHERE e.student_number = ? AND e.status = 'Enrolled'
          ORDER BY cs.course_code"
    );
    $st->execute([$sn]);
    $subjects = [];
    foreach ($st->fetchAll() as $r) {
        $subjects[] = ['subjectId' => (int) $r['subject_id'], 'code' => $r['course_code'],
                       'title' => $r['course_title'], 'units' => (int) $r['units']];
    }
    json_out(['ok' => true, 'subjects' => $subjects, 'records' => grade_records($pdo, $sn)]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b         = read_body();
$sn        = trim((string) ($b['student'] ?? ''));
$subjectId = (int) ($b['subjectId'] ?? 0);
$recordId  = (int) ($b['recordId'] ?? 0);
$grade     = trim((string) ($b['grade'] ?? ''));
$ay        = (string) ($b['academicYear'] ?? '');
$sem       = (string) ($b['semester'] ?? '');

// edit an existing grade: only the grade itself changes
if ($recordId > 0) {
    if (!in_array($grade, $grades, true)) json_error('Choose a grade.', 'grade');
    $st = $pdo->prepare('SELECT 1 FROM academic_record WHERE record_id = ? AND student_number = ?');
    $st->execute([$recordId, $sn]);
    if (!$st->fetchColumn()) json_error('That grade record was not found.');
    try {
        $pdo->prepare('UPDATE academic_record SET final_grade = ?, remark = ?, encoded_by = ?, updated_at = ? WHERE record_id = ? AND student_number = ?')
            ->execute([$grade, grade_remark($grade), $admin['id'], now_str(), $recordId, $sn]);
    } catch (PDOException $e) {
        json_error(db_message($e));
    }
    json_out(['ok' => true, 'records' => grade_records($pdo, $sn)]);
}

if ($ay === '')  $ay  = $current_ay;
if ($sem === '') $sem = $current_sem;

if (!in_array($grade, $grades, true))                 json_error('Choose a grade.', 'grade');
if (!preg_match('/^[0-9]{4}-[0-9]{4}$/', $ay))        json_error('Academic year must look like 2025-2026.', 'ay');
if (!in_array($sem, ['1st', '2nd', 'Summer'], true))  json_error('Choose a semester.', 'semester');

// the subject must be one the student is enrolled in
$st = $pdo->prepare(
    "SELECT 1 FROM enrollment e JOIN enrolled_subjects es ON es.enrollment_id = e.enrollment_id
      WHERE e.student_number = ? AND e.status = 'Enrolled' AND es.subject_id = ?"
);
$st->execute([$sn, $subjectId]);
if (!$st->fetchColumn()) json_error('That subject is not one the student is enrolled in.', 'subject');

// one grade per subject per term: no second attempt in the same academic year and semester
$st = $pdo->prepare('SELECT 1 FROM academic_record WHERE student_number = ? AND subject_id = ? AND academic_year = ? AND semester = ?');
$st->execute([$sn, $subjectId, $ay, $sem]);
if ($st->fetchColumn()) json_error('This subject is already graded for ' . $ay . ' ' . $sem . ' semester. Use Edit on that grade to change it.', 'subject');

try {
    add_grade($pdo, $sn, $subjectId, $ay, $sem, $grade, $admin['id']);
} catch (PDOException $e) {
    json_error(db_message($e));
}

json_out(['ok' => true, 'records' => grade_records($pdo, $sn)]);
