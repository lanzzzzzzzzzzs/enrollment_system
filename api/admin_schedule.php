<?php
// api/admin_schedule.php  (admin only)  -  sections (one schedule row = one section on one day)
//   GET  [?subject_id=3] [&ay=2026-2027] [&sem=1st]  ->  { ok, sections: [ ... ] }   default is the current term
//   POST { action: 'add', subjectId, block, day, start, end, room, maxSlots, academicYear?, semester? }
//   POST { action: 'setActive', scheduleId, active }     sections with students are set inactive, never deleted
//   Two active sections of the same subject can't overlap on the same day (back to back is fine). add, update and
//   setActive all refuse an overlap and name the section it clashes with.
//   POST { action: 'update', scheduleId, block, day, start, end, room, maxSlots }   edit a section (slots can't go below the seats already held)
//   POST { action: 'delete', scheduleId }                removes a section nobody holds (check_schedule_deletable() refuses otherwise)
//   POST { action: 'generateMissing', curriculumId? }    gives every active "Coming soon" subject (no section this term) a Section A

require __DIR__ . '/config.php';

require_login('admin');

// the active section of the same subject, term and day that overlaps start-end (HH:MM), or null.
// Back to back is fine: 08:00-10:00 and 10:00-12:00 do not overlap. $ignoreId skips the row being edited.
function find_overlap($pdo, $subjectId, $ay, $sem, $day, $start, $end, $ignoreId = 0)
{
    $st = $pdo->prepare("SELECT block_section, day_of_week, start_time AS s, end_time AS e
                           FROM schedule
                          WHERE subject_id = ? AND academic_year = ? AND semester = ? AND day_of_week = ?
                            AND is_active = 1 AND schedule_id <> ? AND start_time < ? AND end_time > ?
                          ORDER BY start_time LIMIT 1");
    $st->execute([$subjectId, $ay, $sem, $day, $ignoreId, $end, $start]);
    return $st->fetch() ?: null;
}

function overlap_message($o)
{
    return 'That time overlaps ' . $o['block_section'] . ' (' . $o['day_of_week'] . ' ' . $o['s'] . '–' . $o['e'] .
           '). Sections of the same subject can’t overlap, so pick a different day or time.';
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sql = "SELECT sc.schedule_id, sc.subject_id, cs.course_code, cs.course_title, sc.academic_year, sc.semester,
                   sc.block_section, sc.day_of_week,
                   sc.start_time, sc.end_time,
                   sc.room_or_mode, sc.max_slots, sc.held_slots,
                   (CAST(sc.max_slots AS SIGNED) - CAST(sc.held_slots AS SIGNED)) AS available_slots, sc.is_active
              FROM schedule sc JOIN course_subject cs ON cs.subject_id = sc.subject_id
             WHERE ";
    if (isset($_GET['ay']) || isset($_GET['sem'])) {          // one term asked for
        $sql  .= "sc.academic_year = ? AND sc.semester = ?";
        $args  = [$_GET['ay'] ?? $current_ay, $_GET['sem'] ?? $current_sem];
    } else {                                                   // default: the current term and every term after it
        $sql  .= "(sc.academic_year > ? OR (sc.academic_year = ? AND FIELD(sc.semester, '1st', '2nd', 'Summer') >= FIELD(?, '1st', '2nd', 'Summer')))";
        $args  = [$current_ay, $current_ay, $current_sem];
    }

    if (!empty($_GET['subject_id'])) {
        $sql   .= " AND sc.subject_id = ?";
        $args[] = (int) $_GET['subject_id'];
    }

    $st = $pdo->prepare($sql . " ORDER BY cs.course_code, sc.block_section, FIELD(sc.day_of_week, 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'), sc.start_time");
    $st->execute($args);
    json_out(['ok' => true, 'sections' => $st->fetchAll()]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Use GET or POST.', '', 405);

$b      = read_body();
$action = (string) ($b['action'] ?? 'add');

if ($action === 'setActive') {
    $sid    = (int) ($b['scheduleId'] ?? 0);
    $active = empty($b['active']) ? 0 : 1;

    if ($active) {                       // turning a section back on must not create an overlap
        $st = $pdo->prepare("SELECT subject_id, academic_year, semester, day_of_week, start_time AS s, end_time AS e
                               FROM schedule WHERE schedule_id = ?");
        $st->execute([$sid]);
        if ($r = $st->fetch()) {
            $o = find_overlap($pdo, (int) $r['subject_id'], $r['academic_year'], $r['semester'], $r['day_of_week'], $r['s'], $r['e'], $sid);
            if ($o) json_error(overlap_message($o));
        }
    }
    $pdo->prepare("UPDATE schedule SET is_active = ? WHERE schedule_id = ?")->execute([$active, $sid]);
    json_out(['ok' => true]);
}

if ($action === 'update') {
    $sid   = (int) ($b['scheduleId'] ?? 0);
    $block = trim((string) ($b['block'] ?? ''));
    $day   = (string) ($b['day'] ?? '');
    $start = (string) ($b['start'] ?? '');
    $end   = (string) ($b['end'] ?? '');
    $room  = trim((string) ($b['room'] ?? ''));
    $slots = (int) ($b['maxSlots'] ?? 0);

    if ($block === '' || mb_strlen($block) > 20)   json_error('Enter a section name.', 'block');
    if (!in_array($day, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], true)) json_error('Choose a day.', 'day');
    if (!preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $start) || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $end)) {
        json_error('Times must look like 13:30.', 'start');
    }
    if ($end <= $start)                            json_error('The end time must be after the start time.', 'end');
    if ($room === '' || mb_strlen($room) > 50)     json_error('Enter a room or mode (for example Online).', 'room');
    if ($slots < 1)                                json_error('Slots must be at least 1.', 'slots');

    $st = $pdo->prepare("SELECT held_slots, subject_id, academic_year, semester, is_active FROM schedule WHERE schedule_id = ?");
    $st->execute([$sid]);
    $row = $st->fetch();
    if (!$row) json_error('Section not found.', '', 404);
    $held = $row['held_slots'];
    if ($slots < (int) $held) json_error('Students already hold ' . $held . ' seat' . ((int) $held === 1 ? '' : 's') . ', so slots can’t go below ' . $held . '.', 'slots');

    if ((int) $row['is_active'] === 1) {
        $o = find_overlap($pdo, (int) $row['subject_id'], $row['academic_year'], $row['semester'], $day, $start, $end, $sid);
        if ($o) json_error(overlap_message($o), 'start');
    }

    if (schedule_exists($pdo, $row['subject_id'], $row['academic_year'], $row['semester'], $block, $day, $start, $sid)) {
        json_error('That section already exists for this subject, day and time.');
    }

    try {
        $pdo->prepare("UPDATE schedule SET block_section = ?, day_of_week = ?, start_time = ?, end_time = ?, room_or_mode = ?, max_slots = ?
                        WHERE schedule_id = ?")->execute([$block, $day, $start, $end, $room, $slots, $sid]);
    } catch (PDOException $e) {
        json_error(db_message($e));
    }
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    try {
        check_schedule_deletable($pdo, (int) ($b['scheduleId'] ?? 0));     // "Section has held or enrolled students: set it inactive instead"
        $pdo->prepare("DELETE FROM schedule WHERE schedule_id = ?")->execute([(int) ($b['scheduleId'] ?? 0)]);
    } catch (PDOException $e) {
        json_error(db_message($e));
    }
    json_out(['ok' => true]);
}

if ($action === 'generateMissing') {
    $cur = (int) ($b['curriculumId'] ?? 0);

    // active subjects with no active section in the current term, in study plan order
    $sql = "SELECT cs.subject_id, cs.course_code, cs.units, cs.is_academic, cs.is_laboratory, t.year_level, t.semester
              FROM course_subject cs
              LEFT JOIN study_plan sp     ON sp.subject_id = cs.subject_id
              LEFT JOIN study_plan_term t ON t.term_id = sp.term_id
             WHERE cs.is_active = 1" . ($cur ? " AND cs.curriculum_id = ?" : "") . "
               AND NOT EXISTS (SELECT 1 FROM schedule sc WHERE sc.subject_id = cs.subject_id
                                AND sc.academic_year = ? AND sc.semester = ? AND sc.is_active = 1)
               AND (t.term_id IS NULL OR t.semester = ? OR ? = 'Summer')
             ORDER BY t.year_level, FIELD(t.semester, '1st', '2nd', 'Summer'), cs.course_code";
    $args = $cur ? [$cur, $current_ay, $current_sem, $current_sem, $current_sem] : [$current_ay, $current_sem, $current_sem, $current_sem];
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $todo = $st->fetchAll();

    // times already taken per study plan term (year + semester) and day, so a term's new sections do not overlap
    $st = $pdo->prepare("SELECT t.year_level, t.semester, sc.day_of_week,
                                CAST(SUBSTRING(sc.start_time, 1, 2) AS UNSIGNED) * 60 + CAST(SUBSTRING(sc.start_time, 4, 2) AS UNSIGNED) AS s,
                                CAST(SUBSTRING(sc.end_time, 1, 2) AS UNSIGNED) * 60 + CAST(SUBSTRING(sc.end_time, 4, 2) AS UNSIGNED) AS e
                           FROM schedule sc
                           JOIN study_plan sp     ON sp.subject_id = sc.subject_id
                           JOIN study_plan_term t ON t.term_id = sp.term_id
                          WHERE sc.academic_year = ? AND sc.semester = ? AND sc.is_active = 1");
    $st->execute([$current_ay, $current_sem]);
    $busy = [];
    foreach ($st->fetchAll() as $r) $busy[$r['year_level'] . '-' . $r['semester']][$r['day_of_week']][] = [(int) $r['s'], (int) $r['e']];

    $days    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    $fmt     = function ($m) { return sprintf('%02d:%02d', intdiv($m, 60), $m % 60); };
    $created = 0;
    $skipped = [];
    $index   = [];                                   // how many subjects were placed per group, to rotate the starting day

    try {
        $pdo->beginTransaction();
        $ins = $pdo->prepare("INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time,
                                                    room_or_mode, max_slots, held_slots, is_active)
                              VALUES (?, ?, ?, ?, 'Section A', ?, ?, ?, ?, '40', '0', '1')");
        foreach ($todo as $r) {
            $key  = ($r['year_level'] ?? 0) . '-' . ($r['semester'] ?? '');
            $hrs  = $r['is_laboratory'] ? 3 : max(1, (int) $r['units']);      // labs run 3 hours, lectures one hour per unit
            $len  = $hrs * 60;
            $n    = $index[$key] = ($index[$key] ?? -1) + 1;
            $room = $r['is_laboratory'] ? 'Comp Lab ' . (1 + $n % 3)
                  : (!$r['is_academic'] ? 'Room 205'
                  : (stripos($r['course_code'], 'PATHFIT') === 0 ? 'Gymnasium' : 'Room ' . (301 + $n % 4)));

            $placed = false;
            for ($k = 0; $k < count($days) && !$placed; $k++) {
                $day = $days[($n + $k) % count($days)];
                for ($start = 7 * 60; $start + $len <= 19 * 60 && !$placed; $start += 30) {
                    $clash = false;
                    foreach ($busy[$key][$day] ?? [] as $iv) {
                        if ($start < $iv[1] && $iv[0] < $start + $len) { $clash = true; break; }
                    }
                    if ($clash) continue;
                    $ins->execute([next_id($pdo, 'schedule', 'schedule_id'), $r['subject_id'], $current_ay, $current_sem, $day, $fmt($start), $fmt($start + $len), $room]);
                    $busy[$key][$day][] = [$start, $start + $len];
                    $created++;
                    $placed = true;
                }
            }
            if (!$placed) $skipped[] = $r['course_code'];
        }
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_error(db_message($e));
    }

    json_out(['ok' => true, 'created' => $created, 'skipped' => $skipped]);
}

if ($action !== 'add') json_error('Unknown action.');

$subjectId = (int) ($b['subjectId'] ?? 0);
$block     = trim((string) ($b['block'] ?? ''));
$day       = (string) ($b['day'] ?? '');
$start     = (string) ($b['start'] ?? '');
$end       = (string) ($b['end'] ?? '');
$room      = trim((string) ($b['room'] ?? ''));
$slots     = (int) ($b['maxSlots'] ?? 0);
$term      = offered_term($pdo, $subjectId, $current_ay, $current_sem);   // the subject's own semester, even if it is not that semester yet
$ay        = (string) ($b['academicYear'] ?? $term['ay']);
$sem       = (string) ($b['semester'] ?? $term['sem']);

if ($block === '' || mb_strlen($block) > 20)   json_error('Enter a section name.', 'block');
if (!in_array($day, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], true)) json_error('Choose a day.', 'day');
if (!preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $start) || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $end)) {
    json_error('Times must look like 13:30.', 'start');
}
if ($end <= $start)                            json_error('The end time must be after the start time.', 'end');
if ($room === '' || mb_strlen($room) > 50)     json_error('Enter a room or mode (for example Online).', 'room');
if ($slots < 1)                                json_error('Slots must be at least 1.', 'slots');
if (!preg_match('/^[0-9]{4}-[0-9]{4}$/', $ay)) json_error('Academic year must look like 2026-2027.', 'ay');
if (!in_array($sem, ['1st', '2nd', 'Summer'], true)) json_error('Choose a semester.', 'semester');

$st = $pdo->prepare("SELECT 1 FROM course_subject WHERE subject_id = ?");
$st->execute([$subjectId]);
if (!$st->fetchColumn()) json_error('Choose a subject.', 'subject');

if (!subject_offered_in($pdo, $subjectId, $sem)) json_error(not_offered_message($pdo, $subjectId, $sem), 'subject');

$o = find_overlap($pdo, $subjectId, $ay, $sem, $day, $start, $end);
if ($o) json_error(overlap_message($o), 'start');

if (schedule_exists($pdo, $subjectId, $ay, $sem, $block, $day, $start)) json_error('That section already exists for this subject, day and time.');

try {
    $newId = (int) next_id($pdo, 'schedule', 'schedule_id');
    $pdo->prepare("INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time,
                                         room_or_mode, max_slots, held_slots, is_active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', '1')")->execute([$newId, $subjectId, $ay, $sem, $block, $day, $start, $end, $room, $slots]);
} catch (PDOException $e) {
    json_error(db_message($e));
}

json_out(['ok' => true, 'scheduleId' => $newId, 'academicYear' => $ay, 'semester' => $sem,
          'openNow' => $ay === $current_ay && $sem === $current_sem]);
