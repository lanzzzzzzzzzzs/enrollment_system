<?php
// api/programs.php  -  GET  ->  { ok, programs: [ { curriculum_id, course_code, curriculum_name, effective_year, college_id, college_code, college_name } ],
//                                  colleges: [ { college_id, college_code, college_name } ] }
// A college can have two or more programs (curricula). Only active ones are listed.

require __DIR__ . '/config.php';

$rows = $pdo->query(
    "SELECT c.curriculum_id, c.course_code, c.curriculum_name, c.effective_year,
            c.college_id, co.college_code, co.college_name
       FROM curriculum c
       JOIN college co ON co.college_id = c.college_id
      WHERE c.is_active = 1 AND co.is_active = 1
      ORDER BY c.curriculum_name"
)->fetchAll();

$colleges = $pdo->query(
    "SELECT college_id, college_code, college_name FROM college WHERE is_active = 1 ORDER BY college_name"
)->fetchAll();

json_out(['ok' => true, 'programs' => $rows, 'colleges' => $colleges]);
