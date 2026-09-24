import os

# A lane's shell may export PRODUCT_TODAY for its dev server (2026-09-23 spec §K1); the suite must
# never inherit it — every test reads the real day unless it pins one itself. Popped here, in the
# package conftest.py belongs to, because pytest imports this BEFORE conftest imports the app
# (whose settings validator reads the variable at import).
os.environ.pop("PRODUCT_TODAY", None)
