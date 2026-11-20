<?php
// api/rules_lib.php  -  the rules that used to live inside the database (triggers, stored procedures and the
// bigger views). INFO_MAN_DB.sql now only has plain tables, so PHP does this work instead:
//   - next_id()                       every id is typed in, there is no auto numbering
//   - add_enrolled_subject() ...      the old enrolled_subjects triggers
//   - add_prerequisite()              sp_add_prerequisite (same curriculum + no circular chains)
//   - add_grade()                     sp_add_grade
//   - submit_enrollment()             sp_submit_enrollment
//   - decide_enrollment()             sp_admin_decide_enrollment
//   - decide_form()                   sp_admin_decide_form
//   - missing_prereqs(), enrollment_units(), schedule_conflicts(), missing_corequisites(), student_gwa(),
//     checklist_rows()                the old views v_missing_prerequisites, v_enrollment_units, v_schedule_conflicts,
//                                     v_missing_corequisites, v_student_gwa, v_curriculum_checklist (with grades)
// A broken rule throws a RuleError. It is a PDOException on purpose, so the "catch (PDOException $e)" blocks in
// the api files show its message exactly like they showed the old trigger messages.

class RuleError extends PDOException
{
    public function __construct($message)
    {
        parent::__construct($message);
        $this->errorInfo = ['45000', 0, $message];
    }
}

function rule_fail($message)
{
    throw new RuleError($message);
}

// the current date and time as text (the tables keep dates in VARCHAR columns)
function now_str()
{
    return date('Y-m-d H:i:s');
}

// the next id of a table: the biggest number in the column plus one. $table and $col are written in our own code,
// never taken from the browser.
function next_id($pdo, $table, $col)
{
    return (string) ((int) $pdo->query("SELECT COALESCE(MAX(CAST($col AS UNSIGNED)), 0) + 1 FROM $table")->fetchColumn());
}

// PASSED / FAILED / INC / DO from the grade (academic_record.remark is typed in, not generated)
function grade_remark($grade)
{
    if (in_array($grade, ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00'], true)) return 'PASSED';
    if ($grade === '5.00') return 'FAILED';
    if ($grade === 'INC') return 'INC';
    return 'DO';
}

// ---------------------------------------------------------------------------------------------------------------------
// the old views
// ---------------------------------------------------------------------------------------------------------------------

// the prerequisites a student has not passed yet: [ { subject_id, prereq_subject_id, missing_prereq_code } ]
// $subjectId limits it to one subject
function missing_prereq_rows($pdo, $sn, $subjectId = null)
{
    $sql = "SELECT p.subject_id, p.prereq_subject_id, pre.course_code AS missing_prereq_code
              FROM student st
              JOIN course_subject cs  ON cs.curriculum_id = st.curriculum_id
              JOIN prerequisite p     ON p.subject_id = cs.subject_id
              JOIN course_subject pre ON pre.subject_id = p.prereq_subject_id
             WHERE st.student_number = ?
               AND NOT EXISTS (SELECT 1 FROM academic_record ar
                                WHERE ar.student_number = st.student_number
                                  AND ar.subject_id = p.prereq_subject_id AND ar.remark = 'PASSED')";
    $args = [$sn];
    if ($subjectId !== null) {
        $sql   .= " AND p.subject_id = ?";
        $args[] = $subjectId;
    }
    $st = $pdo->prepare($sql . " ORDER BY pre.course_code");
    $st->execute($args);
    return $st->fetchAll();
}

// the plain list of missing prerequisite codes of one subject
function missing_prereq_codes($pdo, $sn, $subjectId)
{
    return array_column(missing_prereq_rows($pdo, $sn, $subjectId), 'missing_prereq_code');
}

// { academic_units, nstp_units } of one enrollment (plain numbers)
function enrollment_units($pdo, $enrollmentId)
{
    $st = $pdo->prepare(
        "SELECT COALESCE(SUM(CASE WHEN cs.is_academic = '1' THEN CAST(cs.units AS UNSIGNED) ELSE 0 END), 0) AS academic_units,
                COALESCE(SUM(CASE WHEN cs.is_academic = '0' THEN CAST(cs.units AS UNSIGNED) ELSE 0 END), 0) AS nstp_units
           FROM enrolled_subjects es
           JOIN course_subject cs ON cs.subject_id = es.subject_id
          WHERE es.enrollment_id = ?"
    );
    $st->execute([$enrollmentId]);
    $u = $st->fetch();
    return ['academic_units' => (int) $u['academic_units'], 'nstp_units' => (int) $u['nstp_units']];
}

// the same totals for every enrollment at once, as a table that can be joined:  LEFT JOIN <this> u ON u.enrollment_id = e.enrollment_id
// (an enrollment with no subjects has no row here, so select COALESCE(u.academic_units, 0))
function sql_enrollment_units()
{
    return "(SELECT es.enrollment_id,
                    SUM(CASE WHEN cs.is_academic = '1' THEN CAST(cs.units AS UNSIGNED) ELSE 0 END) AS academic_units,
                    SUM(CASE WHEN cs.is_academic = '0' THEN CAST(cs.units AS UNSIGNED) ELSE 0 END) AS nstp_units
               FROM enrolled_subjects es
               JOIN course_subject cs ON cs.subject_id = es.subject_id
              GROUP BY es.enrollment_id)";
}

// subjects of one enrollment that overlap on the same day. Back to back (end = start) is allowed.
function schedule_conflicts($pdo, $enrollmentId)
{
    $st = $pdo->prepare(
        "SELECT ca.course_code AS subject_a, cb.course_code AS subject_b, sa.day_of_week,
                sa.start_time AS a_start, sa.end_time AS a_end, sb.start_time AS b_start, sb.end_time AS b_end
           FROM enrolled_subjects a
           JOIN enrolled_subjects b ON b.enrollment_id = a.enrollment_id
                                   AND CAST(a.enrolled_subject_id AS UNSIGNED) < CAST(b.enrolled_subject_id AS UNSIGNED)
           JOIN schedule sa ON sa.schedule_id = a.schedule_id
           JOIN schedule sb ON sb.schedule_id = b.schedule_id AND sb.day_of_week = sa.day_of_week
           JOIN course_subject ca ON ca.subject_id = a.subject_id
           JOIN course_subject cb ON cb.subject_id = b.subject_id
          WHERE a.enrollment_id = ? AND sa.start_time < sb.end_time AND sb.start_time < sa.end_time"
    );
    $st->execute([$enrollmentId]);
    return $st->fetchAll();
}

// labs in the plan whose lecture is neither in the plan nor already passed
function missing_corequisites($pdo, $enrollmentId)
{
    $st = $pdo->prepare(
        "SELECT cs.course_code, co.course_code AS missing_corequisite
           FROM enrolled_subjects es
           JOIN enrollment e      ON e.enrollment_id = es.enrollment_id
           JOIN course_subject cs ON cs.subject_id = es.subject_id
           JOIN course_subject co ON co.subject_id = cs.corequisite_subject_id
          WHERE es.enrollment_id = ?
            AND NOT EXISTS (SELECT 1 FROM enrolled_subjects x
                             WHERE x.enrollment_id = es.enrollment_id AND x.subject_id = co.subject_id)
            AND NOT EXISTS (SELECT 1 FROM academic_record ar
                             WHERE ar.student_number = e.student_number AND ar.subject_id = co.subject_id AND ar.remark = 'PASSED')"
    );
    $st->execute([$enrollmentId]);
    return $st->fetchAll();
}

// gwa: academic subjects only, PASSED grades, latest attempt. null when there is nothing to average yet.
function student_gwa($pdo, $sn)
{
    $st = $pdo->prepare(
        "SELECT ROUND(SUM(CAST(ar.final_grade AS DECIMAL(3,2)) * CAST(cs.units AS UNSIGNED)) / SUM(CAST(cs.units AS UNSIGNED)), 4)
           FROM academic_record ar
           JOIN course_subject cs ON cs.subject_id = ar.subject_id AND cs.is_academic = '1'
          WHERE ar.student_number = ? AND ar.remark = 'PASSED'
            AND CAST(ar.attempt_no AS UNSIGNED) = (SELECT MAX(CAST(a2.attempt_no AS UNSIGNED)) FROM academic_record a2
                                                    WHERE a2.student_number = ar.student_number AND a2.subject_id = ar.subject_id)"
    );
    $st->execute([$sn]);
    $g = $st->fetchColumn();
    return ($g === false || $g === null) ? null : (float) $g;
}

// every subject of the student's study plan with the latest grade (grade and remark are null when there is no record)
function checklist_rows($pdo, $sn)
{
    $st = $pdo->prepare(
        "SELECT spt.year_level, spt.semester, cs.subject_id, cs.course_code, cs.course_title, cs.units, cs.is_academic,
                ar.final_grade, ar.remark, ar.academic_year
           FROM student st
           JOIN study_plan_term spt ON spt.curriculum_id = st.curriculum_id
           JOIN study_plan sp       ON sp.term_id = spt.term_id
           JOIN course_subject cs   ON cs.subject_id = sp.subject_id
           LEFT JOIN academic_record ar ON ar.student_number = st.student_number AND ar.subject_id = cs.subject_id
                AND CAST(ar.attempt_no AS UNSIGNED) = (SELECT MAX(CAST(a2.attempt_no AS UNSIGNED)) FROM academic_record a2
                                                        WHERE a2.student_number = st.student_number AND a2.subject_id = cs.subject_id)
          WHERE st.student_number = ?
          ORDER BY CAST(spt.year_level AS UNSIGNED), FIELD(spt.semester, '1st', '2nd', 'Summer'), cs.course_code"
    );
    $st->execute([$sn]);
    return $st->fetchAll();
}

// ---------------------------------------------------------------------------------------------------------------------
// semester offering: a subject only opens in the semester it sits in on the study plan (e.g. BSIT_111 is 1st year,
// 2nd semester only). A subject that is not on any study plan has no restriction.
// ---------------------------------------------------------------------------------------------------------------------

// the semesters a subject is offered in, as a list like ['2nd'] (empty = not on a study plan, so no restriction)
function subject_offered_semesters($pdo, $subjectId)
{
    $st = $pdo->prepare("SELECT DISTINCT t.semester FROM study_plan sp JOIN study_plan_term t ON t.term_id = sp.term_id WHERE sp.subject_id = ?");
    $st->execute([$subjectId]);
    return $st->fetchAll(PDO::FETCH_COLUMN);
}

// is the subject open in this semester ('1st' | '2nd' | 'Summer')? Summer is open for every subject.
function subject_offered_in($pdo, $subjectId, $sem)
{
    if ($sem === 'Summer') return true;                  // Summer is not on the study plan: any subject can be opened (retakes, catch up)
    $sems = subject_offered_semesters($pdo, $subjectId);
    return !$sems || in_array($sem, $sems, true);
}

// the next school year text: 2026-2027 -> 2027-2028
function next_academic_year($ay)
{
    $y = (int) substr($ay, 0, 4) + 1;
    return $y . '-' . ($y + 1);
}

// the soonest term (current or upcoming) of a semester: the same school year when the semester is the current one or still
// to come, the next school year when it already passed. Returns [ 'ay' => '2026-2027', 'sem' => '2nd' ]
function upcoming_term($sem, $curAy, $curSem)
{
    $rank = ['1st' => 1, '2nd' => 2, 'Summer' => 3];
    $ay   = (($rank[$sem] ?? 0) >= ($rank[$curSem] ?? 0)) ? $curAy : next_academic_year($curAy);
    return ['ay' => $ay, 'sem' => $sem];
}

// where new sections of a subject go when the admin does not pick a term: the subject's own semester on the study plan
// (current school year, or the next one if that semester already passed). No study plan spot = the current term.
function offered_term($pdo, $subjectId, $curAy, $curSem)
{
    $sems = subject_offered_semesters($pdo, $subjectId);
    if (!$sems || $curSem === 'Summer' || in_array($curSem, $sems, true)) return ['ay' => $curAy, 'sem' => $curSem];
    return upcoming_term($sems[0], $curAy, $curSem);
}

// "1st" -> "1st semester", "Summer" -> "Summer term"
function semester_text($sem)
{
    return $sem === 'Summer' ? 'Summer term' : $sem . ' semester';
}

// the message shown when a subject is not open in $sem
function not_offered_message($pdo, $subjectId, $sem)
{
    $sems = array_map('semester_text', subject_offered_semesters($pdo, $subjectId));
    return 'This subject is only offered in the ' . implode(' / ', $sems) . ', not in the ' . semester_text($sem) . '.';
}

// ---------------------------------------------------------------------------------------------------------------------
// status log
// ---------------------------------------------------------------------------------------------------------------------

function log_status($pdo, $entityType, $enrollmentId, $formId, $old, $new, $adminId, $remarks)
{
    $pdo->prepare(
        "INSERT INTO status_log (log_id, entity_type, enrollment_id, form_id, old_status, new_status, admin_id, changed_at, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )->execute([next_id($pdo, 'status_log', 'log_id'), $entityType, $enrollmentId, $formId, $old, $new, $adminId, now_str(), $remarks]);
}

// ---------------------------------------------------------------------------------------------------------------------
// plan editing (the old enrolled_subjects triggers)
// ---------------------------------------------------------------------------------------------------------------------

// subjects can only be added while the plan is Draft; the section must be active, in the plan's term and not full
function add_enrolled_subject($pdo, $enrollmentId, $scheduleId, $subjectId)
{
    $st = $pdo->prepare("SELECT status, academic_year, semester FROM enrollment WHERE enrollment_id = ?");
    $st->execute([$enrollmentId]);
    $e = $st->fetch();
    if (!$e || $e['status'] !== 'Draft') rule_fail('Plan is locked: only Draft plans can be edited');

    $st = $pdo->prepare("SELECT academic_year, semester, (CAST(held_slots AS SIGNED) >= CAST(max_slots AS SIGNED)) AS is_full
                           FROM schedule WHERE schedule_id = ? AND is_active = '1'");
    $st->execute([$scheduleId]);
    $s = $st->fetch();
    if (!$s) rule_fail('Section is inactive or does not exist');
    if ($s['academic_year'] !== $e['academic_year'] || $s['semester'] !== $e['semester']) rule_fail('Section is not offered in the enrollment term');
    if ((int) $s['is_full'] === 1) rule_fail('Section is Full');
    if (!subject_offered_in($pdo, $subjectId, $e['semester'])) rule_fail(not_offered_message($pdo, $subjectId, $e['semester']));

    // the same section twice in one plan
    $st = $pdo->prepare("SELECT 1 FROM enrolled_subjects WHERE enrollment_id = ? AND (schedule_id = ? OR subject_id = ?)");
    $st->execute([$enrollmentId, $scheduleId, $subjectId]);
    if ($st->fetchColumn()) rule_fail('That subject is already in your plan');

    // no slot is held while Draft (slot_held = 0)
    $pdo->prepare("INSERT INTO enrolled_subjects (enrolled_subject_id, enrollment_id, schedule_id, subject_id, slot_held, added_at)
                   VALUES (?, ?, ?, ?, '0', ?)")
        ->execute([next_id($pdo, 'enrolled_subjects', 'enrolled_subject_id'), $enrollmentId, $scheduleId, $subjectId, now_str()]);
}

// only Draft plans can lose subjects
function remove_enrolled_subject($pdo, $enrollmentId, $subjectId)
{
    $st = $pdo->prepare("SELECT status FROM enrollment WHERE enrollment_id = ?");
    $st->execute([$enrollmentId]);
    $status = $st->fetchColumn();
    if ($status === false || $status !== 'Draft') rule_fail('Plan is locked: only Draft plans can be edited');

    $pdo->prepare("DELETE FROM enrolled_subjects WHERE enrollment_id = ? AND subject_id = ?")->execute([$enrollmentId, $subjectId]);
}

// a section with held or enrolled students can't be deleted (set it inactive instead)
function check_schedule_deletable($pdo, $scheduleId)
{
    $st = $pdo->prepare("SELECT held_slots FROM schedule WHERE schedule_id = ?");
    $st->execute([$scheduleId]);
    $held = $st->fetchColumn();
    if ($held === false) return;

    $st = $pdo->prepare("SELECT COUNT(*) FROM enrolled_subjects WHERE schedule_id = ?");
    $st->execute([$scheduleId]);
    if ((int) $held > 0 || (int) $st->fetchColumn() > 0) rule_fail('Section has held or enrolled students: set it inactive instead');
}

// is there already a section with the same subject, term, block, day and start time (ignoring $ignoreId)?
function schedule_exists($pdo, $subjectId, $ay, $sem, $block, $day, $start, $ignoreId = 0)
{
    $st = $pdo->prepare("SELECT 1 FROM schedule WHERE subject_id = ? AND academic_year = ? AND semester = ? AND block_section = ?
                            AND day_of_week = ? AND start_time = ? AND schedule_id <> ?");
    $st->execute([$subjectId, $ay, $sem, $block, $day, $start, $ignoreId]);
    return (bool) $st->fetchColumn();
}

// ---------------------------------------------------------------------------------------------------------------------
// prerequisites (sp_add_prerequisite)
// ---------------------------------------------------------------------------------------------------------------------

// adds "subject needs prereq": both must be in the same curriculum and the chain must not go in a circle
function add_prerequisite($pdo, $subjectId, $prereqId)
{
    $subjectId = (string) $subjectId;
    $prereqId  = (string) $prereqId;
    if ($subjectId === $prereqId) rule_fail('Circular prerequisite detected');

    $st = $pdo->prepare("SELECT curriculum_id FROM course_subject WHERE subject_id = ?");
    $st->execute([$subjectId]);
    $a = $st->fetchColumn();
    $st->execute([$prereqId]);
    $b = $st->fetchColumn();
    if ($a === false || $b === false || (string) $a !== (string) $b) rule_fail('Prerequisite must be in the same curriculum');

    // everything the new prerequisite already depends on; if it reaches the subject, it would be a circle
    $deps = [];
    foreach ($pdo->query("SELECT subject_id, prereq_subject_id FROM prerequisite")->fetchAll() as $r) {
        $deps[(string) $r['subject_id']][] = (string) $r['prereq_subject_id'];
    }
    $seen  = [];
    $stack = [$prereqId];
    while ($stack) {
        $x = array_pop($stack);
        foreach ($deps[$x] ?? [] as $d) {
            if ($d === $subjectId) rule_fail('Circular prerequisite detected');
            if (!isset($seen[$d])) { $seen[$d] = true; $stack[] = $d; }
        }
    }

    $st = $pdo->prepare("SELECT 1 FROM prerequisite WHERE subject_id = ? AND prereq_subject_id = ?");
    $st->execute([$subjectId, $prereqId]);
    if ($st->fetchColumn()) return;                                    // already there

    $pdo->prepare("INSERT INTO prerequisite (subject_id, prereq_subject_id) VALUES (?, ?)")->execute([$subjectId, $prereqId]);
}

// ---------------------------------------------------------------------------------------------------------------------
// grades (sp_add_grade)
// ---------------------------------------------------------------------------------------------------------------------

// saves a grade as a new attempt (retakes keep the earlier rows); the remark comes from the grade
function add_grade($pdo, $sn, $subjectId, $ay, $sem, $grade, $adminId, $attempt = null)
{
    if ($attempt === null) {
        $st = $pdo->prepare("SELECT COALESCE(MAX(CAST(attempt_no AS UNSIGNED)), 0) + 1 FROM academic_record WHERE student_number = ? AND subject_id = ?");
        $st->execute([$sn, $subjectId]);
        $attempt = (int) $st->fetchColumn();
    }
    $pdo->prepare(
        "INSERT INTO academic_record (record_id, student_number, subject_id, academic_year, semester, attempt_no, final_grade, remark, encoded_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )->execute([next_id($pdo, 'academic_record', 'record_id'), $sn, $subjectId, $ay, $sem, (string) $attempt, $grade, grade_remark($grade), $adminId, now_str()]);
}

// ---------------------------------------------------------------------------------------------------------------------
// enrollment decisions (sp_submit_enrollment, sp_admin_decide_enrollment, sp_admin_decide_form)
// ---------------------------------------------------------------------------------------------------------------------

// student submits: Draft -> For Review, one slot held per selected section
function submit_enrollment($pdo, $id)
{
    try {
        $pdo->beginTransaction();

        $st = $pdo->prepare("SELECT status FROM enrollment WHERE enrollment_id = ? FOR UPDATE");
        $st->execute([$id]);
        $status = $st->fetchColumn();
        if ($status === false || $status !== 'Draft') rule_fail('Only a Draft plan can be submitted');

        $st = $pdo->prepare("SELECT COUNT(*) FROM enrolled_subjects WHERE enrollment_id = ?");
        $st->execute([$id]);
        if ((int) $st->fetchColumn() === 0) rule_fail('Select at least one subject schedule before submitting');

        // lock the sections and make sure none filled up meanwhile
        $st = $pdo->prepare("SELECT COUNT(*) FROM schedule s JOIN enrolled_subjects es ON es.schedule_id = s.schedule_id
                              WHERE es.enrollment_id = ? AND CAST(s.held_slots AS SIGNED) >= CAST(s.max_slots AS SIGNED) FOR UPDATE");
        $st->execute([$id]);
        if ((int) $st->fetchColumn() > 0) rule_fail('A selected section is now Full');

        $pdo->prepare("UPDATE schedule SET held_slots = held_slots + 1
                        WHERE schedule_id IN (SELECT schedule_id FROM enrolled_subjects WHERE enrollment_id = ?)")->execute([$id]);
        $pdo->prepare("UPDATE enrolled_subjects SET slot_held = '1' WHERE enrollment_id = ?")->execute([$id]);
        $pdo->prepare("UPDATE enrollment SET status = 'For Review', submitted_at = ? WHERE enrollment_id = ?")->execute([now_str(), $id]);
        log_status($pdo, 'ENROLLMENT', $id, null, 'Draft', 'For Review', null, null);

        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// admin decision: $decision = 'Enrolled' | 'Draft' (return to the student) | 'Rejected'
function decide_enrollment($pdo, $id, $adminId, $decision, $remarks)
{
    if (!in_array($decision, ['Enrolled', 'Draft', 'Rejected'], true)) rule_fail('Decision must be Enrolled, Draft or Rejected');

    try {
        $pdo->beginTransaction();

        $st = $pdo->prepare("SELECT status FROM enrollment WHERE enrollment_id = ? FOR UPDATE");
        $st->execute([$id]);
        $status = $st->fetchColumn();
        if ($status === false || $status !== 'For Review') rule_fail('Only requests in For Review can be decided');
        if (in_array($decision, ['Draft', 'Rejected'], true) && trim((string) $remarks) === '') rule_fail('Remarks are required when returning or rejecting');

        $st = $pdo->prepare("SELECT COUNT(*) FROM admin_user WHERE admin_id = ? AND account_status = 'Active'");
        $st->execute([$adminId]);
        if ((int) $st->fetchColumn() === 0) rule_fail('Unknown or inactive administrator');

        if ($decision !== 'Enrolled') {                    // release the held slots (Enrolled keeps them)
            $pdo->prepare("UPDATE schedule SET held_slots = held_slots - 1
                            WHERE schedule_id IN (SELECT schedule_id FROM enrolled_subjects WHERE enrollment_id = ? AND slot_held = '1')")->execute([$id]);
            $pdo->prepare("UPDATE enrolled_subjects SET slot_held = '0' WHERE enrollment_id = ?")->execute([$id]);
        }

        $pdo->prepare("UPDATE enrollment SET status = ? WHERE enrollment_id = ?")->execute([$decision, $id]);
        log_status($pdo, 'ENROLLMENT', $id, null, 'For Review', $decision, $adminId, $remarks);

        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// admin decision on an overload / underload form: 'Approved' | 'Rejected'
function decide_form($pdo, $formId, $adminId, $decision, $remarks)
{
    if (!in_array($decision, ['Approved', 'Rejected'], true)) rule_fail('Decision must be Approved or Rejected');

    try {
        $pdo->beginTransaction();

        $st = $pdo->prepare("SELECT status FROM load_form WHERE form_id = ? FOR UPDATE");
        $st->execute([$formId]);
        $status = $st->fetchColumn();
        if ($status === false || $status !== 'Pending') rule_fail('Only Pending forms can be decided');

        $pdo->prepare("UPDATE load_form SET status = ? WHERE form_id = ?")->execute([$decision, $formId]);
        log_status($pdo, 'LOAD_FORM', null, $formId, 'Pending', $decision, $adminId, $remarks);

        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}
