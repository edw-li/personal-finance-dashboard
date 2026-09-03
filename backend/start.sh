#!/bin/sh
set -e
alembic upgrade head
python -m app.seed
# --no-access-log: the calendar feed carries its credential in the QUERY STRING
# (/api/v1/calendar/feed.ics?token=...), and uvicorn's access log writes the whole
# request line, token included. nginx fronts every request and logs the path without
# the query (see nginx.conf), so no observability is lost. Error logs and tracebacks
# are untouched.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log
