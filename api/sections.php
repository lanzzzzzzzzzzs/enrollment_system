<?php
// api/sections.php  -  GET  [?subject_id=12]  ->  { ok, sections: [ ... ] }
// open sections (schedule rows) of the student's program for the current term, with the slots left

require __DIR__ . '/config.php';

$user = require_login('student');

$sql = "SELECT sc.schedule_id, sc.subject_id, cs.course_code, cs.course_title, cs.units,
               sc.block_section, sc.day_of_week,
               sc.start_time, sc.end_time,
               sc.room_or_mode, sc.max_slots, sc.held_slots,
               (CAST(sc.max_slots AS SIGNED) - CAST(sc.held_slots AS SIGNED)) AS available_slots,
               IF(CAST(sc.held_slots AS SIGNED) >= CAST(sc.max_slots AS SIGNED), 'Full', 'Open') AS slot_status
          FROM schedule sc
          JOIN course_subject cs ON cs.subject_id = sc.subject_id
          JOIN student s         ON s.curriculum_id = cs.curriculum_id
         WHERE s.student_number = ? AND sc.academic_year = ? AND sc.semester = ?
           AND sc.is_active = 1 AND cs.is_active = 1
           AND (NOT EXISTS (SELECT 1 FROM study_plan sp0 WHERE sp0.subject_id = cs.subject_id)
                OR sc.semester = 'Summer'
                OR EXISTS (SELECT 1 FROM study_plan sp1 JOIN study_plan_term t1 ON t1.term_id = sp1.term_id
                            WHERE sp1.subject_id = cs.subject_id AND t1.semester = sc.semester))";
$args = [$user['id'], $current_ay, $current_sem];

if (!empty($_GET['subject_id'])) {
    $sql   .= " AND sc.subject_id = ?";
    $args[] = (int) $_GET['subject_id'];
}

$st = $pdo->prepare($sql . " ORDER BY cs.course_code, sc.block_section, FIELD(sc.day_of_week, 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'), sc.start_time");
$st->execute($args);

json_out(['ok' => true, 'sections' => $st->fetchAll()]);
