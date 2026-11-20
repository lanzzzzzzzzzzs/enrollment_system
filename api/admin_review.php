<?php
// api/admin_review.php  (admin only)
//   GET  [?status=For Review|Enrolled|Rejected|all]  ->  { ok, counts, requests: [ ... ] }   default is For Review
//   GET  ?id=12                                      ->  { ok, student, enrollment }         one request in full
//   POST { id, decision: 'Enrolled' | 'Draft' | 'Rejected', remarks }
//        Draft sends the plan back to the student, remarks are required for Draft and Rejected
//   POST { id, action: 'delete' }   removes the enrollment request (plan, forms and log) and frees any held slots;
//                                   the student account stays
// the signed-in admin is saved in status_log by decide_enrollment() (rules_lib.php)

require __DIR__ . '/config.php';

$admin = require_login('admin');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    // one request in full
    if (!empty($_GET['id'])) {
        $d = enrollment_details($pdo, (int) $_GET['id']);
        if (!$d) json_error('Request not found.', '', 404);

        $st = $pdo->prepare(
            "SELECT s.student_number, s.last_name, s.first_name, s.middle_name, s.year_level, c.curriculum_name
               FROM student s JOIN curriculum c ON c.curriculum_id = s.curriculum_id
              WHERE s.student_number = ?"
        );
        $st->execute([$d['student_number']]);
        $student = $st->fetch();
        $student['year'] = year_label($student['year_level']);

        json_out(['ok' => true, 'student' => $student, 'enrollment' => $d]);
    }

    // the list
    $status = (string) ($_GET['status'] ?? 'For Review');
    $sql = "SELECT e.enrollment_id, e.student_number, CONCAT(st.last_name, ', ', st.first_name) AS student_name, st.first_name, st.last_name,
                   c.curriculum_name, st.year_level, e.academic_year, e.semester, e.status, e.submitted_at,
                   COALESCE(u.academic_units, 0) AS academic_units, COALESCE(u.nstp_units, 0) AS nstp_units
              FROM enrollment e
              JOIN student st ON st.student_number = e.student_number
              JOIN curriculum c ON c.curriculum_id = st.curriculum_id
              LEFT JOIN " . sql_enrollment_units() . " u ON u.enrollment_id = e.enrollment_id";
    $args = [];

    if ($status === 'all') {
        $sql .= " WHERE e.status <> 'Draft'";
    } elseif (in_array($status, ['For Review', 'Enrolled', 'Rejected', 'Draft'], true)) {
        $sql .= " WHERE e.status = ?";
        $args[] = $status;
    } else {
        json_error('Unknown status.');
    }

    $st = $pdo->prepare($sql . " ORDER BY e.submitted_at, CAST(e.enrollment_id AS UNSIGNED)");
    $st->execute($args);
    $requests = $st->fetchAll();

    // the chosen subjects, conflicts and remarks of each request, so the console can show them on the card
    foreach ($requests as &$r) {
        $r['details'] = enrollment_details($pdo, (int) $r['enrollment_id']);
        $r['year']    = year_label($r['year_level']);
    }
    unset($r);

    $counts = $pdo->query("SELECT status, COUNT(*) AS n FROM enrollment GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR);

    json_out(['ok' => true, 'counts' => $counts, 'requests' => $requests]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b       = read_body();
$id      = (int) ($b['id'] ?? 0);
$remarks = trim((string) ($b['remarks'] ?? ''));

if (($b['action'] ?? '') === 'delete') {
    $st = $pdo->prepare("SELECT 1 FROM enrollment WHERE enrollment_id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) json_error('That request no longer exists.', '', 404);

    $st = $pdo->prepare("SELECT file_path FROM load_form WHERE enrollment_id = ?");
    $st->execute([$id]);
    $files = $st->fetchAll(PDO::FETCH_COLUMN);

    try {
        $pdo->beginTransaction();
        // free the slots held by For Review / Enrolled plans
        $pdo->prepare("UPDATE schedule sc JOIN enrolled_subjects es ON es.schedule_id = sc.schedule_id
                          SET sc.held_slots = sc.held_slots - 1
                        WHERE es.enrollment_id = ? AND es.slot_held = 1")->execute([$id]);
        $pdo->prepare("DELETE FROM status_log WHERE enrollment_id = ?")->execute([$id]);
        $pdo->prepare("DELETE sl FROM status_log sl JOIN load_form lf ON lf.form_id = sl.form_id WHERE lf.enrollment_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM load_form WHERE enrollment_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM enrolled_subjects WHERE enrollment_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM enrollment WHERE enrollment_id = ?")->execute([$id]);
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_error(db_message($e));
    }
    foreach ($files as $f) @unlink(dirname(__DIR__) . '/' . $f);
    json_out(['ok' => true]);
}

try {
    decide_enrollment($pdo, $id, $admin['id'], (string) ($b['decision'] ?? ''), $remarks === '' ? null : $remarks);
} catch (PDOException $e) {
    json_error(db_message($e));
}

json_out(['ok' => true, 'enrollment' => enrollment_details($pdo, $id)]);
