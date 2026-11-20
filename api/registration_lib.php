<?php
// api/registration_lib.php  -  shared by register.php, login.php, admin_registrations.php and admin_students.php
// A new student does not get an account straight away: sign-up saves a row in the registration table with the
// checklist PDF, and the account (student row + grades) is only created when an admin approves it.

const REGISTRATION_DIR = 'uploads/registrations';

// the registration table is part of INFO_MAN_DB.sql now (section 1b), so there is nothing to create here any more.
// The function stays so the files that call it keep working.
function ensure_registration_table($pdo)
{
}

// the grades read from the PDF that belong to this program, as the rows that will be saved in academic_record
//   -> [ [ subject_id, code, title, academic_year, semester, grade ], ... ]
function registration_grade_rows($pdo, $curriculumId, $studentNumber, $grades)
{
    $st = $pdo->prepare(
        "SELECT cs.course_code, cs.course_title, cs.subject_id, spt.year_level, spt.semester
           FROM course_subject cs
           JOIN study_plan sp       ON sp.subject_id = cs.subject_id
           JOIN study_plan_term spt ON spt.term_id = sp.term_id
          WHERE cs.curriculum_id = ?"
    );
    $st->execute([$curriculumId]);
    $subjects = [];
    foreach ($st->fetchAll() as $r) $subjects[$r['course_code']] = $r;

    $valid = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00', '5.00', 'INC', 'DO'];
    $batch = (int) substr($studentNumber, 0, 4);
    $rows  = [];
    $done  = [];
    foreach ($grades as $g) {
        $code  = (string) ($g['code'] ?? '');
        $grade = (string) ($g['grade'] ?? '');
        if (!isset($subjects[$code]) || isset($done[$code])) continue;   // not in this program, or repeated
        if (!in_array($grade, $valid, true)) continue;

        $s  = $subjects[$code];
        $yr = (int) $s['year_level'];
        $ay = ($batch + $yr - 1) . '-' . ($batch + $yr);   // e.g. 2024-2025
        $rows[] = [(int) $s['subject_id'], $code, $s['course_title'], $ay, $s['semester'], $grade];
        $done[$code] = true;
    }
    return $rows;
}

function registration_file_dir()
{
    $dir = dirname(__DIR__) . '/' . REGISTRATION_DIR;
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    if (is_dir($dir) && !is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    return $dir;
}
