# Fisher ERP - install and manage on Windows (Windows PowerShell 5.1+ / PowerShell 7). Easiest: double-click fisher.cmd
#   fisher.cmd                  install (first time) or rebuild + start
#   fisher.cmd install -Port 8090 -NoDemo
#   fisher.cmd start | stop | restart | status | logs [api|web|db] | backup | restore <db.dump> [files.tar.gz] | update | uninstall [-Purge]
#   fisher.cmd reset-password [username] [-Reset2fa]   (nobody can sign in: new one-time password)
# Same behaviour as fisher.sh (Linux/macOS). Settings and secrets live in fisher.env. Requires Docker Desktop.
param(
  [Parameter(Position = 0)][string]$Command = 'install',
  [Parameter(Position = 1)][string]$Arg1,
  [Parameter(Position = 2)][string]$Arg2,
  [int]$Port = 8080,
  [switch]$NoDemo,
  [switch]$Purge,
  [switch]$Reset2fa
)
Set-Location -LiteralPath $PSScriptRoot
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$EnvFile = 'fisher.env'
$Project = 'fisher'

function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m) { Write-Host "  - $m" }
function Fail($m) { Write-Host ""; Write-Host "[X] $m" -ForegroundColor Red; exit 1 }

# docker compose with this project's env file; output goes to the console, check $LASTEXITCODE (or use DcOk)
function Dc { & docker compose -p $Project --env-file $EnvFile -f docker-compose.yml @args | Out-Host }
function DcOk { Dc @args; return ($LASTEXITCODE -eq 0) }
function EnvGet($key) {
  if (-not (Test-Path $EnvFile)) { return '' }
  $line = Get-Content $EnvFile -Encoding UTF8 | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
  if ($line) { return $line.Substring($key.Length + 1).Trim() } else { return '' }
}

function NeedDocker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'ไม่พบ Docker - ติดตั้ง Docker Desktop จาก https://www.docker.com/products/docker-desktop/ แล้วเปิดโปรแกรม จากนั้นรันอีกครั้ง'
  }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'ไม่พบคำสั่ง "docker compose" - อัปเดต Docker Desktop เป็นรุ่นใหม่' }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Docker ยังไม่ทำงาน - เปิดโปรแกรม Docker Desktop รอจนขึ้นว่า Engine running แล้วลองใหม่' }
}
function NeedEnv { if (-not (Test-Path $EnvFile)) { Fail 'ยังไม่ได้ติดตั้ง - ดับเบิลคลิก fisher.cmd ก่อน' } }

function RandBytes($n) {
  $b = New-Object byte[] $n
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  $rng.Dispose()
  return , $b
}
function RandHex($n) { return -join ((RandBytes $n) | ForEach-Object { $_.ToString('x2') }) }
function PortBusy($p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $r = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $busy = $r.AsyncWaitHandle.WaitOne(300) -and $c.Connected
    return $busy
  } catch { return $false } finally { $c.Close() }
}
function LanIp {
  try {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker' } |
      Select-Object -First 1 -ExpandProperty IPAddress
    return $ip
  } catch { return '' }
}

function CreateEnv([int]$port, [bool]$demo) {
  if (PortBusy $port) {
    $p = $port
    while ((PortBusy $p) -and $p -lt ($port + 20)) { $p++ }
    if (PortBusy $p) { Fail "พอร์ต $port-$p ถูกใช้งานอยู่ทั้งหมด - ระบุพอร์ตอื่น เช่น fisher.cmd install -Port 9000" }
    Info "พอร์ต $port ถูกใช้งานอยู่ ใช้พอร์ต $p แทน"
    $port = $p
  }
  do { $pw = 'Fisher-' + (RandHex 5) } while ($pw -notmatch '[0-9]')
  $key = [Convert]::ToBase64String((RandBytes 32))
  $demoText = if ($demo) { 'true' } else { 'false' }
  $lines = @(
    "# Fisher ERP - สร้างโดย fisher.cmd เมื่อ $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    '# สำคัญ: เก็บไฟล์นี้ไว้ให้ปลอดภัยและสำรองแยกจากไฟล์ backup',
    '#   APP_ENCRYPTION_KEY หาย = อ่านข้อมูลส่วนบุคคล (เลขบัตร/เลขบัญชี/เลขเอกสาร) และ 2FA ไม่ได้อีก',
    "FISHER_PORT=$port",
    "PUBLIC_URL=http://localhost:$port",
    'COOKIE_SECURE=false',
    "DB_PASSWORD=$(RandHex 24)",
    "APP_ENCRYPTION_KEY=$key",
    '# รหัสผ่านตั้งต้นของผู้ใช้ admin (ระบบให้เปลี่ยนเมื่อเข้าครั้งแรก - หลังจากนั้นค่านี้ไม่มีผล)',
    "SEED_ADMIN_PASSWORD=$pw",
    '# true = ใส่ข้อมูลตัวอย่างเพื่อทดลองใช้ (ครั้งเดียว; ลบได้ที่ ตั้งค่า -> ล้างข้อมูลทั้งหมด)',
    "SEED_DEMO_DATA=$demoText",
    '# ส่งอีเมลจริง: SMTP_URL=smtp://user:pass@smtp.example.com:587  (ไม่ตั้ง = โหมดจำลอง)',
    'SMTP_URL='
  )
  # UTF-8 without BOM, LF line endings (read by docker compose)
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $EnvFile), (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Ok "สร้างไฟล์ตั้งค่า $EnvFile (รหัสผ่านฐานข้อมูลและกุญแจเข้ารหัสสุ่มใหม่)"
}

function WaitReady {
  Info 'รอให้ระบบพร้อม...'
  for ($i = 0; $i -lt 90; $i++) {
    & docker compose -p $Project --env-file $EnvFile -f docker-compose.yml exec -T api node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
    if ($LASTEXITCODE -eq 0) { Ok 'ระบบพร้อมใช้งาน'; return }
    Start-Sleep -Seconds 2
  }
  Dc logs --tail 40 api
  Fail 'ระบบไม่พร้อมภายใน 3 นาที - ดูข้อความด้านบน หรือ fisher.cmd logs api'
}
function Seed {
  $extra = if ((EnvGet 'SEED_DEMO_DATA') -eq 'true') { ' และข้อมูลตัวอย่าง' } else { '' }
  Info "เตรียมข้อมูลตั้งต้น (ผังบัญชี บทบาท ผู้ดูแลระบบ$extra)..."
  & docker compose -p $Project --env-file $EnvFile -f docker-compose.yml exec -T api node apps/api/dist/seed.js | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'เตรียมข้อมูลไม่สำเร็จ - fisher.cmd logs api' }
  Ok 'ข้อมูลตั้งต้นพร้อม'
}
function ShowAccess {
  $p = EnvGet 'FISHER_PORT'
  Write-Host ""
  Write-Host "  เปิดเบราว์เซอร์:  http://localhost:$p"
  $ip = LanIp
  if ($ip) { Write-Host "  เครื่องอื่น/มือถือในวงแลนเดียวกัน:  http://${ip}:$p" }
}

function Install {
  NeedDocker
  $fresh = $false
  if (Test-Path $EnvFile) { Info "ใช้การตั้งค่าเดิมใน $EnvFile" } else { CreateEnv $Port (-not $NoDemo); $fresh = $true }
  Info 'สร้างและเริ่มระบบ (ครั้งแรกใช้เวลาประมาณ 3-10 นาที ขึ้นกับความเร็วอินเทอร์เน็ต)...'
  if (-not (DcOk up -d --build)) { Fail 'สร้างหรือเริ่มระบบไม่สำเร็จ - ดูข้อความด้านบน' }
  WaitReady
  Seed
  Write-Host ""
  Ok 'ติดตั้ง Fisher ERP เสร็จแล้ว'
  ShowAccess
  if ($fresh) {
    Write-Host "  ชื่อผู้ใช้:  admin"
    Write-Host "  รหัสผ่าน:   $(EnvGet 'SEED_ADMIN_PASSWORD')   (ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าครั้งแรก)"
  } else {
    Write-Host "  ชื่อผู้ใช้:  admin  (รหัสผ่านตั้งต้นอยู่ใน $EnvFile - ใช้ได้จนกว่าจะเปลี่ยนครั้งแรก)"
  }
  if ((EnvGet 'SEED_DEMO_DATA') -eq 'true') { Write-Host '  มีข้อมูลตัวอย่างให้ทดลอง - ก่อนใช้งานจริงให้ลบที่ ตั้งค่า -> ล้างข้อมูลทั้งหมด' }
  Write-Host ""
  Write-Host '  คำสั่งอื่น: fisher.cmd stop | start | status | logs | backup | update'
  Write-Host "  สำคัญ: สำรองไฟล์ $EnvFile ไว้ที่ปลอดภัย (มีกุญแจเข้ารหัสข้อมูล)"
  $p = EnvGet 'FISHER_PORT'
  try { Start-Process "http://localhost:$p" } catch { }
}

function Backup {
  NeedDocker; NeedEnv
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  New-Item -ItemType Directory -Force -Path backups | Out-Null
  # dump inside the containers and copy out: PowerShell redirection would corrupt binary output
  if (-not (DcOk exec -T db pg_dump -U fisher -Fc -f /tmp/fisher.dump fisher)) { Fail 'สำรองฐานข้อมูลไม่สำเร็จ (ระบบเริ่มทำงานอยู่หรือไม่? fisher.cmd status)' }
  if (-not (DcOk cp db:/tmp/fisher.dump "backups/fisher-db-$ts.dump")) { Fail 'คัดลอกไฟล์สำรองไม่สำเร็จ' }
  Dc exec -T db rm -f /tmp/fisher.dump
  if (-not (DcOk exec -T api tar -C /data/storage -czf /tmp/fisher-files.tar.gz .)) { Fail 'สำรองไฟล์แนบไม่สำเร็จ' }
  if (-not (DcOk cp api:/tmp/fisher-files.tar.gz "backups/fisher-files-$ts.tar.gz")) { Fail 'คัดลอกไฟล์สำรองไม่สำเร็จ' }
  Dc exec -T api rm -f /tmp/fisher-files.tar.gz
  Ok "สำรองข้อมูลแล้ว: backups\fisher-db-$ts.dump และ backups\fisher-files-$ts.tar.gz"
  Info "ไฟล์ $EnvFile ไม่ได้อยู่ในชุดสำรอง - เก็บแยกไว้ (ต้องใช้กุญแจเดิมตอนกู้คืน)"
}

function Restore($db, $files) {
  NeedDocker; NeedEnv
  if (-not $db -or -not (Test-Path $db)) { Fail 'ระบุไฟล์ฐานข้อมูล: fisher.cmd restore backups\fisher-db-....dump [backups\fisher-files-....tar.gz]' }
  if ($files -and -not (Test-Path $files)) { Fail "ไม่พบไฟล์ $files" }
  if ($env:FISHER_YES -ne '1') {
    $a = Read-Host "ข้อมูลปัจจุบันจะถูกแทนที่ด้วยข้อมูลจาก $db`nพิมพ์ yes เพื่อยืนยัน"
    if ($a -ne 'yes') { Fail 'ยกเลิก' }
  }
  Dc stop web api
  if (-not (DcOk cp $db db:/tmp/restore.dump)) { Fail 'คัดลอกไฟล์สำรองไม่สำเร็จ' }
  if (-not (DcOk exec -T db pg_restore -U fisher -d fisher --clean --if-exists --no-owner /tmp/restore.dump)) { Fail 'กู้คืนฐานข้อมูลไม่สำเร็จ' }
  Dc exec -T db rm -f /tmp/restore.dump
  Dc start api
  if ($files) {
    if (-not (DcOk cp $files api:/tmp/restore-files.tar.gz)) { Fail 'คัดลอกไฟล์แนบไม่สำเร็จ' }
    if (-not (DcOk exec -T api sh -c 'find /data/storage -mindepth 1 -delete && tar -C /data/storage -xzf /tmp/restore-files.tar.gz && rm -f /tmp/restore-files.tar.gz')) { Fail 'กู้คืนไฟล์แนบไม่สำเร็จ' }
  }
  Dc up -d
  WaitReady
  Ok 'กู้คืนข้อมูลแล้ว'
}

function Update {
  NeedDocker; NeedEnv
  if ((Test-Path .git) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Info 'ดึงโค้ดรุ่นล่าสุด...'
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail 'ดึงโค้ดไม่สำเร็จ - มีไฟล์ที่แก้ไขในเครื่องหรือไม่? (git status)' }
  } else {
    Info "ดาวน์โหลดรุ่นใหม่มาแตกทับโฟลเดอร์นี้ (เก็บไฟล์ $EnvFile ไว้) แล้วรันคำสั่งนี้อีกครั้ง"
  }
  Info 'แนะนำ: fisher.cmd backup ก่อนอัปเดตทุกครั้ง'
  if (-not (DcOk up -d --build)) { Fail 'สร้างหรือเริ่มระบบไม่สำเร็จ' }
  WaitReady
  Seed
  Ok 'อัปเดตแล้ว'
}

function Uninstall {
  NeedDocker; NeedEnv
  if ($Purge -or $Arg1 -eq '--purge') {
    $a = Read-Host 'ลบระบบและข้อมูลทั้งหมด (ฐานข้อมูล ไฟล์แนบ) อย่างถาวร - พิมพ์ DELETE เพื่อยืนยัน'
    if ($a -ne 'DELETE') { Fail 'ยกเลิก' }
    Dc down -v
    Ok "ลบระบบและข้อมูลแล้ว (ไฟล์ $EnvFile ยังอยู่ - ลบเองได้ถ้าไม่ต้องการแล้ว)"
  } else {
    Dc down
    Ok 'หยุดและนำระบบออกแล้ว ข้อมูลยังเก็บไว้ (ติดตั้งกลับด้วย fisher.cmd) - ลบข้อมูลด้วย: fisher.cmd uninstall -Purge'
  }
}

switch ($Command.ToLower()) {
  'install' { Install }
  'start' { NeedDocker; NeedEnv; Dc up -d; WaitReady; ShowAccess }
  'stop' { NeedDocker; NeedEnv; Dc stop; Ok 'หยุดระบบแล้ว (ข้อมูลยังอยู่) - เริ่มใหม่: fisher.cmd start' }
  'restart' { NeedDocker; NeedEnv; Dc restart; WaitReady; ShowAccess }
  'status' { NeedDocker; NeedEnv; Dc ps; ShowAccess }
  'logs' { NeedDocker; NeedEnv; if ($Arg1) { Dc logs -f --tail 100 $Arg1 } else { Dc logs -f --tail 100 } }
  'backup' { Backup }
  'restore' { Restore $Arg1 $Arg2 }
  'update' { Update }
  'uninstall' { Uninstall }
  'reset-password' {
    NeedDocker; NeedEnv
    $extra = @(); if ($Arg1) { $extra += $Arg1 }; if ($Reset2fa) { $extra += '--2fa' }
    Dc exec -T api node apps/api/dist/reset-password.js @extra
  }
  { $_ -in 'help', '-h', '--help' } { Get-Content $PSCommandPath -Encoding UTF8 | Select-Object -Skip 1 -First 5 | ForEach-Object { $_ -replace '^#\s?', '' } }
  default { Fail "ไม่รู้จักคำสั่ง $Command - ดู fisher.cmd help" }
}
