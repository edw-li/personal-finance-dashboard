from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

AUTH_ATTEMPT = "10/minute"

# The ICS feed is unauthenticated (the token is the credential): a per-IP ceiling well above
# any calendar app's poll cadence (12 h) and well below a token-guessing rate.
FEED_POLL = "60/hour"
