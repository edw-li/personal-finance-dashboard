"""The calendar engine (2026-09-03 calendar spec §5): generated events are computed on read
from the services the owning pages already use, folded per (type, date) for vests and
paydays, and overlaid with the user's overrides. `compose()` is the only public entry."""
