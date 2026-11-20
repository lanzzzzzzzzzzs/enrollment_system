
CREATE DATABASE IF NOT EXISTS system_enrollment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE system_enrollment;

-- ---------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------

CREATE TABLE college (

      college_id      VARCHAR (10)      NOT NULL
    , college_code    VARCHAR (20)      NOT NULL
    , college_name    VARCHAR (150)     NOT NULL
    , is_active       VARCHAR (1)       NOT NULL     -- 1 = active, 0 = inactive
    , CONSTRAINT      college_pk        PRIMARY KEY (college_id)
);

CREATE TABLE curriculum (

      curriculum_id      VARCHAR (10)      NOT NULL
    , college_id         VARCHAR (10)      NOT NULL
    , course_code        VARCHAR (20)      NOT NULL
    , curriculum_name    VARCHAR (150)     NOT NULL
    , effective_year     VARCHAR (4)       NULL
    , is_active          VARCHAR (1)       NOT NULL
    , CONSTRAINT         curriculum_pk          PRIMARY KEY (curriculum_id)
    , CONSTRAINT         curriculum_college_fk  FOREIGN KEY (college_id) REFERENCES college (college_id)
);

CREATE TABLE student (

      student_number         VARCHAR (10)      NOT NULL     -- format 2024-00001
    , curriculum_id          VARCHAR (10)      NOT NULL
    , last_name              VARCHAR (60)      NOT NULL
    , first_name             VARCHAR (60)      NOT NULL
    , middle_name            VARCHAR (60)      NULL
    , year_level             VARCHAR (1)       NOT NULL
    , batch_year             VARCHAR (4)       NOT NULL
    , registration_status    VARCHAR (10)      NOT NULL     -- Regular or Irregular
    , password_hash          VARCHAR (255)     NOT NULL     -- saved with password_hash(), never as plain text
    , account_status         VARCHAR (10)      NOT NULL     -- Active or Inactive
    , created_at             VARCHAR (30)      NULL
    , CONSTRAINT             student_pk             PRIMARY KEY (student_number)
    , CONSTRAINT             student_curriculum_fk  FOREIGN KEY (curriculum_id) REFERENCES curriculum (curriculum_id)
);

CREATE TABLE admin_user (

      admin_id          VARCHAR (20)      NOT NULL
    , last_name         VARCHAR (60)      NOT NULL
    , first_name        VARCHAR (60)      NOT NULL
    , password_hash     VARCHAR (255)     NOT NULL     -- saved with password_hash(), never as plain text
    , account_status    VARCHAR (10)      NOT NULL     -- Active or Inactive
    , CONSTRAINT        admin_user_pk     PRIMARY KEY (admin_id)
);

-- subjects of a curriculum
CREATE TABLE course_subject (

      subject_id                VARCHAR (10)      NOT NULL
    , curriculum_id             VARCHAR (10)      NOT NULL
    , course_code               VARCHAR (20)      NOT NULL
    , course_title              VARCHAR (200)     NOT NULL
    , units                     VARCHAR (1)       NOT NULL     -- academic 1-4, non-academic (nstp) always 3
    , is_academic               VARCHAR (1)       NOT NULL     -- 0 = nstp
    , is_laboratory             VARCHAR (1)       NOT NULL
    , corequisite_subject_id    VARCHAR (10)      NULL         -- a lab needs its lecture
    , min_year_standing         VARCHAR (1)       NULL
    , is_active                 VARCHAR (1)       NOT NULL
    , CONSTRAINT                course_subject_pk        PRIMARY KEY (subject_id)
    , CONSTRAINT                course_subject_curr_fk   FOREIGN KEY (curriculum_id) REFERENCES curriculum (curriculum_id)
    , CONSTRAINT                course_subject_coreq_fk  FOREIGN KEY (corequisite_subject_id) REFERENCES course_subject (subject_id)
);

-- subject_id requires prereq_subject_id
CREATE TABLE prerequisite (

      subject_id           VARCHAR (10)     NOT NULL
    , prereq_subject_id    VARCHAR (10)     NOT NULL
    , CONSTRAINT           prerequisite_pk          PRIMARY KEY (subject_id, prereq_subject_id)
    , CONSTRAINT           prerequisite_subject_fk  FOREIGN KEY (subject_id) REFERENCES course_subject (subject_id)
    , CONSTRAINT           prerequisite_prereq_fk   FOREIGN KEY (prereq_subject_id) REFERENCES course_subject (subject_id)
);

CREATE TABLE study_plan_term (

      term_id          VARCHAR (10)     NOT NULL
    , curriculum_id    VARCHAR (10)     NOT NULL
    , year_level       VARCHAR (1)      NOT NULL
    , semester         VARCHAR (10)     NOT NULL     -- 1st, 2nd or Summer
    , min_units        VARCHAR (2)      NULL
    , max_units        VARCHAR (2)      NULL
    , CONSTRAINT       study_plan_term_pk        PRIMARY KEY (term_id)
    , CONSTRAINT       study_plan_term_curr_fk   FOREIGN KEY (curriculum_id) REFERENCES curriculum (curriculum_id)
);

-- which subject belongs to which term
CREATE TABLE study_plan (

      study_plan_id    VARCHAR (10)     NOT NULL
    , term_id          VARCHAR (10)     NOT NULL
    , subject_id       VARCHAR (10)     NOT NULL
    , CONSTRAINT       study_plan_pk           PRIMARY KEY (study_plan_id)
    , CONSTRAINT       study_plan_term_fk      FOREIGN KEY (term_id) REFERENCES study_plan_term (term_id)
    , CONSTRAINT       study_plan_subject_fk   FOREIGN KEY (subject_id) REFERENCES course_subject (subject_id)
);

-- one row per student, subject and attempt
CREATE TABLE academic_record (

      record_id         VARCHAR (10)     NOT NULL
    , student_number    VARCHAR (10)     NOT NULL
    , subject_id        VARCHAR (10)     NOT NULL
    , academic_year     VARCHAR (9)      NOT NULL     -- e.g. 2026-2027
    , semester          VARCHAR (10)     NOT NULL     -- 1st, 2nd or Summer
    , attempt_no        VARCHAR (2)      NOT NULL     -- retakes keep the earlier rows
    , final_grade       VARCHAR (4)      NOT NULL     -- 1.00 to 3.00, 5.00, INC, DO
    , remark            VARCHAR (10)     NOT NULL     -- PASSED, FAILED, INC or DO (the PHP fills it in from the grade)
    , encoded_by        VARCHAR (20)     NULL
    , updated_at        VARCHAR (30)     NULL
    , CONSTRAINT        academic_record_pk          PRIMARY KEY (record_id)
    , CONSTRAINT        academic_record_student_fk  FOREIGN KEY (student_number) REFERENCES student (student_number)
    , CONSTRAINT        academic_record_subject_fk  FOREIGN KEY (subject_id) REFERENCES course_subject (subject_id)
    , CONSTRAINT        academic_record_admin_fk    FOREIGN KEY (encoded_by) REFERENCES admin_user (admin_id)
);

-- sections
CREATE TABLE schedule (

      schedule_id      VARCHAR (10)     NOT NULL
    , subject_id       VARCHAR (10)     NOT NULL
    , academic_year    VARCHAR (9)      NOT NULL     -- e.g. 2026-2027
    , semester         VARCHAR (10)     NOT NULL     -- 1st, 2nd or Summer
    , block_section    VARCHAR (20)     NOT NULL
    , day_of_week      VARCHAR (3)      NOT NULL     -- Mon, Tue, Wed ...
    , start_time       VARCHAR (5)      NOT NULL     -- e.g. 08:00
    , end_time         VARCHAR (5)      NOT NULL     -- e.g. 10:00
    , room_or_mode     VARCHAR (50)     NOT NULL
    , max_slots        VARCHAR (4)      NOT NULL
    , held_slots       VARCHAR (4)      NOT NULL     -- slots held by For Review / Enrolled plans
    , is_active        VARCHAR (1)      NOT NULL
    , CONSTRAINT       schedule_pk          PRIMARY KEY (schedule_id)
    , CONSTRAINT       schedule_subject_fk  FOREIGN KEY (subject_id) REFERENCES course_subject (subject_id)
);

CREATE TABLE enrollment (

      enrollment_id     VARCHAR (10)     NOT NULL
    , student_number    VARCHAR (10)     NOT NULL
    , academic_year     VARCHAR (9)      NOT NULL     -- e.g. 2026-2027
    , semester          VARCHAR (10)     NOT NULL     -- 1st, 2nd or Summer
    , status            VARCHAR (12)     NOT NULL     -- Draft, For Review, Enrolled or Rejected
    , submitted_at      VARCHAR (30)     NULL
    , created_at        VARCHAR (30)     NULL
    , CONSTRAINT        enrollment_pk          PRIMARY KEY (enrollment_id)
    , CONSTRAINT        enrollment_student_fk  FOREIGN KEY (student_number) REFERENCES student (student_number)
);

-- chosen section per subject of an enrollment
CREATE TABLE enrolled_subjects (

      enrolled_subject_id    VARCHAR (10)     NOT NULL
    , enrollment_id          VARCHAR (10)     NOT NULL
    , schedule_id            VARCHAR (10)     NOT NULL
    , subject_id             VARCHAR (10)     NOT NULL
    , slot_held              VARCHAR (1)      NOT NULL     -- 1 once the plan is submitted
    , added_at               VARCHAR (30)     NULL
    , CONSTRAINT             enrolled_subjects_pk        PRIMARY KEY (enrolled_subject_id)
    , CONSTRAINT             enrolled_enrollment_fk      FOREIGN KEY (enrollment_id) REFERENCES enrollment (enrollment_id)
    , CONSTRAINT             enrolled_schedule_fk        FOREIGN KEY (schedule_id) REFERENCES schedule (schedule_id)
    , CONSTRAINT             enrolled_subject_fk         FOREIGN KEY (subject_id) REFERENCES course_subject (subject_id)
);

-- overload / underload pdf forms
CREATE TABLE load_form (

      form_id          VARCHAR (10)      NOT NULL
    , enrollment_id    VARCHAR (10)      NOT NULL
    , form_type        VARCHAR (10)      NOT NULL     -- Overload or Underload
    , file_name        VARCHAR (255)     NOT NULL
    , file_path        VARCHAR (500)     NOT NULL
    , status           VARCHAR (10)      NOT NULL     -- Pending, Approved or Rejected
    , uploaded_at      VARCHAR (30)      NULL
    , CONSTRAINT       load_form_pk             PRIMARY KEY (form_id)
    , CONSTRAINT       load_form_enrollment_fk  FOREIGN KEY (enrollment_id) REFERENCES enrollment (enrollment_id)
);

-- history of enrollment and load form decisions
CREATE TABLE status_log (

      log_id           VARCHAR (10)      NOT NULL
    , entity_type      VARCHAR (10)      NOT NULL     -- ENROLLMENT or LOAD_FORM
    , enrollment_id    VARCHAR (10)      NULL
    , form_id          VARCHAR (10)      NULL
    , old_status       VARCHAR (20)      NULL
    , new_status       VARCHAR (20)      NOT NULL
    , admin_id         VARCHAR (20)      NULL
    , changed_at       VARCHAR (30)      NULL
    , remarks          VARCHAR (500)     NULL
    , CONSTRAINT       status_log_pk             PRIMARY KEY (log_id)
    , CONSTRAINT       status_log_enrollment_fk  FOREIGN KEY (enrollment_id) REFERENCES enrollment (enrollment_id)
    , CONSTRAINT       status_log_form_fk        FOREIGN KEY (form_id) REFERENCES load_form (form_id)
    , CONSTRAINT       status_log_admin_fk       FOREIGN KEY (admin_id) REFERENCES admin_user (admin_id)
);

-- admissions applicants (Applications page in the admin console)
CREATE TABLE application (

      application_id    VARCHAR (10)      NOT NULL
    , app_code          VARCHAR (20)      NOT NULL     -- e.g. APP-25041
    , applicant_name    VARCHAR (120)     NOT NULL
    , program_name      VARCHAR (150)     NOT NULL
    , status            VARCHAR (10)      NOT NULL     -- review, pending, approved or rejected
    , submitted_at      VARCHAR (30)      NULL
    , CONSTRAINT        application_pk    PRIMARY KEY (application_id)
);

-- the current term chosen in the admin console
CREATE TABLE app_setting (

      setting_key      VARCHAR (40)      NOT NULL
    , setting_value    VARCHAR (100)     NOT NULL
    , CONSTRAINT       app_setting_pk    PRIMARY KEY (setting_key)
);

-- ---------------------------------------------------------------------
-- 1b. extra tables the web app needs (same plain style, no foreign keys)
-- ---------------------------------------------------------------------

-- new student sign-ups waiting for the admin to check the checklist pdf
CREATE TABLE registration (

      registration_id        VARCHAR (10)      NOT NULL
    , student_number         VARCHAR (10)      NOT NULL
    , curriculum_id          VARCHAR (10)      NOT NULL
    , last_name              VARCHAR (60)      NOT NULL
    , first_name             VARCHAR (60)      NOT NULL
    , middle_name            VARCHAR (60)      NULL
    , year_level             VARCHAR (1)       NOT NULL
    , registration_status    VARCHAR (10)      NOT NULL     -- Regular or Irregular
    , password_hash          VARCHAR (255)     NOT NULL
    , grades_json            TEXT              NOT NULL     -- the grades read from the pdf
    , file_name              VARCHAR (200)     NOT NULL
    , file_path              VARCHAR (255)     NOT NULL
    , status                 VARCHAR (10)      NOT NULL     -- Pending, Approved or Rejected
    , remarks                VARCHAR (500)     NULL
    , submitted_at           VARCHAR (30)      NULL
    , decided_at             VARCHAR (30)      NULL
    , decided_by             VARCHAR (20)      NULL
    , CONSTRAINT             registration_pk   PRIMARY KEY (registration_id)
);

-- program shifters: old subject X counts as new subject Y
CREATE TABLE subject_equivalency (

      from_subject_id    VARCHAR (10)     NOT NULL
    , to_subject_id      VARCHAR (10)     NOT NULL
    , CONSTRAINT         subject_equivalency_pk   PRIMARY KEY (from_subject_id, to_subject_id)
);

-- grades removed from a shifter's active records (nothing is lost)
CREATE TABLE academic_record_archive (

      archive_id        VARCHAR (10)     NOT NULL
    , student_number    VARCHAR (10)     NOT NULL
    , subject_id        VARCHAR (10)     NOT NULL
    , academic_year     VARCHAR (9)      NOT NULL
    , semester          VARCHAR (10)     NOT NULL
    , attempt_no        VARCHAR (2)      NOT NULL
    , final_grade       VARCHAR (4)      NOT NULL
    , reason            VARCHAR (60)     NOT NULL
    , archived_at       VARCHAR (30)     NULL
    , CONSTRAINT        academic_record_archive_pk   PRIMARY KEY (archive_id)
);

CREATE TABLE student_shift_log (

      shift_id           VARCHAR (10)     NOT NULL
    , student_number     VARCHAR (10)     NOT NULL
    , from_curriculum    VARCHAR (10)     NOT NULL
    , to_curriculum      VARCHAR (10)     NOT NULL
    , credited           VARCHAR (4)      NOT NULL
    , archived           VARCHAR (4)      NOT NULL
    , shifted_by         VARCHAR (20)     NULL
    , shifted_at         VARCHAR (30)     NULL
    , CONSTRAINT         student_shift_log_pk   PRIMARY KEY (shift_id)
);

-- ---------------------------------------------------------------------
-- 2. starter data
-- ---------------------------------------------------------------------

INSERT INTO college (college_id, college_code, college_name, is_active)
VALUES ('1', 'CISTM', 'College of Information Systems and Technology Management', '1');

INSERT INTO curriculum (curriculum_id, college_id, course_code, curriculum_name, effective_year, is_active)
VALUES ('1', '1', 'BSIT', 'Bachelor of Science in Information Technology', '2024', '1');

-- admin account
-- sign in on the Admin tab with   ID: admin-001   password: admin12345
INSERT INTO admin_user (admin_id, last_name, first_name, password_hash, account_status)
VALUES ('admin-001', 'Rivera', 'Alex', '$2y$12$w7C6u3aWjh77DR9bSBueFuUTVLsZRWQ1v4e9SOlKij0HxRB0PmaIO', 'Active');

INSERT INTO app_setting (setting_key, setting_value) VALUES ('current_ay', '2026-2027');

INSERT INTO app_setting (setting_key, setting_value) VALUES ('current_sem', '1st');

-- BSIT curriculum (from the CISTM study plan A.Y. 2025-2026)
-- subject_id is typed in so the other tables can point to it
-- corequisite_subject_id = the lecture that a lab must be taken with

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('1', '1', 'CIST_101', 'Introduction to Computing (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('2', '1', 'CIST_101.1', 'Introduction to Computing (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('3', '1', 'CIST_102', 'Fundamentals of Programming (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('4', '1', 'CIST_102.1', 'Fundamentals of Programming (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('5', '1', 'GEC_ARTA', 'Art Appreciation', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('6', '1', 'GEC_MATH', 'Mathematics in the Modern World', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('7', '1', 'GEC_PCOM', 'Purposive Communications', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('8', '1', 'GEC_STAS', 'Science, Technology and Society', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('9', '1', 'PLM_IR01', 'Interdisiplinaryong Pagbasa at Pagsulat Tungo sa Mabisang Pagpapahayag', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('10', '1', 'PATHFIT1', 'Physical Activities Towards Health and Fitness 1', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('11', '1', 'NSTP_001', 'National Service Training Program 1', '3', '0', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('12', '1', 'BSIT_111', 'Discrete Mathematics', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('13', '1', 'BSIT_112', 'Human Computer Interaction (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('14', '1', 'BSIT_112.1', 'Human Computer Interaction (lab)', '1', '1', '1', '13', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('15', '1', 'CIST_103', 'Intermediate Programming (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('16', '1', 'CIST_103.1', 'Intermediate Programming (lab)', '1', '1', '1', '15', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('17', '1', 'CIST_104', 'Data Structures and Algorithm (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('18', '1', 'CIST_104.1', 'Data Structures and Algorithm (lab)', '1', '1', '1', '17', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('19', '1', 'GEC_SELF', 'Understanding the Self', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('20', '1', 'GEE_4MST', 'Living in the IT Era', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('21', '1', 'GEE_4SSP', 'The Entrepreneurial Mind', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('22', '1', 'PATHFIT2', 'Physical Activities Towards Health and Fitness 2', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('23', '1', 'NSTP_002', 'National Service Training Program 2', '3', '0', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('24', '1', 'BSIT_201', 'Web Systems and Technology (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('25', '1', 'BSIT_201.1', 'Web Systems and Technology (lab)', '1', '1', '1', '24', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('26', '1', 'BSIT_202', 'Object Oriented Programming (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('27', '1', 'BSIT_202.1', 'Object Oriented Programming (lab)', '1', '1', '1', '26', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('28', '1', 'CIST_201', 'Information Management (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('29', '1', 'CIST_201.1', 'Information Management (lab)', '1', '1', '1', '28', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('30', '1', 'GEC_ETHC', 'Ethics', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('31', '1', 'GEC_HIST', 'Readings in Philippine History', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('32', '1', 'GEC_WORL', 'The Contemporary World', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('33', '1', 'GEE_1MST', 'Environmental Science', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('34', '1', 'PATHFIT3', 'Physical Activities Towards Health and Fitness 3', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('35', '1', 'BSIT_203', 'Database Management (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('36', '1', 'BSIT_203.1', 'Database Management (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('37', '1', 'BSIT_204', 'Fundamentals of Networking (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('38', '1', 'BSIT_204.1', 'Fundamentals of Networking (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('39', '1', 'BSIT_205', 'Quantitative Methods', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('40', '1', 'BSIT_206', 'Platform Technologies', '3', '1', '0', NULL, '2', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('41', '1', 'BSIT_207', 'Event Driven Programming (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('42', '1', 'BSIT_207.1', 'Event Driven Programming (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('43', '1', 'BSIT_E01', 'Elective 1', '3', '1', '0', NULL, '2', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('44', '1', 'GEC_RZAL', 'Rizal''s Life and Works', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('45', '1', 'PATHFIT4', 'Physical Activities Towards Health and Fitness 4', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('46', '1', 'BSIT_301', 'Information Assurance and Security 1 (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('47', '1', 'BSIT_301.1', 'Information Assurance and Security 1 (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('48', '1', 'BSIT_302', 'Advanced Networking (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('49', '1', 'BSIT_302.1', 'Advanced Networking (lab)', '1', '1', '1', '48', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('50', '1', 'BSIT_303', 'System Integration and Architecture 1 (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('51', '1', 'BSIT_303.1', 'System Integration and Architecture 1 (lab)', '1', '1', '1', '50', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('52', '1', 'BSIT_E02', 'Elective 2', '3', '1', '0', NULL, '3', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('53', '1', 'BSIT_E03', 'Elective 3', '3', '1', '0', NULL, '3', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('54', '1', 'CIST_301', 'Applications Development and Emerging Technologies (lec)', '2', '1', '0', NULL, '3', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('55', '1', 'CIST_301.1', 'Applications Development and Emerging Technologies (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('56', '1', 'BSIT_304', 'Capstone Project 1', '3', '1', '0', NULL, '3', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('57', '1', 'BSIT_305', 'Integrative Programming and Technologies (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('58', '1', 'BSIT_305.1', 'Integrative Programming and Technologies (lab)', '1', '1', '1', '57', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('59', '1', 'BSIT_306', 'Social and Professional Issues', '3', '1', '0', NULL, '3', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('60', '1', 'BSIT_307', 'Information Assurance and Security 2 (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('61', '1', 'BSIT_307.1', 'Information Assurance and Security 2 (lab)', '1', '1', '1', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('62', '1', 'BSIT_308', 'System Integration and Architecture 2 (lec)', '2', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('63', '1', 'BSIT_308.1', 'System Integration and Architecture 2 (lab)', '1', '1', '1', '62', NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('64', '1', 'BSIT_E04', 'Elective 4', '3', '1', '0', NULL, '3', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('65', '1', 'BSIT_401', 'Capstone Project 2', '3', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('66', '1', 'BSIT_402', 'Practicum (Lecture)', '2', '1', '0', NULL, '4', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('67', '1', 'BSIT_403', 'System Administration and Maintenance', '3', '1', '0', NULL, '4', '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('68', '1', 'BSIT_404', 'Practicum Industry Immersion (486 hours)', '4', '1', '0', NULL, NULL, '1');

INSERT INTO course_subject (subject_id, curriculum_id, course_code, course_title, units, is_academic, is_laboratory, corequisite_subject_id, min_year_standing, is_active)
VALUES ('69', '1', 'BSIT_405', 'Capstone Project 3', '3', '1', '0', NULL, NULL, '1');

-- study plan terms (min_units and max_units are left empty, the study plan does not state them)
-- term_id 1 = year 1 1st sem, 2 = year 1 2nd sem, 3 = year 2 1st sem ... 8 = year 4 2nd sem

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('1', '1', '1', '1st', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('2', '1', '1', '2nd', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('3', '1', '2', '1st', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('4', '1', '2', '2nd', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('5', '1', '3', '1st', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('6', '1', '3', '2nd', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('7', '1', '4', '1st', NULL, NULL);

INSERT INTO study_plan_term (term_id, curriculum_id, year_level, semester, min_units, max_units)
VALUES ('8', '1', '4', '2nd', NULL, NULL);

-- which subject sits in which term

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('1', '1', '1');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('2', '1', '2');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('3', '1', '3');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('4', '1', '4');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('5', '1', '5');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('6', '1', '6');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('7', '1', '7');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('8', '1', '8');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('9', '1', '9');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('10', '1', '10');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('11', '1', '11');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('12', '2', '12');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('13', '2', '13');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('14', '2', '14');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('15', '2', '15');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('16', '2', '16');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('17', '2', '17');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('18', '2', '18');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('19', '2', '19');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('20', '2', '20');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('21', '2', '21');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('22', '2', '22');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('23', '2', '23');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('24', '3', '24');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('25', '3', '25');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('26', '3', '26');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('27', '3', '27');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('28', '3', '28');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('29', '3', '29');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('30', '3', '30');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('31', '3', '31');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('32', '3', '32');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('33', '3', '33');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('34', '3', '34');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('35', '4', '35');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('36', '4', '36');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('37', '4', '37');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('38', '4', '38');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('39', '4', '39');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('40', '4', '40');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('41', '4', '41');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('42', '4', '42');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('43', '4', '43');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('44', '4', '44');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('45', '4', '45');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('46', '5', '46');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('47', '5', '47');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('48', '5', '48');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('49', '5', '49');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('50', '5', '50');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('51', '5', '51');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('52', '5', '52');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('53', '5', '53');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('54', '5', '54');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('55', '5', '55');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('56', '6', '56');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('57', '6', '57');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('58', '6', '58');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('59', '6', '59');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('60', '6', '60');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('61', '6', '61');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('62', '6', '62');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('63', '6', '63');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('64', '6', '64');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('65', '7', '65');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('66', '7', '66');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('67', '7', '67');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('68', '8', '68');

INSERT INTO study_plan (study_plan_id, term_id, subject_id)
VALUES ('69', '8', '69');

-- prerequisites (subject_id needs prereq_subject_id)

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('15', '3');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('15', '4');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('16', '3');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('16', '4');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('17', '3');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('17', '4');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('18', '3');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('18', '4');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('22', '10');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('23', '11');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('24', '2');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('25', '2');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('26', '15');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('26', '17');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('27', '15');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('27', '17');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('28', '17');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('28', '18');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('29', '17');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('29', '18');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('34', '22');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('35', '28');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('35', '29');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('36', '28');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('36', '29');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('39', '12');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('41', '26');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('41', '27');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('42', '26');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('42', '27');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('45', '34');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('46', '40');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('47', '40');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('48', '37');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('49', '37');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('50', '26');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('50', '35');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('50', '37');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('51', '26');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('51', '35');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('51', '37');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('55', '41');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('55', '35');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('57', '54');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('57', '35');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('58', '54');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('58', '35');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('60', '46');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('61', '46');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('62', '50');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('63', '50');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('65', '56');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('68', '66');

INSERT INTO prerequisite (subject_id, prereq_subject_id)
VALUES ('69', '65');

-- OPTIONAL demo data (delete this whole part if you do not want it)
-- sections for 2026-2027 1st semester (2nd year subjects)
-- one section (BSIT_202 Section C) is already Full so you can see that case

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('1', '24', '2026-2027', '1st', 'Section A', 'Mon', '08:00', '10:00', 'Room 301', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('2', '24', '2026-2027', '1st', 'Section B', 'Mon', '13:00', '15:00', 'Room 302', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('3', '25', '2026-2027', '1st', 'Section A', 'Mon', '10:00', '13:00', 'Comp Lab 1', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('4', '25', '2026-2027', '1st', 'Section B', 'Mon', '15:00', '18:00', 'Comp Lab 1', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('5', '26', '2026-2027', '1st', 'Section A', 'Tue', '08:00', '10:00', 'Room 301', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('6', '26', '2026-2027', '1st', 'Section C', 'Tue', '13:00', '15:00', 'Room 303', '1', '1', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('7', '27', '2026-2027', '1st', 'Section A', 'Tue', '10:00', '13:00', 'Comp Lab 2', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('8', '28', '2026-2027', '1st', 'Section A', 'Wed', '08:00', '10:00', 'Room 301', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('9', '29', '2026-2027', '1st', 'Section A', 'Wed', '10:00', '13:00', 'Comp Lab 1', '40', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('10', '30', '2026-2027', '1st', 'Section A', 'Thu', '08:00', '11:00', 'Room 205', '45', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('11', '31', '2026-2027', '1st', 'Section A', 'Thu', '13:00', '16:00', 'Room 205', '45', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('12', '32', '2026-2027', '1st', 'Section A', 'Fri', '08:00', '11:00', 'Room 205', '45', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('13', '33', '2026-2027', '1st', 'Section A', 'Fri', '13:00', '16:00', 'Room 206', '45', '0', '1');

INSERT INTO schedule (schedule_id, subject_id, academic_year, semester, block_section, day_of_week, start_time, end_time, room_or_mode, max_slots, held_slots, is_active)
VALUES ('14', '34', '2026-2027', '1st', 'Section A', 'Sat', '08:00', '10:00', 'Gymnasium', '45', '0', '1');

COMMIT;

-- ---------------------------------------------------------------------
-- 3. views (INNER JOIN only)
-- ---------------------------------------------------------------------

-- every subject of a student's curriculum, by year and semester
CREATE VIEW v_curriculum_checklist AS

SELECT st.student_number                    "Student Number"
    , spt.year_level                        "Year Level"
    , spt.semester                          "Semester"
    , cs.subject_id                         "Subject ID"
    , cs.course_code                        "Course Code"
    , cs.course_title                       "Course Title"
    , cs.units                              "Units"
    , cs.is_academic                        "Is Academic"

FROM student st
INNER JOIN study_plan_term spt
ON spt.curriculum_id = st.curriculum_id
INNER JOIN study_plan sp
ON sp.term_id = spt.term_id
INNER JOIN course_subject cs
ON cs.subject_id = sp.subject_id;

-- the subjects a student passed
CREATE VIEW v_passed_subjects AS

SELECT ar.student_number                    "Student Number"
    , ar.subject_id                         "Subject ID"
    , cs.course_code                        "Course Code"
    , cs.course_title                       "Course Title"
    , ar.final_grade                        "Final Grade"
    , ar.academic_year                      "Academic Year"
    , ar.semester                           "Semester"

FROM academic_record ar
INNER JOIN course_subject cs
ON cs.subject_id = ar.subject_id
WHERE ar.remark = 'PASSED';

-- each subject with the subjects it requires
CREATE VIEW v_prerequisite_list AS

SELECT p.subject_id                         "Subject ID"
    , cs.course_code                        "Course Code"
    , cs.course_title                       "Course Title"
    , p.prereq_subject_id                   "Prereq Subject ID"
    , pre.course_code                       "Prereq Code"
    , pre.course_title                      "Prereq Title"

FROM prerequisite p
INNER JOIN course_subject cs
ON cs.subject_id = p.subject_id
INNER JOIN course_subject pre
ON pre.subject_id = p.prereq_subject_id;

-- sections with their subject and the slots left
CREATE VIEW v_section_slots AS

SELECT s.schedule_id                        "Schedule ID"
    , cs.course_code                        "Course Code"
    , cs.course_title                       "Course Title"
    , s.academic_year                       "Academic Year"
    , s.semester                            "Semester"
    , s.block_section                       "Block Section"
    , s.day_of_week                         "Day Of Week"
    , s.start_time                          "Start Time"
    , s.end_time                            "End Time"
    , s.room_or_mode                        "Room Or Mode"
    , s.max_slots                           "Max Slots"
    , s.held_slots                          "Held Slots"
    , s.max_slots - s.held_slots            "Available Slots"

FROM schedule s
INNER JOIN course_subject cs
ON cs.subject_id = s.subject_id;

-- the subjects and sections chosen in every enrollment
CREATE VIEW v_enrolled_list AS

SELECT e.enrollment_id                      "Enrollment ID"
    , e.student_number                      "Student Number"
    , e.academic_year                       "Academic Year"
    , e.semester                            "Semester"
    , e.status                              "Status"
    , cs.course_code                        "Course Code"
    , cs.course_title                       "Course Title"
    , cs.units                              "Units"
    , s.block_section                       "Block Section"
    , s.day_of_week                         "Day Of Week"
    , s.start_time                          "Start Time"
    , s.end_time                            "End Time"
    , s.room_or_mode                        "Room Or Mode"

FROM enrollment e
INNER JOIN enrolled_subjects es
ON es.enrollment_id = e.enrollment_id
INNER JOIN schedule s
ON s.schedule_id = es.schedule_id
INNER JOIN course_subject cs
ON cs.subject_id = es.subject_id;

-- enrollments waiting for the admin
CREATE VIEW v_review_queue AS

SELECT e.enrollment_id                      "Enrollment ID"
    , e.student_number                      "Student Number"
    , st.last_name                          "Last Name"
    , st.first_name                         "First Name"
    , e.academic_year                       "Academic Year"
    , e.semester                            "Semester"
    , e.submitted_at                        "Submitted At"

FROM enrollment e
INNER JOIN student st
ON st.student_number = e.student_number
WHERE e.status = 'For Review';
