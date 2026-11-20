<?php
// api/me.php  -  GET  ->  { ok, user }   who is signed in right now (401 when nobody is)

require __DIR__ . '/config.php';

if (empty($_SESSION['user'])) json_error('Not signed in.', '', 401);
check_account_active();

json_out(['ok' => true, 'user' => $_SESSION['user'], 'term' => ['academicYear' => $current_ay, 'semester' => $current_sem, 'enrollStart' => $enroll_start, 'enrollEnd' => $enroll_end]]);
