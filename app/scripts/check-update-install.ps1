$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path $root ('backups\update-install-'+[guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$utf8=[Text.UTF8Encoding]::new($false)
function Write-Text($file,$text){[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null;[IO.File]::WriteAllText($file,$text,$utf8)}
function Assert($value,$message){if(!$value){throw $message}}
foreach($script in @('update-stage.ps1','update-install.ps1')){Write-Text (Join-Path $fixture $script) ([char]0xfeff+[IO.File]::ReadAllText((Join-Path $root ('assets\'+$script))))}
$release=Join-Path $fixture 'gugu-bot-v0.4.0-win32-x64'
foreach($file in @('谷谷bot.exe','icudtl.dat','resources.pak','v8_context_snapshot.bin','resources/app/desktop.cjs','resources/app/public/app.js')){Write-Text (Join-Path $release $file) ('new:'+ $file)}
Write-Text (Join-Path $release 'resources/app/package.json') '{"name":"pingu-desk","version":"0.4.0","main":"desktop.cjs"}'
Write-Text (Join-Path $release 'release-manifest.json') '{"product":"谷谷bot","version":"0.4.0","platform":"win32","arch":"x64","emptyUserData":true}'
$zipPath=Join-Path $fixture 'release.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($release,$zipPath,[IO.Compression.CompressionLevel]::Optimal,$true)
function New-Job($name){
 $dir=Join-Path $fixture $name;[IO.Directory]::CreateDirectory($dir)|Out-Null
 $job=@{dir=$dir;zip=$zipPath;stage=(Join-Path $dir 'stage');version='0.4.0';target=(Join-Path $dir 'target');profile=(Join-Path $fixture 'profile');pid=2147483600;restart=$false}
 Write-Text (Join-Path $dir 'job.json') ($job | ConvertTo-Json);return $job
}
function Stage($job){& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $fixture 'update-stage.ps1') -JobFile (Join-Path $job.dir 'job.json') 2>$null;return $LASTEXITCODE}
function Install($job){& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $fixture 'update-install.ps1') -JobFile (Join-Path $job.dir 'job.json');Assert ($LASTEXITCODE -eq 0) 'Helper did not run';return (Get-Content -LiteralPath (Join-Path $job.dir 'result.json') -Raw -Encoding UTF8 | ConvertFrom-Json)}
$job=New-Job 'success';Assert ((Stage $job) -eq 0) 'Valid package rejected'
Write-Text (Join-Path $job.target '谷谷bot.exe') 'old-exe'
Write-Text (Join-Path $job.target 'resources/app/private-extra.txt') 'keep-private'
Write-Text (Join-Path $job.profile 'workspace.json') 'keep-workspace'
$result=Install $job;Assert ($result.phase -eq 'installed') 'Install did not succeed'
Assert ((Get-Content -LiteralPath (Join-Path $job.target '谷谷bot.exe') -Raw -Encoding UTF8) -eq 'new:谷谷bot.exe') 'EXE not updated'
Assert ((Get-Content -LiteralPath (Join-Path $job.dir 'rollback/谷谷bot.exe') -Raw -Encoding UTF8) -eq 'old-exe') 'Rollback copy missing'
Assert ((Get-Content -LiteralPath (Join-Path $job.target 'resources/app/private-extra.txt') -Raw) -eq 'keep-private') 'Unknown file modified'
Assert ((Get-Content -LiteralPath (Join-Path $job.profile 'workspace.json') -Raw) -eq 'keep-workspace') 'User data modified'
$job=New-Job 'rollback';Assert ((Stage $job) -eq 0) 'Stage failed'
$files=ConvertFrom-Json -InputObject (Get-Content -LiteralPath (Join-Path $job.dir 'files.json') -Raw -Encoding UTF8)
foreach($f in $files){Write-Text (Join-Path $job.target $f.path) ('old:'+ $f.path)}
$lockedFile=Join-Path $job.target $files[-1].path
$lock=[IO.File]::Open($lockedFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$result=Install $job;Assert ($result.phase -eq 'failed') 'Locked target did not fail'}finally{$lock.Dispose()}
foreach($f in $files){Assert ((Get-Content -LiteralPath (Join-Path $job.target $f.path) -Raw -Encoding UTF8) -eq ('old:'+$f.path)) 'Rollback changed original content'}
$job=New-Job 'tampered';Assert ((Stage $job) -eq 0) 'Stage failed'
Write-Text (Join-Path $job.stage 'resources/app/desktop.cjs') 'tampered'
$result=Install $job;Assert ($result.phase -eq 'failed') 'Changed staging content accepted'
Assert (!(Test-Path -LiteralPath (Join-Path $job.target '谷谷bot.exe'))) 'Tampered update wrote target'
$badZip=Join-Path $fixture 'traversal.zip';$archive=[IO.Compression.ZipFile]::Open($badZip,[IO.Compression.ZipArchiveMode]::Create)
try{$entry=$archive.CreateEntry('gugu-bot-v0.4.0-win32-x64/../escape.txt');$writer=[IO.StreamWriter]::new($entry.Open());$writer.Write('bad');$writer.Dispose()}finally{$archive.Dispose()}
$job=New-Job 'traversal';$job.zip=$badZip;Write-Text (Join-Path $job.dir 'job.json') ($job|ConvertTo-Json)
# Expected validation failure is captured without leaking raw errors to the user-facing test output.
$oldPreference=$ErrorActionPreference;$ErrorActionPreference='Continue';$code=Stage $job;$ErrorActionPreference=$oldPreference
Assert ($code -ne 0) 'Traversal accepted';Assert (!(Test-Path -LiteralPath (Join-Path $job.dir 'escape.txt'))) 'Traversal escaped stage'
Write-Output 'PASS: stage, install, file rollback, user-data preservation, tamper rejection, zip traversal rejection'
