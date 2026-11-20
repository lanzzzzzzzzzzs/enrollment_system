<?php
// api/admin_students.php  (admin only)
//   GET  ->  { ok, students: [ ... ] }   every student with program, year level and the status of their enrollment for the current term
//   POST { action: 'suspend' | 'activate' | 'delete', studentId }
//        suspend  sets account_status = Inactive (the student can't sign in, a signed-in session ends on its next request)
//        delete   removes the student with the grades, plan and forms, and frees the held section slots

require __DIR__ . '/config.php';
require __DIR__ . '/registration_lib.php';

require_login('admin');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $b      = read_body();
    $action = (string) ($b['action'] ?? '');
    $sn     = trim((string) ($b['studentId'] ?? ''));

    $st = $pdo->prepare("SELECT 1 FROM student WHERE student_number = ?");
    $st->execute([$sn]);
    if (!$st->fetchColumn()) json_error('Student not found.', '', 404);

    if ($action === 'suspend' || $action === 'activate') {
        $pdo->prepare("UPDATE student SET account_status = ? WHERE student_number = ?")
            ->execute([$action === 'suspend' ? 'Inactive' : 'Active', $sn]);
        json_out(['ok' => true]);
    }

    if ($action === 'delete') {
        // the uploaded pdfs, removed from disk once the rows are gone
        $st = $pdo->prepare("SELECT lf.file_path FROM load_form lf JOIN enrollment e ON e.enrollment_id = lf.enrollment_id WHERE e.student_number = ?");
        $st->execute([$sn]);
        $files = $st->fetchAll(PDO::FETCH_COLUMN);

        // the checklist PDF they registered with goes too
        ensure_registration_table($pdo);
        $st = $pdo->prepare("SELECT file_path FROM registration WHERE student_number = ?");
        $st->execute([$sn]);
        $files = array_merge($files, $st->fetchAll(PDO::FETCH_COLUMN));

        try {
            $pdo->beginTransaction();
            // free the slots held by For Review / Enrolled plans
            $pdo->prepare("UPDATE schedule sc JOIN enrolled_subjects es ON es.schedule_id = sc.schedule_id
                             JOIN enrollment e ON e.enrollment_id = es.enrollment_id
                              SET sc.held_slots = sc.held_slots - 1
                            WHERE e.student_number = ? AND es.slot_held = 1")->execute([$sn]);
            $pdo->prepare("DELETE sl FROM status_log sl JOIN enrollment e ON e.enrollment_id = sl.enrollment_id WHERE e.student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE sl FROM status_log sl JOIN load_form lf ON lf.form_id = sl.form_id
                             JOIN enrollment e ON e.enrollment_id = lf.enrollment_id WHERE e.student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE lf FROM load_form lf JOIN enrollment e ON e.enrollment_id = lf.enrollment_id WHERE e.student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE es FROM enrolled_subjects es JOIN enrollment e ON e.enrollment_id = es.enrollment_id WHERE e.student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE FROM enrollment WHERE student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE FROM academic_record WHERE student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE FROM registration WHERE student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE FROM academic_record_archive WHERE student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE FROM student_shift_log WHERE student_number = ?")->execute([$sn]);
            $pdo->prepare("DELETE FROM student WHERE student_number = ?")->execute([$sn]);
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            json_error(db_message($e));
        }
        foreach ($files as $f) @unlink(dirname(__DIR__) . '/' . $f);
        json_out(['ok' => true]);
    }

    json_error('Unknown action.');
}

$st = $pdo->prepare(
    "SELECT s.student_number, s.last_name, s.first_name, s.middle_name, s.year_level, s.registration_status,
            s.account_status, c.curriculum_name, e.status AS enrollment_status, COALESCE(u.academic_units, 0) AS academic_units, COALESCE(u.nstp_units, 0) AS nstp_units,
            (SELECT COUNT(*) FROM enrolled_subjects es WHERE es.enrollment_id = e.enrollment_id) AS subject_count
       FROM student s
       JOIN curriculum c ON c.curriculum_id = s.curriculum_id
       LEFT JOIN enrollment e ON e.student_number = s.student_number AND e.academic_year = ? AND e.semester = ?
       LEFT JOIN " . sql_enrollment_units() . " u ON u.enrollment_id = e.enrollment_id
      ORDER BY s.created_at DESC, s.last_name, s.first_name"
);
$st->execute([$current_ay, $current_sem]);

$students = [];
foreach ($st->fetchAll() as $r) {
    $students[] = [
        'id'               => $r['student_number'],
        'name'             => trim($r['first_name'] . ' ' . ($r['middle_name'] ?? '') . ' ' . $r['last_name']),
        'initials'         => initials_of($r['first_name'], $r['last_name']),
        'program'          => $r['curriculum_name'],
        'year'             => year_label($r['year_level']),
        'standing'         => $r['registration_status'] === 'Regular' ? 'Regular' : 'Irregular',
        'accountStatus'    => $r['account_status'],
        'enrollmentStatus' => $r['enrollment_status'],          // null when no plan yet
        'academicUnits'    => $r['academic_units'] === null ? 0 : (int) $r['academic_units'],
        'subjectCount'     => (int) $r['subject_count'],
    ];
}

json_out(['ok' => true, 'students' => $students]);
