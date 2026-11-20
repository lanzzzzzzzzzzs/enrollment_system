<?php
// api/admin_shift.php  (admin only)  -  moves a student to another program (a shifter) and carries the credits over
//   GET  ?student=2024-00001&curriculum=3
//        -> { ok, student, from, to, enrollmentStatus, rows: [ { fromSubjectId, fromCode, fromTitle, grade, remark,
//             toSubjectId, toCode, toTitle, via } ], newSubjects: [ ... ] }
//        a preview only, nothing is changed. via = 'equivalency' | 'same code' | null (no match yet)
//   POST { action: 'shift', studentId, curriculumId, yearLevel, regStatus, mappings: [ { from, to } ] }
//        mappings are extra equivalencies picked by the admin, they are saved so the next shifter gets them too
//
// how credits work:
//   1. subject_equivalency says "old subject X counts as new subject Y" (saved once, reused for every shifter)
//   2. when no equivalency exists, a subject with the same course code in the new program is credited
//   3. credited grades are moved to the new subject, so the checklist, prerequisites and GWA use them
//   4. grades with no match are copied to academic_record_archive and removed from the active records,
//      so they don't count towards the new GWA but nothing is lost

require __DIR__ . '/config.php';

$admin = require_login('admin');

// the tables subject_equivalency, academic_record_archive and student_shift_log are part of INFO_MAN_DB.sql (section 1b)

function load_student($pdo, $sn)
{
    $st = $pdo->prepare("SELECT student_number, curriculum_id, year_level, registration_status FROM student WHERE student_number = ?");
    $st->execute([$sn]);
    $s = $st->fetch();
    if (!$s) json_error('Student not found.', '', 404);
    return $s;
}

function load_program($pdo, $id)
{
    $st = $pdo->prepare("SELECT curriculum_id, course_code, curriculum_name FROM curriculum WHERE curriculum_id = ? AND is_active = 1");
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) json_error('Choose a program from the list.', 'program');
    return $p;
}

// one row per subject the student has grades in (in the old program), with the subject it would be credited as
function build_plan($pdo, $sn, $from, $toCur)
{
    $st = $pdo->prepare(
        "SELECT cs.subject_id, cs.course_code, cs.course_title,
                MAX(CASE WHEN ar.remark = 'PASSED' THEN 1 ELSE 0 END) AS passed,
                SUBSTRING_INDEX(GROUP_CONCAT(ar.final_grade ORDER BY CAST(ar.attempt_no AS UNSIGNED) DESC), ',', 1) AS grade
           FROM academic_record ar
           JOIN course_subject cs ON cs.subject_id = ar.subject_id
          WHERE ar.student_number = ? AND cs.curriculum_id = ?
          GROUP BY cs.subject_id, cs.course_code, cs.course_title
          ORDER BY passed DESC, cs.course_code");
    $st->execute([$sn, $from]);
    $old = $st->fetchAll();

    $eq = $pdo->prepare(
        "SELECT t.subject_id, t.course_code, t.course_title
           FROM subject_equivalency e JOIN course_subject t ON t.subject_id = e.to_subject_id
          WHERE e.from_subject_id = ? AND t.curriculum_id = ? AND t.is_active = 1
          ORDER BY t.course_code LIMIT 1");
    $same = $pdo->prepare("SELECT subject_id, course_code, course_title FROM course_subject
                            WHERE curriculum_id = ? AND course_code = ? AND is_active = 1");

    $rows = [];
    $taken = [];                       // a new subject can be credited only once
    foreach ($old as $o) {
        $target = null; $via = null;
        $eq->execute([$o['subject_id'], $toCur]);
        $m = $eq->fetch();
        if ($m) { $target = $m; $via = 'equivalency'; }
        else {
            $same->execute([$toCur, $o['course_code']]);
            $m = $same->fetch();
            if ($m) { $target = $m; $via = 'same code'; }
        }
        if ($target && isset($taken[$target['subject_id']])) { $target = null; $via = null; }
        if ($target) $taken[$target['subject_id']] = true;
        $rows[] = [
            'fromSubjectId' => (int) $o['subject_id'], 'fromCode' => $o['course_code'], 'fromTitle' => $o['course_title'],
            'grade' => $o['grade'], 'passed' => (bool) $o['passed'],
            'toSubjectId' => $target ? (int) $target['subject_id'] : null, 'toCode' => $target ? $target['course_code'] : null,
            'toTitle' => $target ? $target['course_title'] : null, 'via' => $via,
        ];
    }
    return $rows;
}

function current_plan_status($pdo, $sn, $ay, $sem)
{
    $st = $pdo->prepare("SELECT enrollment_id, status FROM enrollment WHERE student_number = ? AND academic_year = ? AND semester = ?");
    $st->execute([$sn, $ay, $sem]);
    return $st->fetch() ?: null;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sn  = trim((string) ($_GET['student'] ?? ''));
    $s   = load_student($pdo, $sn);
    $to  = load_program($pdo, (int) ($_GET['curriculum'] ?? 0));
    if ((int) $s['curriculum_id'] === (int) $to['curriculum_id']) json_error('The student is already in that program.', 'program');

    $rows = build_plan($pdo, $sn, (int) $s['curriculum_id'], (int) $to['curriculum_id']);
    $ns = $pdo->prepare("SELECT subject_id, course_code, course_title FROM course_subject WHERE curriculum_id = ? AND is_active = 1 ORDER BY course_code");
    $ns->execute([$to['curriculum_id']]);
    $plan = current_plan_status($pdo, $sn, $current_ay, $current_sem);

    json_out(['ok' => true, 'to' => $to, 'rows' => $rows, 'newSubjects' => $ns->fetchAll(),
              'enrollmentStatus' => $plan ? $plan['status'] : null]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b = read_body();
if ((string) ($b['action'] ?? '') !== 'shift') json_error('Unknown action.');

$sn   = trim((string) ($b['studentId'] ?? ''));
$s    = load_student($pdo, $sn);
$to   = load_program($pdo, (int) ($b['curriculumId'] ?? 0));
$from = (int) $s['curriculum_id'];
$toId = (int) $to['curriculum_id'];
if ($from === $toId) json_error('The student is already in that program.', 'program');

$year = (int) ($b['yearLevel'] ?? $s['year_level']);
$reg  = (string) ($b['regStatus'] ?? $s['registration_status']);
if ($year < 1 || $year > 8) json_error('Choose a year level.', 'year');
if (!in_array($reg, ['Regular', 'Irregular'], true)) json_error('Choose Regular or Irregular.', 'status');
if ($reg === 'Regular' && $year > 4) json_error('Regular students are up to 4th year. Choose Irregular for 5th year and up.', 'year');

// a plan already sent for review or approved holds section slots of the old program: the admin settles it first
$plan = current_plan_status($pdo, $sn, $current_ay, $current_sem);
if ($plan && $plan['status'] !== 'Draft') {
    json_error('This student’s plan for the current term is ' . $plan['status'] . '. Return or reject it first, then shift the program.');
}

try {
    $pdo->beginTransaction();

    // equivalencies picked in the preview are saved for the next shifter too
    $chk = $pdo->prepare("SELECT 1 FROM course_subject a, course_subject b
                           WHERE a.subject_id = ? AND a.curriculum_id = ? AND b.subject_id = ? AND b.curriculum_id = ?");
    $ins = $pdo->prepare("INSERT IGNORE INTO subject_equivalency (from_subject_id, to_subject_id) VALUES (?, ?)");
    foreach (is_array($b['mappings'] ?? null) ? $b['mappings'] : [] as $m) {
        $f = (int) ($m['from'] ?? 0); $t = (int) ($m['to'] ?? 0);
        $chk->execute([$f, $from, $t, $toId]);
        if ($chk->fetchColumn()) $ins->execute([$f, $t]);
    }

    $rows = build_plan($pdo, $sn, $from, $toId);

    // the Draft plan still lists subjects of the old program, so it is emptied
    if ($plan) $pdo->prepare("DELETE FROM enrolled_subjects WHERE enrollment_id = ?")->execute([$plan['enrollment_id']]);

    $move = $pdo->prepare("UPDATE academic_record SET subject_id = ? WHERE student_number = ? AND subject_id = ?");
    $old  = $pdo->prepare("SELECT student_number, subject_id, academic_year, semester, attempt_no, final_grade
                             FROM academic_record WHERE student_number = ? AND subject_id = ?");
    $arch = $pdo->prepare("INSERT INTO academic_record_archive (archive_id, student_number, subject_id, academic_year, semester, attempt_no, final_grade, reason, archived_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'Program shift, no equivalent subject', ?)");
    $del  = $pdo->prepare("DELETE FROM academic_record WHERE student_number = ? AND subject_id = ?");

    $credited = 0; $archived = 0;
    foreach ($rows as $r) {
        if ($r['toSubjectId']) { $move->execute([$r['toSubjectId'], $sn, $r['fromSubjectId']]); $credited++; }
        else {
            // copy the grades to the archive one by one, then remove them from the active records
            $old->execute([$sn, $r['fromSubjectId']]);
            foreach ($old->fetchAll() as $g) {
                $arch->execute([next_id($pdo, 'academic_record_archive', 'archive_id'), $g['student_number'], $g['subject_id'],
                                $g['academic_year'], $g['semester'], $g['attempt_no'], $g['final_grade'], now_str()]);
            }
            $del->execute([$sn, $r['fromSubjectId']]);
            $archived++;
        }
    }

    $pdo->prepare("UPDATE student SET curriculum_id = ?, year_level = ?, registration_status = ? WHERE student_number = ?")
        ->execute([$toId, $year, $reg, $sn]);
    $pdo->prepare("INSERT INTO student_shift_log (shift_id, student_number, from_curriculum, to_curriculum, credited, archived, shifted_by, shifted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        ->execute([next_id($pdo, 'student_shift_log', 'shift_id'), $sn, $from, $toId, $credited, $archived, $admin['id'] ?? null, now_str()]);

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    json_error(db_message($e));
}

json_out(['ok' => true, 'credited' => $credited, 'archived' => $archived, 'program' => $to['curriculum_name']]);
