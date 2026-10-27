param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference='Stop'
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$target=[IO.Path]::GetFullPath($job.target).TrimEnd('\');$stage=[IO.Path]::GetFullPath($job.stage).TrimEnd('\')
$backup=Join-Path $job.dir 'rollback';$journal=[Collections.Generic.List[object]]::new()
$result=Join-Path $job.dir 'result.json';$restart=$false;$canRestart=$false;$lock=$null
function Save-Result($phase,$message){[IO.File]::WriteAllText($result,(@{phase=$phase;message=$message;version=$job.version}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))}
function Safe-Target($relative){
 if($relative.Contains('\') -or $relative -match '(^|/)\.\.?(/|$)|[:\x00-\x1f]' -or [IO.Path]::IsPathRooted($relative)){throw 'Invalid manifest path'}
 $dest=[IO.Path]::GetFullPath((Join-Path $target $relative));if(!$dest.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid target path'}
 $cursor=$dest
 while($cursor){if(Test-Path -LiteralPath $cursor){if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Target contains link'}};if($cursor -eq $target){break};$cursor=[IO.Path]::GetDirectoryName($cursor)}
 return $dest
}
try{
 # Never kill another workspace or application; wait for this exact parent to exit.
 $parentProcess=Get-Process -Id $job.pid -ErrorAction SilentlyContinue
 if($parentProcess -and !$parentProcess.WaitForExit(60000)){throw 'Application did not exit'}
 $canRestart=$true
 $lock=[IO.File]::Open((Join-Path $target '.gugu-update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $others=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals((Join-Path $target '谷谷bot.exe'),[StringComparison]::OrdinalIgnoreCase)})
 if($others.Count){throw 'Another workspace is using this installation'}
 $files=ConvertFrom-Json -InputObject (Get-Content -LiteralPath (Join-Path $job.dir 'files.json') -Raw -Encoding UTF8)
 if(!$files.Count){throw 'Empty update manifest'}
 foreach($file in $files){$dest=Safe-Target $file.path;if((Test-Path -LiteralPath $dest) -and !(Test-Path -LiteralPath $dest -PathType Leaf)){throw 'Target file conflicts with directory'};$source=[IO.Path]::GetFullPath((Join-Path $stage $file.path));if(!$source.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Staged payload changed'}}
 New-Item -ItemType Directory -Path $backup | Out-Null
 foreach($file in $files){
  $dest=Safe-Target $file.path;$old=Join-Path $backup $file.path;$exists=Test-Path -LiteralPath $dest
  if($exists){[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($old)) | Out-Null;Copy-Item -LiteralPath $dest -Destination $old}
  $journal.Add(@{path=$file.path;existed=$exists});[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
  Copy-Item -LiteralPath (Join-Path $stage $file.path) -Destination $dest -Force
 }
 Save-Result 'installed' '更新已安装';$restart=$true
}catch{
 $rollbackOK=$true
 for($i=$journal.Count-1;$i -ge 0;$i--){try{$row=$journal[$i];$dest=Safe-Target $row.path;if($row.existed){$old=Join-Path $backup $row.path;if(!(Test-Path -LiteralPath $dest -PathType Leaf) -or (Get-FileHash -LiteralPath $old).Hash -ne (Get-FileHash -LiteralPath $dest).Hash){Copy-Item -LiteralPath $old -Destination $dest -Force}}else{if(Test-Path -LiteralPath $dest){Remove-Item -LiteralPath $dest -Force -ErrorAction Stop}}}catch{$rollbackOK=$false}}
 if($rollbackOK){Save-Result 'failed' '更新未完成，已保留或恢复原版本；请关闭其他工作台或检查目录权限后重试';$restart=$canRestart}else{Save-Result 'failed' '更新恢复未完成，请从更新缓存中的rollback目录恢复程序文件'}
}
if($lock){$lock.Dispose()}
if($restart -and $job.restart -ne $false){$profile='--user-data-dir="'+$job.profile+'"';Start-Process -FilePath (Join-Path $target '谷谷bot.exe') -ArgumentList $profile -WorkingDirectory $target -WindowStyle Normal}
