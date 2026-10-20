#!/usr/bin/env bash
# AcuDx watchdog: fail when shipped source contains mock/placeholder/hardcoded markers.
# Usage: scripts/watchdog.sh [paths...]   (defaults to web/src server)
# Lines carrying "watchdog: allow" are exempt. Test files are skipped.
set -u
paths=("$@"); [ ${#paths[@]} -eq 0 ] && paths=(web/src server)
pattern='\bmock(s|ed|ing)?\b|placeholder(?!=)|\bTODO\b|\bFIXME\b|hardcod|lorem ipsum|\bfake\b|\bstub(s|bed)?\b|demo data|Dr\. Test|sk-[A-Za-z0-9]{16,}|xi-api-key: *"[A-Za-z0-9]'
hits=$(grep -rnP --include='*.ts' --include='*.tsx' --include='*.py' --include='*.mjs' \
  --exclude='*.test.ts' --exclude='*.spec.ts' --exclude-dir=tests --exclude-dir=node_modules \
  -i "$pattern" "${paths[@]}" 2>/dev/null | grep -v 'watchdog: allow' | grep -v 'placeholder=' \
  | grep -v 'placeholder:[a-z]' | grep -v 'Placeholder")' | grep -v '"todo"' )
# Excluded above: the Tailwind `placeholder:` variant, i18n keys named *Placeholder (an
# <input> hint, not content), and the stepper's "todo" status literal.
if [ -n "$hits" ]; then
  echo "$hits"
  echo "watchdog: $(echo "$hits" | wc -l) hit(s)"; exit 1
fi
echo "watchdog: clean"; exit 0
