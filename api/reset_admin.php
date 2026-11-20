<?php
// reset_admin.php  -  sets the password of admin-001 to admin12345, then checks that it works
// open it once in the browser, then DELETE this file

require __DIR__ . '/config.php';

$pdo->prepare("UPDATE admin_user SET password_hash = ?, account_status = 'Active' WHERE admin_id = 'admin-001'")
    ->execute([password_hash('admin12345', PASSWORD_DEFAULT)]);

$row = $pdo->query("SELECT password_hash FROM admin_user WHERE admin_id = 'admin-001'")->fetch();
echo $row && password_verify('admin12345', $row['password_hash']) ? 'MATCH' : 'NO MATCH';
