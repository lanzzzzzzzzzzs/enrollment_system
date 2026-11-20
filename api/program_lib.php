<?php
// api/program_lib.php  -  shared by admin_programs.php and admin_colleges.php (deleting a program, or a college with its programs)

// why a program can't be deleted right now (a sentence for the admin), or null when it can
function program_block_reason($pdo, $id)
{
    $st = $pdo->prepare("SELECT curriculum_name FROM curriculum WHERE curriculum_id = ?");
    $st->execute([$id]);
    $name = $st->fetchColumn();
    if ($name === false) return 'Program not found.';

    $st = $pdo->prepare("SELECT COUNT(*) FROM student WHERE curriculum_id = ?");
    $st->execute([$id]);
    $n = (int) $st->fetchColumn();
    if ($n > 0) {
        return $name . ' still has ' . $n . ' student' . ($n === 1 ? '' : 's') . '. Shift ' . ($n === 1 ? 'that student' : 'them') . ' to another program first, then delete it.';
    }

    $st = $pdo->prepare("SELECT (SELECT COUNT(*) FROM academic_record ar JOIN course_subject cs ON cs.subject_id = ar.subject_id WHERE cs.curriculum_id = ?)
                              + (SELECT COUNT(*) FROM enrolled_subjects es JOIN course_subject cs ON cs.subject_id = es.subject_id WHERE cs.curriculum_id = ?)");
    $st->execute([$id, $id]);
    if ((int) $st->fetchColumn() > 0) {
        return $name . ' has student grades or enrollment plans, so it can’t be deleted.';
    }
    return null;
}

// removes a program with its subjects, sections, study plan and prerequisites. Call inside a transaction.
function program_remove($pdo, $id)
{
    $subjects = "SELECT subject_id FROM course_subject WHERE curriculum_id = ?";
    // (a join, because MySQL won't let an UPDATE read the same table in a subquery)
    $pdo->prepare("UPDATE course_subject a JOIN course_subject b ON a.corequisite_subject_id = b.subject_id
                      SET a.corequisite_subject_id = NULL WHERE b.curriculum_id = ?")->execute([$id]);
    $pdo->prepare("DELETE FROM prerequisite WHERE subject_id IN ($subjects) OR prereq_subject_id IN ($subjects)")->execute([$id, $id]);
    $pdo->prepare("DELETE FROM subject_equivalency WHERE from_subject_id IN ($subjects) OR to_subject_id IN ($subjects)")->execute([$id, $id]);
    $pdo->prepare("DELETE FROM study_plan WHERE subject_id IN ($subjects)")->execute([$id]);
    $pdo->prepare("DELETE FROM schedule WHERE subject_id IN ($subjects)")->execute([$id]);
    $pdo->prepare("DELETE FROM course_subject WHERE curriculum_id = ?")->execute([$id]);
    $pdo->prepare("DELETE FROM study_plan_term WHERE curriculum_id = ?")->execute([$id]);
    $pdo->prepare("DELETE FROM curriculum WHERE curriculum_id = ?")->execute([$id]);
}
