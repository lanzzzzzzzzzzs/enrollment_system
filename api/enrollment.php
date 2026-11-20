<?php
// api/enrollment.php  (student, current term)
//   GET                                         ->  { ok, enrollment }   enrollment is null until the first subject is added
//   POST { action: 'add', scheduleId }          ->  adds the section (picking another section of the same subject swaps it)
//   POST { action: 'remove', subjectId }        ->  removes the subject from the plan
//   POST { action: 'submit' }                   ->  Draft -> For Review, holds one slot per section
// the rules (slots, locked plans, submit) are in rules_lib.php, their messages come back as { ok: false, error }

require __DIR__ . '/config.php';

$user = require_login('student');
$sn   = $user['id'];

function find_enrollment($pdo, $sn, $ay, $sem)
{
    $st = $pdo->prepare("SELECT enrollment_id FROM enrollment WHERE student_number = ? AND academic_year = ? AND semester = ?");
    $st->execute([$sn, $ay, $sem]);
    return $st->fetchColumn();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = find_enrollment($pdo, $sn, $current_ay, $current_sem);
    json_out(['ok' => true, 'enrollment' => $id ? enrollment_details($pdo, $id) : null]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b      = read_body();
$action = (string) ($b['action'] ?? '');

if ($action === 'add') {
    $scheduleId = (int) ($b['scheduleId'] ?? 0);

    // the section must belong to the student's own program
    $st = $pdo->prepare(
        "SELECT sc.subject_id FROM schedule sc
           JOIN course_subject cs ON cs.subject_id = sc.subject_id
           JOIN student s         ON s.curriculum_id = cs.curriculum_id
          WHERE sc.schedule_id = ? AND s.student_number = ?"
    );
    $st->execute([$scheduleId, $sn]);
    $subjectId = $st->fetchColumn();
    if ($subjectId === false) json_error('That section is not part of your program.');

    // semester offering: the subject must be open in the current semester
    if (!subject_offered_in($pdo, $subjectId, $current_sem)) json_error(not_offered_message($pdo, $subjectId, $current_sem));

    // year standing: the student's year level must reach the subject's minimum
    $st = $pdo->prepare("SELECT cs.min_year_standing, s.year_level FROM course_subject cs, student s
                          WHERE cs.subject_id = ? AND s.student_number = ?");
    $st->execute([$subjectId, $sn]);
    $stand = $st->fetch();
    if ($stand['min_year_standing'] !== null && (int) $stand['year_level'] < (int) $stand['min_year_standing']) {
        json_error('This subject needs ' . year_label($stand['min_year_standing']) . ' standing.');
    }

    $st = $pdo->prepare("SELECT 1 FROM academic_record WHERE student_number = ? AND subject_id = ? AND remark = 'PASSED'");
    $st->execute([$sn, $subjectId]);
    if ($st->fetchColumn()) json_error('You already passed this subject.');

    $codes = missing_prereq_codes($pdo, $sn, $subjectId);
    if ($codes) json_error('You still need to pass: ' . implode(', ', $codes) . '.');

    // first subject creates the Draft enrollment
    $id = find_enrollment($pdo, $sn, $current_ay, $current_sem);
    if (!$id) {
        $id = next_id($pdo, 'enrollment', 'enrollment_id');
        $pdo->prepare("INSERT INTO enrollment (enrollment_id, student_number, academic_year, semester, status, submitted_at, created_at)
                       VALUES (?, ?, ?, ?, 'Draft', NULL, ?)")
            ->execute([$id, $sn, $current_ay, $current_sem, now_str()]);
    }

    try {
        $pdo->beginTransaction();
        // remove an earlier section of the same subject, so choosing again just swaps it
        remove_enrolled_subject($pdo, $id, $subjectId);
        add_enrolled_subject($pdo, $id, $scheduleId, $subjectId);
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_error(db_message($e));
    }

    json_out(['ok' => true, 'enrollment' => enrollment_details($pdo, $id)]);
}

if ($action === 'remove') {
    $id = find_enrollment($pdo, $sn, $current_ay, $current_sem);
    if (!$id) json_error('You have no plan yet.');

    try {
        remove_enrolled_subject($pdo, $id, (int) ($b['subjectId'] ?? 0));
    } catch (PDOException $e) {
        json_error(db_message($e));
    }

    json_out(['ok' => true, 'enrollment' => enrollment_details($pdo, $id)]);
}

if ($action === 'submit') {
    $id = find_enrollment($pdo, $sn, $current_ay, $current_sem);
    if (!$id) json_error('Select at least one subject schedule before submitting.');

    // check the load, conflicts and corequisites first (submit_enrollment only checks slots)
    $d = enrollment_details($pdo, $id);
    if ((int) $d['units']['academic_units'] > $d['max_units']) {
        if ($d['can_overload']) json_error('Your load is over ' . $d['max_units'] . ' units. Upload an Overload form and wait for approval first.');
        json_error('Your load is over ' . $d['max_units'] . ' units, the most you can take this term.');
    }
    if ($d['conflicts']) {
        $c = $d['conflicts'][0];
        json_error('Schedule conflict: ' . $c['subject_a'] . ' and ' . $c['subject_b'] . ' overlap on ' . $c['day_of_week'] . '.');
    }
    if ($d['missing_corequisites']) {
        $c = $d['missing_corequisites'][0];
        json_error($c['course_code'] . ' must be taken together with ' . $c['missing_corequisite'] . '.');
    }

    // first year students must take the NSTP of the term: NSTP 1 in the 1st semester, NSTP 2 in the 2nd
    $st = $pdo->prepare("SELECT year_level FROM student WHERE student_number = ?");
    $st->execute([$sn]);
    if ((int) $st->fetchColumn() === 1 && in_array($current_sem, ['1st', '2nd'], true)) {
        $st = $pdo->prepare("SELECT cs.subject_id, cs.course_code
                                FROM student s
                                JOIN study_plan_term spt ON spt.curriculum_id = s.curriculum_id
                                JOIN study_plan sp       ON sp.term_id = spt.term_id
                                JOIN course_subject cs   ON cs.subject_id = sp.subject_id
                               WHERE s.student_number = ? AND spt.year_level = 1 AND spt.semester = ? AND cs.is_academic = 0");
        $st->execute([$sn, $current_sem]);
        $have = array_map('intval', array_column($d['subjects'], 'subject_id'));
        foreach ($st->fetchAll() as $n) {
            if (!in_array((int) $n['subject_id'], $have, true)) {
                json_error('First year students must take ' . str_replace('_', ' ', $n['course_code']) . ' this semester. Add it to your plan before submitting.');
            }
        }
    }

    try {
        submit_enrollment($pdo, $id);
    } catch (PDOException $e) {
        json_error(db_message($e));
    }

    json_out(['ok' => true, 'enrollment' => enrollment_details($pdo, $id)]);
}

json_error('Unknown action.');
