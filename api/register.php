<?php
// api/register.php  -  POST (multipart)  { lastName, firstName, middleName, id, curriculumId, yearLevel, regStatus,
//                                          grades (json text), password, confirm, file (the checklist pdf) }
// grades = [ { code: 'CIST_101', grade: '1.25' }, ... ] read from the checklist PDF in the browser
// The account is NOT created here. The form, the grades and the PDF are saved as a Pending registration, and the
// student can sign in only after an admin has checked the PDF and approved it (admin_registrations.php).
// the password is saved with password_hash(), never as plain text

require __DIR__ . '/config.php';
require __DIR__ . '/registration_lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use POST.', '', 405);

$last       = trim(preg_replace('/\s+/', ' ', (string) ($_POST['lastName'] ?? '')));
$first      = trim(preg_replace('/\s+/', ' ', (string) ($_POST['firstName'] ?? '')));
$middle     = trim(preg_replace('/\s+/', ' ', (string) ($_POST['middleName'] ?? '')));
$id         = trim((string) ($_POST['id'] ?? ''));
$curriculum = (int) ($_POST['curriculumId'] ?? 0);
$year       = (int) ($_POST['yearLevel'] ?? 0);
$regStatus  = (string) ($_POST['regStatus'] ?? '');
$password   = (string) ($_POST['password'] ?? '');
$confirm    = (string) ($_POST['confirm'] ?? '');
$grades     = json_decode((string) ($_POST['grades'] ?? '[]'), true);
if (!is_array($grades)) $grades = [];

if ($last === '' || mb_strlen($last) > 60)       json_error('Enter your last name.', 'last');
if ($first === '' || mb_strlen($first) > 60)     json_error('Enter your first name.', 'first');
if (mb_strlen($middle) > 60)                     json_error('That middle name is too long.', 'middle');
if (!preg_match('/^[0-9]{4}-[0-9]{5}$/', $id))   json_error('Student ID must look like 2024-00001.', 'id');
if ($year < 1 || $year > 8)                      json_error('Choose your year level.', 'year');
if (!in_array($regStatus, ['Regular', 'Irregular'], true)) json_error('Choose Regular or Irregular.', 'status');
if ($regStatus === 'Regular' && $year > 4)       json_error('Regular students are up to 4th year. Choose Irregular for 5th year and up.', 'year');
if ($year !== 1 && count($grades) === 0)         json_error('Upload your curriculum checklist (PDF).', 'file');
if (strlen($password) < 8)                       json_error('Your password needs at least 8 characters.', 'password');
if ($password !== $confirm)                      json_error('The two passwords don’t match.', 'confirm');

// A first-year student has no previous grades, so the checklist is optional.
$name = '';
$stored = '';
if ($year !== 1) {
    if (empty($_FILES['file'])) json_error('Upload your curriculum checklist (PDF).', 'file');
    $f = $_FILES['file'];
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) json_error('The file is too big (5 MB at most).', 'file');
    if ($f['error'] !== UPLOAD_ERR_OK) json_error('The upload failed. Please try again.', 'file');
    if ($f['size'] > 5 * 1024 * 1024) json_error('The file is too big (5 MB at most).', 'file');

    $name = trim(preg_replace('/[\x00-\x1f\\\\\/]+/', '', (string) $f['name']));
    if (mb_strlen($name) > 200) $name = mb_substr($name, -200);
    if (!preg_match('/\.pdf$/i', $name)) json_error('Only PDF files are accepted.', 'file');
    $fh = fopen($f['tmp_name'], 'rb');
    $magic = $fh ? fread($fh, 5) : '';
    if ($fh) fclose($fh);
    if ($magic !== '%PDF-') json_error('That file is not a real PDF.', 'file');
}

$st = $pdo->prepare("SELECT 1 FROM curriculum WHERE curriculum_id = ? AND is_active = 1");
$st->execute([$curriculum]);
if (!$st->fetchColumn()) json_error('Choose your program.', 'program');

$st = $pdo->prepare("SELECT 1 FROM student WHERE student_number = ?");
$st->execute([$id]);
if ($st->fetchColumn()) json_error('That student ID already has an account. Try signing in instead.', 'id');

try {
    ensure_registration_table($pdo);
} catch (PDOException $e) {
    json_error('Could not prepare the registration table: ' . $e->getMessage(), '', 500);
}

$st = $pdo->prepare("SELECT 1 FROM registration WHERE student_number = ? AND status = 'Pending'");
$st->execute([$id]);
if ($st->fetchColumn()) json_error('That student ID is already registered and waiting for admin approval. You can sign in once it is approved.', 'id');

// none of the subjects in the file belong to the chosen program: tell the student now, not the admin later
$rows = registration_grade_rows($pdo, $curriculum, $id, $grades);
if ($year !== 1 && count($rows) === 0) json_error('None of the subjects in that file match the program you chose.', 'file');

// keep only what the admin needs to compare with the PDF
$clean = [];
foreach ($rows as $r) $clean[] = ['code' => $r[1], 'grade' => $r[5]];

if ($year !== 1) {
    $dir = registration_file_dir();
    if (!is_dir($dir)) json_error('The server cannot store files (uploads/registrations is missing).', '', 500);
    $stored = bin2hex(random_bytes(16)) . '.pdf';
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $stored)) json_error('The server could not save the file.', '', 500);
}

try {
    // an earlier rejected try with this ID is replaced by the new one
    $old = $pdo->prepare("SELECT registration_id, file_path FROM registration WHERE student_number = ? AND status = 'Rejected'");
    $old->execute([$id]);
    $oldRows = $old->fetchAll();

    $pdo->beginTransaction();
    foreach ($oldRows as $o) $pdo->prepare("DELETE FROM registration WHERE registration_id = ?")->execute([$o['registration_id']]);
    $pdo->prepare(
        "INSERT INTO registration (registration_id, student_number, curriculum_id, last_name, first_name, middle_name, year_level,
                                   registration_status, password_hash, grades_json, file_name, file_path, status, remarks, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NULL, ?)"
    )->execute([
        next_id($pdo, 'registration', 'registration_id'),
        $id, $curriculum, $last, $first, $middle === '' ? null : $middle, $year, $regStatus,
        password_hash($password, PASSWORD_DEFAULT), json_encode($clean), $name, $stored !== '' ? REGISTRATION_DIR . '/' . $stored : '',
        now_str(),
    ]);
    $pdo->commit();
    foreach ($oldRows as $o) @unlink(dirname(__DIR__) . '/' . $o['file_path']);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($stored !== '') @unlink($dir . '/' . $stored);
    json_error('Could not save the registration: ' . $e->getMessage(), '', 500);
}

$st = $pdo->prepare("SELECT curriculum_name FROM curriculum WHERE curriculum_id = ?");
$st->execute([$curriculum]);

json_out(['ok' => true, 'pending' => true, 'account' => [
    'id'        => $id,
    'firstName' => $first,
    'program'   => $st->fetchColumn(),
    'year'      => year_label($year),
    'regStatus' => $regStatus,
]]);
