#!/usr/bin/env bash
# Start the production Next.js dashboard. Called from @reboot cron entry.
cd "$(dirname "${BASH_SOURCE[0]}")"
exec /usr/bin/npm start
