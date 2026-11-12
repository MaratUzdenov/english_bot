#!/bin/sh
# Ежедневный бэкап базы: ./scripts/backup.sh (запускается по cron на сервере)
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T postgres pg_dump -U english english_bot | gzip > "backups/english_bot_$(date +%F).sql.gz"
# храним 14 дней
find backups -name '*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup ok"
