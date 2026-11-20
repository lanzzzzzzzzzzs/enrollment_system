<?php
// api/admin_subjects.php  (admin only)  -  subjects of a curriculum and where they sit in the study plan
//   GET  [?curriculum_id=1]  ->  { ok, subjects: [ { subjectId, code, title, units, year, semester, prereqs, ... } ] }
//   POST { action: 'add', curriculumId, code, title, units, isAcademic, isLaboratory, year, semester, prereqs: ['CS 113'],
//          section?: { block, day, start, end, room, maxSlots } }     the optional section is created for the chosen semester (current school year, or next if it passed)

//   POST { action: 'setActive', subjectId, active: true | false }
//   POST { action: 'delete', subjectId }   removes the subject with its sections, study plan spot and prerequisite links;
//                                          refused when students have grades or plans for it (deactivate it instead)

require __DIR__ . '/config.php';

require_login('admin');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $cur = (int) ($_GET['curriculum_id'] ?? 0);
    if (!$cur) $cur = (int) $pdo->query("SELECT MIN(CAST(curriculum_id AS UNSIGNED)) FROM curriculum WHERE is_active = 1")->fetchColumn();

    $st = $pdo->prepare(
        "SELECT cs.subject_id, cs.course_code, cs.course_title, cs.units, cs.is_academic, cs.is_laboratory,
                cs.is_active, t.year_level, t.semester
           FROM course_subject cs
           LEFT JOIN study_plan sp       ON sp.subject_id = cs.subject_id
           LEFT JOIN study_plan_term t   ON t.term_id = sp.term_id
          WHERE cs.curriculum_id = ?
          ORDER BY t.year_level, FIELD(t.semester, '1st', '2nd', 'Summer'), cs.course_code"
    );
    $st->execute([$cur]);
    $rows = $st->fetchAll();

    $st = $pdo->prepare(
        "SELECT p.subject_id, pre.course_code
           FROM prerequisite p
           JOIN course_subject cs  ON cs.subject_id = p.subject_id
           JOIN course_subject pre ON pre.subject_id = p.prereq_subject_id
          WHERE cs.curriculum_id = ?"
    );
    $st->execute([$cur]);
    $prereqs = [];
    foreach ($st->fetchAll() as $p) $prereqs[$p['subject_id']][] = $p['course_code'];

    $subjects = [];
    foreach ($rows as $r) {
        $subjects[] = [
            'subjectId'    => (int) $r['subject_id'],
            'code'         => $r['course_code'],
            'title'        => $r['course_title'],
            'units'        => (int) $r['units'],
            'isAcademic'   => (bool) $r['is_academic'],
            'isLaboratory' => (bool) $r['is_laboratory'],
            'active'       => (bool) $r['is_active'],
            'year'         => $r['year_level'] === null ? null : (int) $r['year_level'],
            'semester'     => $r['semester'],
            'prereqs'      => $prereqs[$r['subject_id']] ?? [],
        ];
    }
    json_out(['ok' => true, 'curriculumId' => $cur, 'subjects' => $subjects]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b      = read_body();
$action = (string) ($b['action'] ?? 'add');

if ($action === 'setActive') {
    $pdo->prepare("UPDATE course_subject SET is_active = ? WHERE subject_id = ?")
        ->execute([empty($b['active']) ? 0 : 1, (int) ($b['subjectId'] ?? 0)]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $sid = (int) ($b['subjectId'] ?? 0);
    $st = $pdo->prepare("SELECT course_code FROM course_subject WHERE subject_id = ?");
    $st->execute([$sid]);
    $code = $st->fetchColumn();
    if ($code === false) json_error('Subject not found.', '', 404);

    $st = $pdo->prepare("SELECT (SELECT COUNT(*) FROM academic_record WHERE subject_id = ?) + (SELECT COUNT(*) FROM enrolled_subjects WHERE subject_id = ?)");
    $st->execute([$sid, $sid]);
    if ((int) $st->fetchColumn() > 0) {
        json_error($code . ' has student grades or enrollment plans, so it can’t be deleted. Deactivate it instead.');
    }

    try {
        $pdo->beginTransaction();
        $pdo->prepare("UPDATE course_subject SET corequisite_subject_id = NULL WHERE corequisite_subject_id = ?")->execute([$sid]);
        $pdo->prepare("DELETE FROM prerequisite WHERE subject_id = ? OR prereq_subject_id = ?")->execute([$sid, $sid]);
        $pdo->prepare("DELETE FROM subject_equivalency WHERE from_subject_id = ? OR to_subject_id = ?")->execute([$sid, $sid]);
        $pdo->prepare("DELETE FROM study_plan WHERE subject_id = ?")->execute([$sid]);
        $pdo->prepare("DELETE FROM schedule WHERE subject_id = ?")->execute([$sid]);
        $pdo->prepare("DELETE FROM course_subject WHERE subject_id = ?")->execute([$sid]);
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_error(db_message($e));
    }
    json_out(['ok' => true]);
}

if ($action !== 'add') json_error('Unknown action.');

$cur      = (int) ($b['curriculumId'] ?? 0);
$code     = trim((string) ($b['code'] ?? ''));
$title    = trim((string) ($b['title'] ?? ''));
$academic = (isset($b['isAcademic']) && !$b['isAcademic']) ? 0 : 1;        // NSTP sends isAcademic: false
$lab      = empty($b['isLaboratory']) ? 0 : 1;
$units    = $academic ? (int) ($b['units'] ?? 0) : 3;                      // NSTP is always 3 units
$year     = (int) ($b['year'] ?? 0);
$sem      = (string) ($b['semester'] ?? '');
$prereqs  = is_array($b['prereqs'] ?? null) ? $b['prereqs'] : [];

if ($code === '' || mb_strlen($code) > 20)   json_error('Enter a course code (up to 20 characters).', 'code');
if ($title === '' || mb_strlen($title) > 200) json_error('Enter a course title.', 'title');
if ($academic && ($units < 1 || $units > 4)) json_error('Academic subjects have 1 to 4 units.', 'units');
if ($year < 1 || $year > 4)                  json_error('Choose a year level.', 'year');
if (!in_array($sem, ['1st', '2nd', 'Summer'], true)) json_error('Choose a semester.', 'semester');

$st = $pdo->prepare("SELECT 1 FROM curriculum WHERE curriculum_id = ?");
$st->execute([$cur]);
if (!$st->fetchColumn()) json_error('Choose a program.', 'program');

// the same course code twice in one program is not allowed
$st = $pdo->prepare("SELECT 1 FROM course_subject WHERE curriculum_id = ? AND course_code = ?");
$st->execute([$cur, $code]);
if ($st->fetchColumn()) json_error('That course code already exists in this program.', 'code');

// optional first section, checked before anything is saved
$sec = is_array($b['section'] ?? null) ? $b['section'] : null;
if ($sec) {
    $block = trim((string) ($sec['block'] ?? ''));
    $day   = (string) ($sec['day'] ?? '');
    $start = (string) ($sec['start'] ?? '');
    $end   = (string) ($sec['end'] ?? '');
    $room  = trim((string) ($sec['room'] ?? ''));
    $slots = (int) ($sec['maxSlots'] ?? 0);
    $time  = '/^([01][0-9]|2[0-3]):[0-5][0-9]$/';

    if ($block === '' || mb_strlen($block) > 20)   json_error('Enter a section name.', 'block');
    if (!in_array($day, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], true)) json_error('Choose a day for the section.', 'day');
    if (!preg_match($time, $start) || !preg_match($time, $end)) json_error('Section times must look like 13:30.', 'start');
    if ($end <= $start)                            json_error('The end time must be after the start time.', 'end');
    if ($room === '' || mb_strlen($room) > 50)     json_error('Enter a room or mode (for example Online).', 'room');
    if ($slots < 1)                                json_error('Slots must be at least 1.', 'slots');
}

try {
    $pdo->beginTransaction();

    $subjectId = (int) next_id($pdo, 'course_subject', 'subject_id');
    $pdo->prepare("INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory,
                                               corequisite_subject_id, min_year_standing, is_active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, '1')")->execute([$subjectId, $cur, $code, $title, $units, $academic, $lab]);

    // the study plan term is created the first time it is used
    $st = $pdo->prepare("SELECT term_id FROM study_plan_term WHERE curriculum_id = ? AND year_level = ? AND semester = ?");
    $st->execute([$cur, $year, $sem]);
    $termId = $st->fetchColumn();
    if ($termId === false) {
        $termId = next_id($pdo, 'study_plan_term', 'term_id');
        $pdo->prepare("INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units) VALUES (?, ?, ?, ?, NULL, NULL)")
            ->execute([$termId, $cur, $year, $sem]);
    }
    $pdo->prepare("INSERT INTO study_plan (study_plan_id, term_id, subject_id) VALUES (?, ?, ?)")
        ->execute([next_id($pdo, 'study_plan', 'study_plan_id'), $termId, $subjectId]);

    // add_prerequisite() also rejects circular chains
    foreach ($prereqs as $pc) {
        $st = $pdo->prepare("SELECT subject_id FROM course_subject WHERE curriculum_id = ? AND course_code = ?");
        $st->execute([$cur, trim((string) $pc)]);
        $pid = $st->fetchColumn();
        if ($pid === false) throw new Exception('Prerequisite ' . $pc . ' does not exist in this program.');

        add_prerequisite($pdo, $subjectId, $pid);
    }

    if ($sec) {
        // the section belongs to the semester picked above (the current school year, or the next one if it already passed),
        // so a 2nd semester subject gets a 2nd semester section even while the 1st semester is running
        $term = upcoming_term($sem, $current_ay, $current_sem);
        $pdo->prepare("INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time,
                                             room_or_mode, max_slots, held_slots, is_active)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', '1')")
            ->execute([next_id($pdo, 'schedule', 'schedule_id'), $subjectId, $term['ay'], $term['sem'], $block, $day, $start, $end, $room, $slots]);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($e->getCode() === '23000') json_error('That course code already exists in this program.', 'code');
    json_error(db_message($e));
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    json_error($e->getMessage(), 'prereqs');
}

json_out(['ok' => true, 'subjectId' => $subjectId,
          'sectionTerm' => $sec ? ['academicYear' => $term['ay'], 'semester' => $term['sem'], 'openNow' => $term['ay'] === $current_ay && $term['sem'] === $current_sem] : null]);
