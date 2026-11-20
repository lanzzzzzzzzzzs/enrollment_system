<?php
// api/admin_forms.php  (admin only)  -  overload / underload forms
//   GET  [?status=Pending|Approved|Rejected|all]  ->  { ok, forms: [ ... ] }      default is all, Pending first
//   GET  ?download=12                              ->  the pdf itself (shown in the browser)
//   POST { formId, decision: 'Approved' | 'Rejected', remarks }   remarks are required for Rejected
// the decision and the admin are saved in status_log by decide_form() (rules_lib.php)

require __DIR__ . '/config.php';

$admin = require_login('admin');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    if (!empty($_GET['download'])) {
        $st = $pdo->prepare("SELECT file_name, file_path FROM load_form WHERE form_id = ?");
        $st->execute([(int) $_GET['download']]);
        $f = $st->fetch();
        $full = $f ? dirname(__DIR__) . '/' . $f['file_path'] : '';
        if (!$f || !is_file($full)) { http_response_code(404); header('Content-Type: text/plain'); echo 'File not found.'; exit; }

        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]+/', '_', $f['file_name']) . '"');
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($full));
        readfile($full);
        exit;
    }

    $status = (string) ($_GET['status'] ?? 'all');
    $sql = "SELECT lf.form_id, lf.form_type, lf.file_name, lf.status, lf.uploaded_at, e.enrollment_id, e.status AS enrollment_status,
                   e.student_number, CONCAT(s.first_name, ' ', s.last_name) AS student_name, s.year_level, c.curriculum_name,
                   COALESCE(u.academic_units, 0) AS academic_units,
                   (SELECT sl.remarks FROM status_log sl WHERE sl.entity_type = 'LOAD_FORM' AND sl.form_id = lf.form_id
                     ORDER BY CAST(sl.log_id AS UNSIGNED) DESC LIMIT 1) AS remarks
              FROM load_form lf
              JOIN enrollment e ON e.enrollment_id = lf.enrollment_id
              JOIN student s    ON s.student_number = e.student_number
              JOIN curriculum c ON c.curriculum_id = s.curriculum_id
              LEFT JOIN " . sql_enrollment_units() . " u ON u.enrollment_id = e.enrollment_id";
    $args = [];
    if (in_array($status, ['Pending', 'Approved', 'Rejected'], true)) { $sql .= " WHERE lf.status = ?"; $args[] = $status; }

    $st = $pdo->prepare($sql . " ORDER BY FIELD(lf.status, 'Pending', 'Approved', 'Rejected'), lf.uploaded_at DESC");
    $st->execute($args);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) $r['year'] = year_label($r['year_level']);
    unset($r);

    json_out(['ok' => true, 'forms' => $rows]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b        = read_body();
$decision = (string) ($b['decision'] ?? '');
$remarks  = trim((string) ($b['remarks'] ?? ''));
if ($decision === 'Rejected' && $remarks === '') json_error('Add a remark so the student knows why.', 'remarks');

try {
    decide_form($pdo, (int) ($b['formId'] ?? 0), $admin['id'], $decision, $remarks === '' ? null : $remarks);
} catch (PDOException $e) {
    json_error(db_message($e));
}

json_out(['ok' => true]);
