param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$stage=[IO.Path]::GetFullPath($job.stage)
if(Test-Path -LiteralPath $stage){throw 'Stage already exists'}
$zip=[IO.Compression.ZipFile]::OpenRead($job.zip)
try {
 $prefix='gugu-bot-v'+$job.version+'-win32-x64/'
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 $files=[Collections.Generic.List[object]]::new();[long]$total=0
 foreach($entry in $zip.Entries){
  $name=$entry.FullName.Replace('\','/')
  if(!$name.StartsWith($prefix,[StringComparison]::Ordinal)){throw 'Unexpected archive root'}
  $relative=$name.Substring($prefix.Length)
  if(!$relative){continue}
  if($relative.Contains('\') -or $relative.StartsWith('/') -or $relative -match '[\x00-\x1f:< >"|?*]'){throw 'Unsafe archive name'}
  $parts=$relative.TrimEnd('/').Split('/')
  foreach($part in $parts){if(!$part -or $part -in @('.','..') -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'){throw 'Unsafe archive segment'}}
  if((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'Links are not allowed'}
  if($name.EndsWith('/')){continue}
  if(!$seen.Add($relative)){throw 'Duplicate archive path'}
  if($relative -notmatch '^(?:谷谷bot\.exe|release-manifest\.json|LICENSE|LICENSES\.chromium\.html|README\.md|CHANGELOG\.md|THIRD_PARTY_NOTICES\.md|[a-zA-Z0-9_-]+\.(?:dll|pak|bin|dat|json)|locales/[^/]+\.pak|docs/.+\.md|resources/app/(?:[^/]+\.(?:mjs|cjs)|package\.json|(?:public|skills|assets)/.+))$'){throw 'Unexpected archive content'}
  if($relative -match '(?i)(?:^|/)(?:credentials\.json|workspace\.json|node_modules|runtime|data|backups|logs)(?:/|$)'){throw 'Private/runtime files are not update payload'}
  $total+=$entry.Length
  if($entry.Length -gt 536870912 -or $total -gt 2147483648 -or $files.Count -ge 12000){throw 'Archive exceeds limits'}
  $destination=[IO.Path]::GetFullPath((Join-Path $stage $relative))
  if(!$destination.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive escapes stage'}
  $files.Add(@{entry=$entry;relative=$relative;destination=$destination})
 }
 foreach($required in @('谷谷bot.exe','resources/app/package.json','resources/app/desktop.cjs','release-manifest.json','icudtl.dat','resources.pak','v8_context_snapshot.bin')){if(!$seen.Contains($required)){throw 'Missing runtime file'}}
 New-Item -ItemType Directory -Path $stage | Out-Null
 foreach($file in $files){[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file.destination)) | Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($file.entry,$file.destination,$false)}
 $package=Get-Content -LiteralPath (Join-Path $stage 'resources/app/package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 $manifest=Get-Content -LiteralPath (Join-Path $stage 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 if($package.version -ne $job.version -or $package.name -ne 'pingu-desk' -or $package.main -ne 'desktop.cjs' -or $manifest.version -ne $job.version -or $manifest.product -ne '谷谷bot' -or $manifest.platform -ne 'win32' -or $manifest.arch -ne 'x64' -or $manifest.emptyUserData -ne $true){throw 'Release identity mismatch'}
 $list=@($files | ForEach-Object {@{path=$_.relative;sha256=(Get-FileHash -LiteralPath $_.destination -Algorithm SHA256).Hash.ToLowerInvariant()}})
 [IO.File]::WriteAllText((Join-Path $job.dir 'files.json'),(ConvertTo-Json -InputObject $list -Depth 4),[Text.UTF8Encoding]::new($false))
} finally {$zip.Dispose()}
