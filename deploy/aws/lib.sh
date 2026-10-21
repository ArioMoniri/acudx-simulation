#!/usr/bin/env bash
# Shared helpers for the deploy/aws operator scripts (sourced, not run).
# shellcheck disable=SC2034  # variables are used by the scripts that source this file

NAME="${NAME:-acudx-web-prod}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-central-1}}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""
DRY_RUN="${DRY_RUN:-0}"
SSM_PREFIX="/acudx/${NAME}"
SG_NAME="${NAME}-sg"
KEY_NAME="${KEY_NAME:-${NAME}-key}"
STACK_TAG_KEY="acudx:stack"

log() { printf '[%s] %s\n' "$(basename "$0")" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# aws_do DRYRUN_ANSWER ARGS...
#   Runs `aws ARGS...` and prints its stdout. With DRY_RUN=1 nothing is sent: the command is
#   printed to stderr (values after --value / --cli-input-json are never printed) and
#   DRYRUN_ANSWER is echoed instead, so the script walks its create path end to end.
aws_do() {
  local dryrun_answer="$1"
  shift
  if [ "$DRY_RUN" = 1 ]; then
    printf 'DRY-RUN aws' >&2
    local redact=0 a
    for a in "$@"; do
      if [ "$redact" = 1 ]; then printf ' <redacted>' >&2; redact=0; continue; fi
      printf ' %q' "$a" >&2
      case "$a" in --value|--cli-input-json|--user-data) redact=1 ;; esac
    done
    printf '\n' >&2
    printf '%s' "$dryrun_answer"
    return 0
  fi
  aws "$@"
}

# aws_none: the "nothing found" answer of a describe call, normalised to empty.
aws_none() { case "$1" in None|null|"") printf '' ;; *) printf '%s' "$1" ;; esac; }

# put_secure NAME VALUE: SSM SecureString, overwrite; the value travels in a 0600 temp file,
# never on the command line.
put_secure() {
  local pname="$1" value="$2" tmp
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  python3 - "$pname" "$value" > "$tmp" <<'PY'
import json, sys
print(json.dumps({"Name": sys.argv[1], "Value": sys.argv[2], "Type": "SecureString", "Overwrite": True}))
PY
  aws_do "" ssm put-parameter --cli-input-json "file://$tmp" --output text --query Version >/dev/null
  rm -f "$tmp"
}

tag_spec() { # tag_spec RESOURCE_TYPE
  printf 'ResourceType=%s,Tags=[{Key=Name,Value=%s},{Key=%s,Value=%s}]' "$1" "$NAME" "$STACK_TAG_KEY" "$NAME"
}
