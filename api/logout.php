<?php
// api/logout.php  -  POST  ->  { ok }   ends the php session

require __DIR__ . '/config.php';

$_SESSION = [];
session_destroy();
json_out(['ok' => true]);
