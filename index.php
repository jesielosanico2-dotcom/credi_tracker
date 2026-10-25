<?php
$appUrl = 'http://127.0.0.1:3000/';
$connection = @fsockopen('127.0.0.1', 3000, $errorCode, $errorMessage, 1);

if ($connection !== false) {
    fclose($connection);
    header('Location: ' . $appUrl, true, 302);
    exit;
}

http_response_code(503);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Start Credit Tracker</title>
  <style>
    body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: #0c1428; color: #eef3ff; font: 15px "Segoe UI", sans-serif; }
    main { width: min(480px, calc(100% - 48px)); padding: 28px; border: 1px solid #283552; border-radius: 14px; background: #121d35; }
    h1 { margin-top: 0; }
    p, li { color: #aab6d0; line-height: 1.7; }
    code { color: #b9cbff; }
    a { color: #9db5ff; }
  </style>
</head>
<body>
  <main>
    <h1>Credit Tracker is not running yet</h1>
    <p>Apache found this project folder, but the Node.js app is not running. Start it from the project folder in VS Code:</p>
    <ol>
      <li>Open the VS Code terminal.</li>
      <li>Run <code>npm run dev</code>.</li>
      <li>Refresh this page.</li>
    </ol>
    <p>You can also open <a href="http://localhost:3000/">http://localhost:3000/</a> after starting the app.</p>
  </main>
</body>
</html>
