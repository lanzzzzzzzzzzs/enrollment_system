<?php
// api/config.php  -  database connection, php session and json helpers (xampp defaults)

$db_host = 'localhost';
$db_name = 'system_enrollment';
$db_user = 'root';
$db_pass = '';                  // xampp has no root password by default

// the term students are enrolling for. These are only the defaults: the admin picks the real term
// from the console (Change term in the sidebar) and it is saved in the app_setting table.
$current_ay  = '2026-2027';
$current_sem = '1st';

// when enrollment opens and closes (YYYY-MM-DD, empty until the admin sets them)
$enroll_start = '';
$enroll_end   = '';

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json; charset=utf-8');

// a PHP warning or crash must never break the json: warnings go to the Apache error log only, and an uncaught error comes
// back as a normal { ok: false, error } reply so the page shows what went wrong instead of "unexpected reply"
ini_set('display_errors', '0');
set_exception_handler(function ($e) {
    json_error('Server error: ' . $e->getMessage() . ' (' . basename($e->getFile()) . ' line ' . $e->getLine() . ')', '', 500);
});
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true) && !headers_sent()) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'field' => '', 'error' => 'Server error: ' . $err['message'] . ' (' . basename($err['file']) . ' line ' . $err['line'] . ')']);
    }
});

session_start();

require_once __DIR__ . '/rules_lib.php';

// every column in INFO_MAN_DB is VARCHAR, so numbers come out of the database as text. The browser code expects
// real numbers for ids, units, slots and flags, so they are turned back into numbers just before the json is sent.
const NUMBER_KEYS = ['units', 'is_academic', 'is_laboratory', 'is_active', 'max_slots', 'held_slots', 'available_slots',
                     'year_level', 'attempt_no', 'min_year_standing', 'min_units', 'max_units', 'academic_units',
                     'nstp_units', 'slot_held', 'effective_year', 'subject_count', 'plan_units'];

function normalize_numbers($value, $key = null)
{
    if (is_array($value)) {
        $out = [];
        foreach ($value as $k => $v) $out[$k] = normalize_numbers($v, is_string($k) ? $k : null);
        return $out;
    }
    if ($key !== null && is_string($value) && preg_match('/^-?[0-9]+$/', $value) && strlen($value) < 10
        && $key !== 'admin_id' && (in_array($key, NUMBER_KEYS, true) || substr($key, -3) === '_id')) {
        return (int) $value;
    }
    return $value;
}

function json_out($data, $code = 200)
{
    http_response_code($code);
    echo json_encode(normalize_numbers($data), JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error($message, $field = '', $code = 400)
{
    json_out(['ok' => false, 'error' => $message, 'field' => $field], $code);
}

function read_body()
{
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function year_label($n)
{
    $labels = [1 => '1st Year', 2 => '2nd Year', 3 => '3rd Year', 4 => '4th Year',
               5 => '5th Year', 6 => '6th Year', 7 => '7th Year', 8 => '8th Year'];
    return $labels[(int) $n] ?? '';
}

function initials_of($first, $last)
{
    return strtoupper(mb_substr($first, 0, 1) . mb_substr($last, 0, 1));
}

// stops with 401 unless someone with this role is signed in, then returns the session user
function require_login($role)
{
    if (empty($_SESSION['user']) || $_SESSION['user']['role'] !== $role) {
        json_error('Please sign in first.', '', 401);
    }
    check_account_active();
    return $_SESSION['user'];
}

// a suspended (Inactive) or deleted account loses its session right away, even if it is signed in
function check_account_active()
{
    global $pdo;
    $u = $_SESSION['user'] ?? null;
    if (!$u) return;
    if ($u['role'] === 'student') {
        $st = $pdo->prepare("SELECT account_status FROM student WHERE student_number = ?");
    } else {
        $st = $pdo->prepare("SELECT account_status FROM admin_user WHERE admin_id = ?");
    }
    $st->execute([$u['id']]);
    if ($st->fetchColumn() !== 'Active') {
        $_SESSION = [];
        session_destroy();
        json_error('This account is suspended or no longer exists. Contact the Registrar’s Office.', '', 401);
    }
}

// default academic units a student may enroll per term (the BSIT study plan totals), used only when a program has no limit of its own
// (NSTP is not counted: it carries no credit units)
const REGULAR_LOAD = [
    1 => ['1st' => 23, '2nd' => 23],
    2 => ['1st' => 23, '2nd' => 23],
    3 => ['1st' => 18, '2nd' => 18],
    4 => ['1st' => 8,  '2nd' => 7],
];

// the unit rules of one student for one term: { base, max, canOverload }
//   - years 1 to 4 (regular or irregular): the term total of the regular study plan, no overload
//   - year 5 and up (irregular only): 18 units, and an approved Overload form raises it to 24
//   - summer has no row in the study plan, so it keeps the old rule (18, 24 with an approved Overload form)
// $termMax is the limit of the student's own program for this term (the admin can edit it), or null to use the table above
function unit_rules($year, $status, $sem, $overloadApproved, $termMax = null)
{
    $year = (int) $year;
    if ($year >= 5) {
        $base = 18;
        $canOverload = $status === 'Irregular';
    } elseif ($termMax !== null) {
        $base = (int) $termMax;
        $canOverload = false;
    } elseif (isset(REGULAR_LOAD[$year][$sem])) {
        $base = REGULAR_LOAD[$year][$sem];
        $canOverload = false;
    } else {
        $base = 18;
        $canOverload = true;
    }
    return [
        'base'        => $base,
        'max'         => ($canOverload && $overloadApproved) ? 24 : $base,
        'canOverload' => $canOverload,
    ];
}

function student_unit_rules($pdo, $studentNumber, $sem, $overloadApproved = false)
{
    $st = $pdo->prepare("SELECT year_level, registration_status FROM student WHERE student_number = ?");
    $st->execute([$studentNumber]);
    $s = $st->fetch();

    // the limit the admin set for this program, year and term; when none is set, the total of the study plan term
    $st = $pdo->prepare(
        "SELECT spt.max_units,
                (SELECT SUM(cs.units) FROM study_plan sp JOIN course_subject cs ON cs.subject_id = sp.subject_id
                  WHERE sp.term_id = spt.term_id AND cs.is_academic = 1 AND cs.is_active = 1) AS plan_units
           FROM student s
           JOIN study_plan_term spt ON spt.curriculum_id = s.curriculum_id AND spt.year_level = s.year_level AND spt.semester = ?
          WHERE s.student_number = ?"
    );
    $st->execute([$sem, $studentNumber]);
    $t = $st->fetch();
    $termMax = null;
    if ($t) $termMax = $t['max_units'] !== null ? (int) $t['max_units'] : ($t['plan_units'] ? (int) $t['plan_units'] : null);

    return unit_rules($s ? $s['year_level'] : 1, $s ? $s['registration_status'] : 'Regular', $sem, $overloadApproved, $termMax);
}

// most academic units a plan may hold (see unit_rules)
function max_units_for($pdo, $enrollmentId)
{
    $st = $pdo->prepare("SELECT student_number, semester FROM enrollment WHERE enrollment_id = ?");
    $st->execute([$enrollmentId]);
    $e = $st->fetch();
    if (!$e) return 18;

    $st = $pdo->prepare("SELECT 1 FROM load_form WHERE enrollment_id = ? AND form_type = 'Overload' AND status = 'Approved'");
    $st->execute([$enrollmentId]);
    $approved = (bool) $st->fetchColumn();
    return student_unit_rules($pdo, $e['student_number'], $e['semester'], $approved)['max'];
}

// the plain message of a broken rule (for example "Section is Full"), see rules_lib.php
function db_message($e)
{
    if ($e instanceof RuleError) return $e->getMessage();          // a rule from rules_lib.php, already a plain sentence
    return 'Database error: ' . $e->getMessage();
}

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    json_error('Cannot connect to the database. Is MySQL running and is system_enrollment imported?', '', 500);
}

// the term chosen by the admin overrides the defaults above (table app_setting is part of INFO_MAN_DB.sql)
try {
    $settings = $pdo->query("SELECT setting_key, setting_value FROM app_setting")->fetchAll(PDO::FETCH_KEY_PAIR);
    if (!empty($settings['current_ay']) && preg_match('/^\\d{4}-\\d{4}$/', $settings['current_ay'])) $current_ay = $settings['current_ay'];
    if (!empty($settings['current_sem']) && in_array($settings['current_sem'], ['1st', '2nd', 'Summer'], true)) $current_sem = $settings['current_sem'];
    if (!empty($settings['enroll_start']) && preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $settings['enroll_start'])) $enroll_start = $settings['enroll_start'];
    if (!empty($settings['enroll_end']) && preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $settings['enroll_end'])) $enroll_end = $settings['enroll_end'];
} catch (PDOException $e) {
    // keep the defaults when the settings table can't be read
}

// everything about one enrollment: status, chosen sections, units, problems and the last admin remark
function enrollment_details($pdo, $enrollmentId)
{
    $st = $pdo->prepare("SELECT enrollment_id, student_number, academic_year, semester, status, submitted_at
                           FROM enrollment WHERE enrollment_id = ?");
    $st->execute([$enrollmentId]);
    $e = $st->fetch();
    if (!$e) return null;

    $st = $pdo->prepare(
        "SELECT es.subject_id, es.schedule_id, cs.course_code, cs.course_title, cs.units, cs.is_academic,
                sc.block_section, sc.day_of_week, sc.start_time, sc.end_time, sc.room_or_mode
           FROM enrolled_subjects es
           JOIN course_subject cs ON cs.subject_id = es.subject_id
           JOIN schedule sc       ON sc.schedule_id = es.schedule_id
          WHERE es.enrollment_id = ?
          ORDER BY cs.course_code"
    );
    $st->execute([$enrollmentId]);
    $e['subjects'] = $st->fetchAll();

    $e['units']                = enrollment_units($pdo, $enrollmentId);
    $e['conflicts']            = schedule_conflicts($pdo, $enrollmentId);
    $e['missing_corequisites'] = missing_corequisites($pdo, $enrollmentId);

    $st = $pdo->prepare("SELECT old_status, new_status, remarks, changed_at FROM status_log
                          WHERE entity_type = 'ENROLLMENT' AND enrollment_id = ? ORDER BY CAST(log_id AS UNSIGNED)");
    $st->execute([$enrollmentId]);
    $e['history'] = $st->fetchAll();

    // overload / underload forms with the admin's remark
    $st = $pdo->prepare("SELECT lf.form_id, lf.form_type, lf.file_name, lf.status, lf.uploaded_at,
                                (SELECT sl.remarks FROM status_log sl WHERE sl.entity_type = 'LOAD_FORM' AND sl.form_id = lf.form_id
                                  ORDER BY CAST(sl.log_id AS UNSIGNED) DESC LIMIT 1) AS remarks
                           FROM load_form lf WHERE lf.enrollment_id = ? ORDER BY CAST(lf.form_id AS UNSIGNED)");
    $st->execute([$enrollmentId]);
    $e['forms'] = $st->fetchAll();
    $e['max_units'] = max_units_for($pdo, $enrollmentId);
    $rules = student_unit_rules($pdo, $e['student_number'], $e['semester']);
    $e['base_max_units'] = $rules['base'];
    $e['can_overload']   = $rules['canOverload'];

    return $e;
}
