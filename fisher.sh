#!/usr/bin/env bash
# Fisher ERP — install and manage with one command (Linux / macOS). Windows: double-click fisher.cmd.
#   ./fisher.sh                 install (first time) or rebuild + start
#   ./fisher.sh install --port 8090 --no-demo
#   ./fisher.sh start | stop | status | logs [api|web|db] | backup | restore <db.dump> [files.tar.gz] | update | uninstall [--purge]
#   ./fisher.sh reset-password [username] [--2fa]   (nobody can sign in: new one-time password)
# Settings and secrets live in fisher.env (created on first install). Requires Docker with "docker compose".
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=fisher.env
PROJECT=fisher

ok() { printf '✓ %s\n' "$*"; }
info() { printf '• %s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
# FISHER_COMPOSE_FILES lets advanced users add an override file (e.g. "-f docker-compose.yml -f my-override.yml")
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" ${FISHER_COMPOSE_FILES:--f docker-compose.yml} "$@"; }
env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "ไม่พบ Docker — ติดตั้ง Docker Desktop (Windows/macOS) หรือ Docker Engine (Linux) จาก https://docs.docker.com/get-docker/ แล้วรันคำสั่งนี้อีกครั้ง"
  docker compose version >/dev/null 2>&1 || die "ไม่พบคำสั่ง \"docker compose\" — อัปเดต Docker เป็นรุ่นใหม่ (Compose v2)"
  docker info >/dev/null 2>&1 || die "Docker ยังไม่ทำงาน — เปิดโปรแกรม Docker Desktop (Linux: sudo systemctl start docker) แล้วลองใหม่
  ถ้าขึ้นว่า permission denied: รันด้วย sudo หรือเพิ่มผู้ใช้เข้ากลุ่ม docker (sudo usermod -aG docker \$USER แล้วออกจากระบบ-เข้าใหม่)"
}
need_env() { [ -f "$ENV_FILE" ] || die "ยังไม่ได้ติดตั้ง — รัน ./fisher.sh install ก่อน"; }

rand_hex() { openssl rand -hex "$1" 2>/dev/null || od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
rand_key() { openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '\n'; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
lan_ip() { { hostname -I 2>/dev/null | awk '{print $1}'; } || true; ipconfig getifaddr en0 2>/dev/null || true; }

create_env() {
  local port="$1" demo="$2" pw
  if port_busy "$port"; then
    local p=$port
    while port_busy "$p" && [ "$p" -lt $((port + 20)) ]; do p=$((p + 1)); done
    port_busy "$p" && die "พอร์ต $port–$p ถูกใช้งานอยู่ทั้งหมด — ระบุพอร์ตอื่นด้วย --port"
    info "พอร์ต $port ถูกใช้งานอยู่ ใช้พอร์ต $p แทน"
    port=$p
  fi
  # admin password: upper + lower + digit (password policy)
  pw="Fisher-$(rand_hex 5)"
  while ! [[ "$pw" =~ [0-9] ]]; do pw="Fisher-$(rand_hex 5)"; done
  umask 077
  cat >"$ENV_FILE" <<EOF
# Fisher ERP — สร้างโดย fisher.sh เมื่อ $(date '+%Y-%m-%d %H:%M')
# สำคัญ: เก็บไฟล์นี้ไว้ให้ปลอดภัยและสำรองแยกจากไฟล์ backup
#   APP_ENCRYPTION_KEY หาย = อ่านข้อมูลส่วนบุคคล (เลขบัตร/เลขบัญชี/เลขเอกสาร) และ 2FA ไม่ได้อีก
FISHER_PORT=$port
PUBLIC_URL=http://localhost:$port
COOKIE_SECURE=false
DB_PASSWORD=$(rand_hex 24)
APP_ENCRYPTION_KEY=$(rand_key)
# รหัสผ่านตั้งต้นของผู้ใช้ admin (ระบบให้เปลี่ยนเมื่อเข้าครั้งแรก — หลังจากนั้นค่านี้ไม่มีผล)
SEED_ADMIN_PASSWORD=$pw
# true = ใส่ข้อมูลตัวอย่างเพื่อทดลองใช้ (ครั้งเดียว; ลบได้ที่ ตั้งค่า → ล้างข้อมูลทั้งหมด)
SEED_DEMO_DATA=$demo
# ส่งอีเมลจริง: SMTP_URL=smtp://user:pass@smtp.example.com:587  (ไม่ตั้ง = โหมดจำลอง)
SMTP_URL=
EOF
  umask 022
  ok "สร้างไฟล์ตั้งค่า $ENV_FILE (รหัสผ่านฐานข้อมูลและกุญแจเข้ารหัสสุ่มใหม่)"
}

wait_ready() {
  info "รอให้ระบบพร้อม..."
  for _ in $(seq 1 90); do
    if dc exec -T api node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      ok "ระบบพร้อมใช้งาน"
      return 0
    fi
    sleep 2
  done
  dc logs --tail 40 api >&2 || true
  die "ระบบไม่พร้อมภายใน 3 นาที — ดูข้อความด้านบน หรือ ./fisher.sh logs api"
}

seed() {
  info "เตรียมข้อมูลตั้งต้น (ผังบัญชี บทบาท ผู้ดูแลระบบ$( [ "$(env_get SEED_DEMO_DATA)" = true ] && echo ' และข้อมูลตัวอย่าง'))..."
  dc exec -T api node apps/api/dist/seed.js >/dev/null || die "เตรียมข้อมูลไม่สำเร็จ — ./fisher.sh logs api"
  ok "ข้อมูลตั้งต้นพร้อม"
}

show_access() {
  local port ip
  port=$(env_get FISHER_PORT)
  ip=$(lan_ip | head -1)
  printf '\n  เปิดเบราว์เซอร์:  http://localhost:%s\n' "$port"
  [ -n "$ip" ] && printf '  เครื่องอื่น/มือถือในวงแลนเดียวกัน:  http://%s:%s\n' "$ip" "$port"
  return 0
}

cmd_install() {
  local port="${FISHER_PORT:-8080}" demo=true fresh=false
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port="${2:?ระบุหมายเลขพอร์ต}"; shift 2 ;;
      --no-demo) demo=false; shift ;;
      *) die "ไม่รู้จักตัวเลือก $1" ;;
    esac
  done
  need_docker
  if [ -f "$ENV_FILE" ]; then
    info "ใช้การตั้งค่าเดิมใน $ENV_FILE"
  else
    create_env "$port" "$demo"
    fresh=true
  fi
  info "สร้างและเริ่มระบบ (ครั้งแรกใช้เวลาประมาณ 3–10 นาที ขึ้นกับความเร็วอินเทอร์เน็ต)..."
  dc up -d --build
  wait_ready
  seed
  printf '\n✓ ติดตั้ง Fisher ERP เสร็จแล้ว\n'
  show_access
  if $fresh; then
    printf '  ชื่อผู้ใช้:  admin\n  รหัสผ่าน:   %s   (ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าครั้งแรก)\n' "$(env_get SEED_ADMIN_PASSWORD)"
  else
    printf '  ชื่อผู้ใช้:  admin  (รหัสผ่านตั้งต้นอยู่ใน %s — ใช้ได้จนกว่าจะเปลี่ยนครั้งแรก)\n' "$ENV_FILE"
  fi
  [ "$(env_get SEED_DEMO_DATA)" = true ] && printf '  มีข้อมูลตัวอย่างให้ทดลอง — ก่อนใช้งานจริงให้ลบที่ ตั้งค่า → ล้างข้อมูลทั้งหมด\n'
  printf '\n  คำสั่งอื่น: ./fisher.sh stop | start | status | logs | backup | update\n'
  printf '  สำคัญ: สำรองไฟล์ %s ไว้ที่ปลอดภัย (มีกุญแจเข้ารหัสข้อมูล)\n\n' "$ENV_FILE"
}

cmd_backup() {
  need_docker; need_env
  local ts dir=backups
  ts=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$dir"
  umask 077 # backups hold the business data: owner-only
  dc exec -T db pg_dump -U fisher -Fc fisher >"$dir/fisher-db-$ts.dump" || die "สำรองฐานข้อมูลไม่สำเร็จ (ระบบเริ่มทำงานอยู่หรือไม่? ./fisher.sh status)"
  dc exec -T api tar -C /data/storage -czf - . >"$dir/fisher-files-$ts.tar.gz" || die "สำรองไฟล์แนบไม่สำเร็จ"
  ok "สำรองข้อมูลแล้ว: $dir/fisher-db-$ts.dump และ $dir/fisher-files-$ts.tar.gz"
  info "ไฟล์ $ENV_FILE ไม่ได้อยู่ในชุดสำรอง — เก็บแยกไว้ (ต้องใช้กุญแจเดิมตอนกู้คืน)"
}

cmd_restore() {
  need_docker; need_env
  local db="${1:-}" files="${2:-}" yes="${FISHER_YES:-}"
  [ -f "$db" ] || die "ระบุไฟล์ฐานข้อมูล: ./fisher.sh restore backups/fisher-db-....dump [backups/fisher-files-....tar.gz]"
  [ -z "$files" ] || [ -f "$files" ] || die "ไม่พบไฟล์ $files"
  if [ "$yes" != 1 ]; then
    printf 'ข้อมูลปัจจุบันจะถูกแทนที่ด้วยข้อมูลจาก %s\nพิมพ์ yes เพื่อยืนยัน: ' "$db"
    read -r a
    [ "$a" = yes ] || die "ยกเลิก"
  fi
  dc stop api web >/dev/null
  dc exec -T db pg_restore -U fisher -d fisher --clean --if-exists --no-owner <"$db" || die "กู้คืนฐานข้อมูลไม่สำเร็จ"
  if [ -n "$files" ]; then
    dc run --rm -T --no-deps --entrypoint sh api -c 'find /data/storage -mindepth 1 -delete && tar -C /data/storage -xzf -' <"$files" || die "กู้คืนไฟล์แนบไม่สำเร็จ"
  fi
  dc up -d >/dev/null
  wait_ready
  ok "กู้คืนข้อมูลแล้ว"
}

cmd_update() {
  need_docker; need_env
  if [ -d .git ]; then
    info "ดึงโค้ดรุ่นล่าสุด..."
    git pull --ff-only || die "ดึงโค้ดไม่สำเร็จ — มีไฟล์ที่แก้ไขในเครื่องหรือไม่? (git status)"
  else
    info "โฟลเดอร์นี้ไม่ใช่ git — ดาวน์โหลดรุ่นใหม่มาแตกทับ (เก็บไฟล์ $ENV_FILE ไว้) แล้วรันคำสั่งนี้อีกครั้ง"
  fi
  info "แนะนำ: ./fisher.sh backup ก่อนอัปเดตทุกครั้ง"
  dc up -d --build
  wait_ready
  seed
  ok "อัปเดตแล้ว"
}

cmd_uninstall() {
  need_docker; need_env
  if [ "${1:-}" = --purge ]; then
    printf 'ลบระบบและข้อมูลทั้งหมด (ฐานข้อมูล ไฟล์แนบ) อย่างถาวร — พิมพ์ DELETE เพื่อยืนยัน: '
    read -r a
    [ "$a" = DELETE ] || die "ยกเลิก"
    dc down -v
    ok "ลบระบบและข้อมูลแล้ว (ไฟล์ $ENV_FILE ยังอยู่ — ลบเองได้ถ้าไม่ต้องการแล้ว)"
  else
    dc down
    ok "หยุดและนำระบบออกแล้ว ข้อมูลยังเก็บไว้ (ติดตั้งกลับด้วย ./fisher.sh) — ลบข้อมูลด้วย: ./fisher.sh uninstall --purge"
  fi
}

case "${1:-install}" in
  install) shift || true; cmd_install "$@" ;;
  start) need_docker; need_env; dc up -d; wait_ready; show_access ;;
  stop) need_docker; need_env; dc stop; ok "หยุดระบบแล้ว (ข้อมูลยังอยู่) — เริ่มใหม่: ./fisher.sh start" ;;
  restart) need_docker; need_env; dc restart; wait_ready; show_access ;;
  status) need_docker; need_env; dc ps; show_access ;;
  logs) need_docker; need_env; shift; dc logs -f --tail 100 "$@" ;;
  backup) cmd_backup ;;
  restore) shift; cmd_restore "$@" ;;
  update) cmd_update ;;
  uninstall) shift; cmd_uninstall "$@" ;;
  reset-password) need_docker; need_env; shift; dc exec -T api node apps/api/dist/reset-password.js "$@" ;;
  -h | --help | help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "ไม่รู้จักคำสั่ง $1 — ดู ./fisher.sh help" ;;
esac
