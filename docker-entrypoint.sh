#!/bin/sh
set -eu

# SN binding/login must always reach the same authoritative database.
if [ -n "${APP_API_2_URL:-}" ]; then
    echo >&2 'SN management uses one backend. Remove APP_API_2_URL.'
    exit 1
fi
APP_API_1_URL="${APP_API_1_URL:-http://api:80}"
APP_API_1_URL="${APP_API_1_URL%/}"
if ! printf '%s\n' "$APP_API_1_URL" | awk '/^https?:\/\/[A-Za-z0-9_.-]+(:[0-9]+)?(\/[A-Za-z0-9_.\/-]*)?$/ { valid=1 } END { exit !valid }'; then
    echo >&2 'APP_API_1_URL must be an http(s) backend URL without credentials, query or fragment.'
    exit 1
fi
api_authority="${APP_API_1_URL#*://}"
APP_API_HOST="${api_authority%%/*}"
APP_API_TLS_NAME="${APP_API_HOST%%:*}"
APP_RESOLVER="${APP_RESOLVER:-127.0.0.11}"
if ! printf '%s\n' "$APP_RESOLVER" | awk '/^[0-9a-fA-F.: ]+$/ { valid=1 } END { exit !valid }'; then
    echo >&2 'APP_RESOLVER must contain DNS server IP addresses.'
    exit 1
fi
export APP_API_1_URL APP_API_HOST APP_API_TLS_NAME APP_RESOLVER
envsubst '${APP_API_1_URL} ${APP_API_HOST} ${APP_API_TLS_NAME} ${APP_RESOLVER}' < /etc/nginx/templates/sn.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
