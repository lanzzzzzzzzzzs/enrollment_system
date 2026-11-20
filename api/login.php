<?php
// api/login.php  -  POST  { role: 'student' | 'admin', id, password }  ->  { ok, user }
// students are read from the student table, admins from the admin_user table
// on success the user is saved in the php session, the other api files check that session

require __DIR__ . '/config.php';
require __DIR__ . '/registration_lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use POST.', '', 405);

$b        = read_body();
$role     = ($b['role'] ?? '') === 'admin' ? 'admin' : 'student';
$id       = trim((string) ($b['id'] ?? ''));
$password = (string) ($b['password'] ?? '');
$bad      = 'That ID and password don’t match. Please try again.';
$suspended = 'This account is suspended. Contact the Registrar’s Office.';   // only shown after the password was right

if ($id === '' || $password === '') json_error('Enter your ID and password.');

if ($role === 'admin') {
    $st = $pdo->prepare("SELECT admin_id, last_name, first_name, password_hash, account_status FROM admin_user WHERE admin_id = ?");
    $st->execute([$id]);
    $row = $st->fetch();

    if (!$row || !password_verify($password, $row['password_hash'])) json_error($bad);
    if ($row['account_status'] !== 'Active') json_error($suspended);

    $user = [
        'role'     => 'admin',
        'id'       => $row['admin_id'],
        'fullName' => $row['first_name'] . ' ' . $row['last_name'],
        'initials' => initials_of($row['first_name'], $row['last_name']),
        'title'    => 'Admissions Officer',
    ];
    session_regenerate_id(true);
    $_SESSION['user'] = $user;
    json_out(['ok' => true, 'user' => $user]);
}

$st = $pdo->prepare(
    "SELECT s.student_number, s.last_name, s.first_name, s.middle_name, s.year_level,
            s.password_hash, s.account_status, c.curriculum_name
       FROM student s
       JOIN curriculum c ON c.curriculum_id = s.curriculum_id
      WHERE s.student_number = ?"
);
$st->execute([$id]);
$row = $st->fetch();

if (!$row) {
    // no account yet: the sign-up may still be waiting for an admin to check the checklist PDF (only said after the password was right)
    ensure_registration_table($pdo);
    $st = $pdo->prepare("SELECT password_hash, status, remarks FROM registration
                          WHERE student_number = ? AND status IN ('Pending', 'Rejected') ORDER BY CAST(registration_id AS UNSIGNED) DESC LIMIT 1");
    $st->execute([$id]);
    $reg = $st->fetch();
    if ($reg && password_verify($password, $reg['password_hash'])) {
        if ($reg['status'] === 'Pending') json_error('Your registration is waiting for admin approval. You can sign in once it is approved.');
        json_error('Your registration was not approved: ' . $reg['remarks'] . ' Please review your details and register again.');
    }
    json_error($bad);
}
if (!password_verify($password, $row['password_hash'])) json_error($bad);
if ($row['account_status'] !== 'Active') json_error($suspended);

$user = [
    'role'     => 'student',
    'id'       => $row['student_number'],
    'fullName' => trim($row['first_name'] . ' ' . ($row['middle_name'] ?? '') . ' ' . $row['last_name']),
    'initials' => initials_of($row['first_name'], $row['last_name']),
    'program'  => $row['curriculum_name'],
    'year'     => year_label($row['year_level']),
];
session_regenerate_id(true);
$_SESSION['user'] = $user;
json_out(['ok' => true, 'user' => $user]);
