<?php
// api/load_forms.php  (student, current term)  -  overload / underload PDF forms
//   POST multipart { action: 'upload', formType: 'Overload' | 'Underload', file: <pdf> }
//   POST json      { action: 'remove', formId }        only Pending forms of a Draft plan
//   -> { ok, enrollment }
// the pdf is saved in uploads/forms/ under a random name (the folder is closed to the web, admins download it through admin_forms.php)
// a Pending form blocks "Submit for review" until an admin decides it

require __DIR__ . '/config.php';

$user = require_login('student');
$sn   = $user['id'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use POST.', '', 405);

$st = $pdo->prepare("SELECT enrollment_id, status FROM enrollment WHERE student_number = ? AND academic_year = ? AND semester = ?");
$st->execute([$sn, $current_ay, $current_sem]);
$enr = $st->fetch();
if (!$enr) json_error('Add at least one subject to your plan before uploading a load form.');
if (!in_array($enr['status'], ['Draft', 'For Review'], true)) {
    json_error('Your plan is locked, so load forms can’t be changed.');
}
$id = (int) $enr['enrollment_id'];

$dir = dirname(__DIR__) . '/uploads/forms';

// ---- upload ----
if (!empty($_FILES['file'])) {
    $type = (string) ($_POST['formType'] ?? '');
    if (!in_array($type, ['Overload', 'Underload'], true)) json_error('Choose Overload or Underload.', 'type');
    if ($type === 'Overload' && !student_unit_rules($pdo, $sn, $current_sem)['canOverload']) {
        json_error('Overloading is only for irregular students in 5th year and up.', 'type');
    }

    $f = $_FILES['file'];
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) json_error('The file is too big (5 MB at most).', 'file');
    if ($f['error'] !== UPLOAD_ERR_OK)  json_error('The upload failed. Please try again.', 'file');
    if ($f['size'] > 5 * 1024 * 1024)   json_error('The file is too big (5 MB at most).', 'file');

    $name = trim(preg_replace('/[\x00-\x1f\\\\\/]+/', '', (string) $f['name']));
    if (mb_strlen($name) > 200) $name = mb_substr($name, -200);
    if (!preg_match('/\.pdf$/i', $name)) json_error('Only PDF files are accepted.', 'file');

    $fh = fopen($f['tmp_name'], 'rb');
    $magic = $fh ? fread($fh, 5) : '';
    if ($fh) fclose($fh);
    if ($magic !== '%PDF-') json_error('That file is not a real PDF.', 'file');

    $st = $pdo->prepare("SELECT 1 FROM load_form WHERE enrollment_id = ? AND form_type = ? AND status IN ('Pending', 'Approved')");
    $st->execute([$id, $type]);
    if ($st->fetchColumn()) json_error('You already have a ' . $type . ' form that is pending or approved.');

    if (!is_dir($dir) && !mkdir($dir, 0775, true)) json_error('The server cannot store files (uploads/forms is missing).', '', 500);
    $stored = bin2hex(random_bytes(16)) . '.pdf';
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $stored)) json_error('The server could not save the file.', '', 500);

    try {
        $pdo->prepare("INSERT INTO load_form (form_id, enrollment_id, form_type, file_name, file_path, status, uploaded_at)
                       VALUES (?, ?, ?, ?, ?, 'Pending', ?)")
            ->execute([next_id($pdo, 'load_form', 'form_id'), $id, $type, $name, 'uploads/forms/' . $stored, now_str()]);
    } catch (PDOException $e) {
        @unlink($dir . '/' . $stored);
        json_error(db_message($e));
    }
    json_out(['ok' => true, 'enrollment' => enrollment_details($pdo, $id)]);
}

// ---- remove ----
$b = read_body();
if (($b['action'] ?? '') === 'remove') {
    $st = $pdo->prepare("SELECT file_path FROM load_form WHERE form_id = ? AND enrollment_id = ? AND status = 'Pending'");
    $st->execute([(int) ($b['formId'] ?? 0), $id]);
    $path = $st->fetchColumn();
    if ($path === false) json_error('Only a pending form can be removed.');

    try {
        $pdo->prepare("DELETE FROM load_form WHERE form_id = ?")->execute([(int) $b['formId']]);
    } catch (PDOException $e) {
        json_error(db_message($e));
    }
    @unlink(dirname(__DIR__) . '/' . $path);
    json_out(['ok' => true, 'enrollment' => enrollment_details($pdo, $id)]);
}

json_error('Choose a PDF file to upload.');
