# Person-Scoped Paycheck Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-27):** This plan merges FIRST. Known latent gap it
> creates and hands to the next plan: after person_id lands, the withholding route still feeds
> EVERY profile row into the primary's salary leg — the withholding-simulation plan's Task 2
> fixes and pins that immediately after this merges (batch order 1 → 2 guarantees no real
> partner profile exists in between). Do not fix it here; do not create partner profiles in
> any test that asserts primary withholding without noting this.

**Goal:** Make `paycheck_profiles` a per-person table — each household member owns their own profile timeline — while every legacy caller that passes no person keeps behaving byte-for-byte as it does today. Adds the `hsa_coverage` tier the contribution-limit registry (Plan 4) will read, scopes the workbook importer to the primary person, and lets each tax-input person column suggest that person's salary from their profile in force.

**Architecture:** Two chained alembic migrations on head `e26b9d70a4c1`. `paycheck_profiles.person_id` is a NOT NULL FK to `people` (backfilled to the primary member) and the unique key swaps `effective_date` → `(person_id, effective_date)` — a change that must land in the model, in `api/paycheck.py`'s 409 pre-check and in the migration chain *together*, because the pytest database is built by `Base.metadata.create_all` and never sees a migration. One resolution rule runs through the whole router: **absent person param = the primary person**. The importer gains the same person clause the married-taxes tax sweep already carries, making partner profiles import-immune. `api/taxes.py`'s per-column suggestion machinery gains one overlay: `annual_salary` — the head of the derived-W2 chain, which has never had a source — is suggested from that column's person's profile in force.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async, `Mapped`/`mapped_column`), alembic, PostgreSQL 16, pytest + pytest-asyncio (auto mode, session-scoped loops), httpx `AsyncClient` via `ASGITransport`.

---

## Ground rules for every task

- **Working directory** for all commands is `backend/`.
- **Test command shape** (verified against `tests/conftest.py:21` + `pyproject.toml:[tool.pytest.ini_options]`):
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest <args>
  ```
  `FINANCE_TEST_DB` must match `<name>_test[_suffix]` (conftest guards the destructive teardown); `finance_test_p3profiles` does. The database is created on demand by `_ensure_test_database`.
- **Never run `alembic upgrade` / `alembic downgrade` / `alembic check`** — they connect to the live dev database. The only alembic command in this plan is `alembic heads`, which reads `alembic/versions/` and opens no connection (verified: it prints `e26b9d70a4c1 (head)` today).
- Every code block below is the **complete** final text of the function/class/file section it replaces. No placeholders, no `...`.
- Commit after each task. Do not push.

---

## Task 1 — `paycheck_profiles.person_id`: the column, the unique swap, and the primary-default CRUD

**Files:**
- `backend/app/models/comp.py` (`PaycheckProfile` at `:39-53`; the `effective_date` unique at `:43`; the import line at `:4`)
- `backend/app/schemas/paycheck.py` (`ProfileIn` `:21-33`, `ProfileUpdate` `:36-49`, `ProfileOut` `:52-66`, import line `:16`)
- `backend/app/api/paycheck.py` (imports `:26-36`, constants `:40-74`, `_require_free_effective_date` `:139-152`, `list_profiles` `:163-173`, `create_profile` `:176-193`, `update_profile` `:196-223`)
- `backend/app/importer/apply.py` (`apply_paycheck` `:685-735`; the `existing` map at `:726`; `load_people`/`primary_person` already imported at `:47`)
- `backend/alembic/versions/20260827_0900_d4f9a1c8e307_paycheck_profile_person_scope.py` (new)
- `backend/tests/test_models_comp.py` (`test_paycheck_profile_roundtrip` `:37-54`; import block `:8-16`)
- `backend/tests/test_paycheck_comp_api.py` (module imports `:27`; `profile()` `:38-54`; the paycheck API section `:352-687`)
- `backend/tests/test_withholding_api.py` (`seed_profile` `:107-125`)
- `backend/tests/test_calendar_api.py` (import block `:7-16`; profile adds at `:153` and `:200-206`)
- `backend/tests/test_importer_apply.py` (`test_apply_paycheck_derives_effective_date_from_focal` `:740-768`)

### Steps

- [ ] **1.1 — Write the failing model test.** Add `Person` to the `app.models` import block in `backend/tests/test_models_comp.py` (`:8-16` becomes):
  ```python
  from app.models import (
      AppSetting,
      CompEvent,
      EsppLot,
      EsppOffering,
      EsppPeriod,
      PaycheckProfile,
      Person,
      RsuGrant,
  )
  ```
  Then replace `test_paycheck_profile_roundtrip` (`:37-54`) with the owned version and append the new uniqueness test right after it:
  ```python
  async def test_paycheck_profile_roundtrip(db):
      me = Person(name="Me", is_primary=True)
      db.add(me)
      await db.flush()
      db.add(
          PaycheckProfile(
              person_id=me.id,
              effective_date=date(2026, 3, 1),
              annual_salary=Decimal("188930"),
              trad_401k_pct=Decimal("0.13"),
              roth_401k_pct=Decimal("0"),
              after_tax_401k_pct=Decimal("0.03"),
              espp_pct=Decimal("0.11"),
              withholding_pct=Decimal("0.334009166"),
              dental_vision_per_check=Decimal("12.50"),
              hsa_per_check=Decimal("100.00"),
          )
      )
      await db.commit()
      p = (await db.execute(select(PaycheckProfile))).scalar_one()
      assert p.pay_periods_per_year == 24
      assert p.withholding_pct == Decimal("0.334009166")
      assert p.person_id == me.id


  async def test_paycheck_profiles_are_unique_per_person_not_per_date(db):
      """Two earners, one household, the same January 1: the unique key is
      (person_id, effective_date), so both profiles coexist — and a SECOND profile for the
      same person on that date is still refused."""
      me = Person(name="Me", is_primary=True)
      partner = Person(name="Partner")
      db.add_all([me, partner])
      await db.flush()
      db.add_all(
          [
              PaycheckProfile(
                  person_id=me.id,
                  effective_date=date(2026, 1, 1),
                  annual_salary=Decimal("188930"),
              ),
              PaycheckProfile(
                  person_id=partner.id,
                  effective_date=date(2026, 1, 1),
                  annual_salary=Decimal("96000"),
              ),
          ]
      )
      await db.commit()
      assert len((await db.execute(select(PaycheckProfile))).scalars().all()) == 2

      db.add(
          PaycheckProfile(
              person_id=me.id, effective_date=date(2026, 1, 1), annual_salary=Decimal("1")
          )
      )
      with pytest.raises(IntegrityError):
          await db.commit()
      await db.rollback()
  ```

- [ ] **1.2 — Write the failing API tests.** In `backend/tests/test_paycheck_comp_api.py`, widen the model import at `:27`:
  ```python
  from app.models import CompEvent, PaycheckProfile, Person
  ```
  Add the `me` fixture immediately below the `create_profile` helper (after `:375`):
  ```python
  @pytest.fixture
  async def me(db):
      """The primary person a profile belongs to. `create_all` seeds no roster, so every
      test that WRITES a profile asks for this explicitly — and the two that must see an
      empty database (the 404 and the auth wall) deliberately do not."""
      person = Person(name="Me", is_primary=True)
      db.add(person)
      await db.commit()
      return person
  ```
  Then append these four tests at the end of the paycheck API section, just before `# --- comp API ---` (`:689`):
  ```python
  async def test_create_profile_defaults_to_the_primary_person(auth_client, me):
      # Absent person_id = the primary. Every pre-P3 caller passes nothing and means the
      # one earner the app modeled, so the wire keeps working untouched.
      created = await create_profile(auth_client)
      assert created["person_id"] == me.id
      assert (await auth_client.get(PROFILES)).json()[0]["person_id"] == me.id


  async def test_create_profile_accepts_an_explicit_person_and_scopes_the_409(auth_client, db, me):
      partner = Person(name="Partner")
      db.add(partner)
      await db.commit()

      mine = await create_profile(auth_client)
      theirs = await create_profile(auth_client, person_id=partner.id, annual_salary="96000")
      assert theirs["person_id"] == partner.id
      # The SAME date on two timelines is not a conflict — that is the whole point of the key.
      assert theirs["effective_date"] == mine["effective_date"] == "2026-01-01"
      assert theirs["annual_salary"] == "96000.00"

      clash = await auth_client.post(PROFILES, json=profile_payload(person_id=partner.id))
      assert clash.status_code == 409
      assert "2026-01-01" in clash.json()["detail"]


  async def test_create_profile_404s_an_unknown_person_and_422s_without_a_roster(auth_client, db):
      missing = await auth_client.post(PROFILES, json=profile_payload(person_id=999))
      assert missing.status_code == 404
      assert missing.json()["detail"] == "person not found"
      # No roster at all: there is no primary to default to, and person_id is NOT NULL.
      empty = await auth_client.post(PROFILES, json=profile_payload())
      assert empty.status_code == 422
      assert empty.json()["detail"] == "household has no primary person"
      assert (await db.execute(select(PaycheckProfile))).scalars().all() == []
      # int4 fence at the boundary: an out-of-range id must never reach asyncpg as a 500.
      huge = await auth_client.post(PROFILES, json=profile_payload(person_id=99999999999))
      assert huge.status_code == 422


  async def test_patch_profile_never_changes_the_owner(auth_client, db, me):
      # `person_id` is deliberately absent from ProfileUpdate: a profile does not change
      # hands, and pydantic drops the unknown key rather than 422ing on it.
      partner = Person(name="Partner")
      db.add(partner)
      await db.commit()
      created = await create_profile(auth_client)
      patched = await auth_client.patch(
          f"{PROFILES}/{created['id']}",
          json={"person_id": partner.id, "annual_salary": "200000"},
      )
      assert patched.status_code == 200, patched.text
      assert patched.json()["person_id"] == me.id
      assert patched.json()["annual_salary"] == "200000.00"
  ```

- [ ] **1.3 — Run and confirm the failure.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_models_comp.py tests/test_paycheck_comp_api.py -q
  ```
  Expected: the two model tests error with `TypeError: 'person_id' is an invalid keyword argument for PaycheckProfile()`, and the four API tests fail on `KeyError: 'person_id'` / `assert 404 == 201`. Nothing else in these two files fails yet.

- [ ] **1.4 — Model.** In `backend/app/models/comp.py`, replace the import line at `:4`:
  ```python
  from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, Text, UniqueConstraint
  ```
  and replace the whole `PaycheckProfile` class (`:39-53`) with:
  ```python
  class PaycheckProfile(Base):
      __tablename__ = "paycheck_profiles"
      # ONE timeline PER PERSON: the effective date is unique within an owner, not across
      # the household, so a couple can both have a profile effective the same January 1.
      # The old bare-`effective_date` unique lived in three places — this model,
      # api/paycheck.py's 409 pre-check and migration e301f88ed241 — and all three moved
      # together (2026-08-27 spec §3.1). It must live HERE too, because the pytest database
      # is built by Base.metadata.create_all, which never runs a migration (Person's rule).
      __table_args__ = (UniqueConstraint("person_id", "effective_date"),)

      id: Mapped[int] = mapped_column(primary_key=True)
      # NOT NULL: a paycheck belongs to somebody. RESTRICT, not CASCADE — there is no
      # person delete route, and pay history must not vanish behind a roster edit
      # (tax_inputs.person_id's rule).
      person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="RESTRICT"))
      effective_date: Mapped[date] = mapped_column(Date)
      annual_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2))
      pay_periods_per_year: Mapped[int] = mapped_column(default=24)
      trad_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
      roth_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
      after_tax_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
      espp_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
      withholding_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
      dental_vision_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
      hsa_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
      notes: Mapped[str | None] = mapped_column(Text)
  ```
  The naming convention in `app/database.py:9-15` derives the constraint name from the FIRST column, so this renders as `uq_paycheck_profiles_person_id` — the name migration A creates.

- [ ] **1.5 — Schemas.** In `backend/app/schemas/paycheck.py`, replace the pydantic import at `:16` and add the fence constant below the imports:
  ```python
  from pydantic import BaseModel, ConfigDict, Field
  ```
  ```python
  from app.schemas.espp import Pct9

  # The people PK is an int4: an out-of-range id would reach asyncpg as a bare DataError
  # (a 500 on a plain create), so it is fenced at the boundary — api/paycheck.py's IdPath
  # precedent, applied to the one person field that arrives in a BODY rather than a query.
  INT32_MAX = 2**31 - 1
  ```
  Replace `ProfileIn` (`:21-33`), `ProfileUpdate` (`:36-49`) and `ProfileOut` (`:52-66`) with:
  ```python
  class ProfileIn(BaseModel):
      # Absent = the primary person: the wire's back-compat rule, since every pre-P3 caller
      # passes nothing and means the one earner the app modeled.
      person_id: int | None = Field(default=None, ge=1, le=INT32_MAX)
      effective_date: date
      annual_salary: Decimal
      # The sheet's hardcoded 24 (semi-monthly), as a default rather than a constant.
      pay_periods_per_year: int = 24
      trad_401k_pct: Decimal = Decimal("0")
      roth_401k_pct: Decimal = Decimal("0")
      after_tax_401k_pct: Decimal = Decimal("0")
      espp_pct: Decimal = Decimal("0")
      withholding_pct: Decimal = Decimal("0")
      dental_vision_per_check: Decimal = Decimal("0")
      hsa_per_check: Decimal = Decimal("0")
      notes: str | None = None


  class ProfileUpdate(BaseModel):
      # Every stored column here is NOT NULL except `notes`, so an explicit null is a
      # no-op on all of them (the house PATCH convention) — only `notes` really clears.
      # `person_id` is deliberately ABSENT: a profile does not change owner, and pydantic
      # drops the unknown key rather than 422ing on a client that sends one back.
      effective_date: date | None = None
      annual_salary: Decimal | None = None
      pay_periods_per_year: int | None = None
      trad_401k_pct: Decimal | None = None
      roth_401k_pct: Decimal | None = None
      after_tax_401k_pct: Decimal | None = None
      espp_pct: Decimal | None = None
      withholding_pct: Decimal | None = None
      dental_vision_per_check: Decimal | None = None
      hsa_per_check: Decimal | None = None
      notes: str | None = None


  class ProfileOut(BaseModel):
      model_config = ConfigDict(from_attributes=True)

      id: int
      # The owner. Every profile has one (NOT NULL); the list stays a single ordered list
      # and the UI groups it by this.
      person_id: int
      effective_date: date
      annual_salary: Decimal
      pay_periods_per_year: int
      trad_401k_pct: Pct9
      roth_401k_pct: Pct9
      after_tax_401k_pct: Pct9
      espp_pct: Pct9
      withholding_pct: Pct9
      dental_vision_per_check: Decimal
      hsa_per_check: Decimal
      notes: str | None
  ```

- [ ] **1.6 — Router.** In `backend/app/api/paycheck.py`, replace the model import at `:28` and add the people service import right after `app.services.money`'s block (keeping ruff's import order — `app.models`, then `app.schemas.paycheck`, then `app.services.*` alphabetically):
  ```python
  from app.models import PaycheckProfile, Person
  ```
  ```python
  from app.services.money import (
      MONEY_MAX_ABS_12_2,
      _quantize_bounded,
      quantize_money,
      require_reasonable_date,
  )
  from app.services.paycheck_calc import breakdown, half_up2
  from app.services.people import load_people, primary_person
  ```
  Add one constant beside `NEGATIVE_NET_WARNING` (`:73`):
  ```python
  NEGATIVE_NET_WARNING = "net pay is negative"
  # A stored profile must have an owner (person_id is NOT NULL), and only a database whose
  # roster was never seeded has nobody to default to.
  NO_PRIMARY_PERSON_MESSAGE = "household has no primary person"
  ```
  Insert the two resolution helpers immediately after `_get_profile` (`:136`):
  ```python
  async def _resolve_person_id(db: AsyncSession, person_id: int | None) -> int | None:
      """Who a request is about: the person named, or the PRIMARY when none is.

      Absent means primary everywhere on this router — the wire's back-compat rule, since
      every pre-P3 caller passes nothing and means the one earner the app modeled.

      None comes back ONLY on a database whose roster was never seeded (a create_all test
      database). `paycheck_profiles.person_id` is NOT NULL, so such a database can hold no
      profiles at all: reads turn that into their own empty answer, writes into a 422.
      """
      if person_id is None:
          primary = primary_person(await load_people(db))
          return None if primary is None else primary.id
      # 404 in the household router's own words — an unknown person is a missing thing, not
      # a malformed request. The int4 fence lives on the wire types (IdQuery / ProfileIn),
      # so this `get` can never reach asyncpg with an out-of-range id.
      if await db.get(Person, person_id) is None:
          raise HTTPException(status_code=404, detail="person not found")
      return person_id


  async def _require_person(db: AsyncSession, person_id: int | None) -> int:
      """The WRITE side of `_resolve_person_id`: a stored profile must have an owner."""
      resolved = await _resolve_person_id(db, person_id)
      if resolved is None:
          raise HTTPException(status_code=422, detail=NO_PRIMARY_PERSON_MESSAGE)
      return resolved
  ```
  Replace `_require_free_effective_date` (`:139-152`) with:
  ```python
  async def _require_free_effective_date(
      db: AsyncSession, person_id: int, effective_date: date
  ) -> None:
      """The unique key, checked in words first — and scoped to the OWNER: two people may
      each have a profile effective the same day, so the 409 asks about ONE timeline."""
      taken = (
          (
              await db.execute(
                  select(PaycheckProfile).where(
                      PaycheckProfile.person_id == person_id,
                      PaycheckProfile.effective_date == effective_date,
                  )
              )
          )
          .scalars()
          .first()
      )
      if taken is not None:
          raise HTTPException(
              status_code=409, detail=f"a paycheck profile for {effective_date} already exists"
          )
  ```
  Replace `list_profiles` (`:163-173`):
  ```python
  @router.get("/profiles", response_model=list[ProfileOut])
  async def list_profiles(db: AsyncSession = Depends(get_db)) -> list[PaycheckProfile]:
      # Newest first — the page opens on the profile in force. ONE list for the whole
      # household (the UI groups it by person_id). effective_date is only unique PER PERSON
      # now, so `id` breaks the tie two people sharing a date would otherwise leave to the
      # planner; on a one-person database no tie exists and the order is unchanged.
      return list(
          (
              await db.execute(
                  select(PaycheckProfile).order_by(
                      PaycheckProfile.effective_date.desc(), PaycheckProfile.id
                  )
              )
          ).scalars()
      )
  ```
  Replace `create_profile` (`:176-193`):
  ```python
  @router.post("/profiles", response_model=ProfileOut, status_code=201)
  async def create_profile(body: ProfileIn, db: AsyncSession = Depends(get_db)) -> PaycheckProfile:
      person_id = await _require_person(db, body.person_id)
      fields = _validated_profile(
          effective_date=body.effective_date,
          annual_salary=body.annual_salary,
          pay_periods_per_year=body.pay_periods_per_year,
          dental_vision_per_check=body.dental_vision_per_check,
          hsa_per_check=body.hsa_per_check,
          pcts={name: getattr(body, name) for name in PCT_FIELDS},
      )
      # (person_id, effective_date) is the natural key. Plain check-then-409: two concurrent
      # creates of the same pair would race into an IntegrityError, an accepted house class
      # for a single-user app.
      await _require_free_effective_date(db, person_id, fields["effective_date"])
      profile = PaycheckProfile(person_id=person_id, notes=body.notes, **fields)
      db.add(profile)
      await db.commit()
      return profile
  ```
  In `update_profile`, replace the conflict line at `:214-215`:
  ```python
      if fields["effective_date"] != profile.effective_date:
          # The row's OWN owner: a PATCH never moves a profile between people.
          await _require_free_effective_date(db, profile.person_id, fields["effective_date"])
  ```

- [ ] **1.7 — Importer.** In `backend/app/importer/apply.py`, replace the tail of `apply_paycheck` (`:726-735`) with:
  ```python
      primary = primary_person(await load_people(db))
      if primary is None:
          # paycheck_profiles.person_id is NOT NULL: with no roster there is nobody to own
          # the row. Named, never silent — and unreachable on a migrated database, where
          # f3a91c7e2b45 seeds the primary member.
          report.warnings.append(
              "Paycheck Modeler: the household has no primary person — profile not imported"
          )
          return
      existing = {p.effective_date: p for p in (await db.execute(select(PaycheckProfile))).scalars()}
      row = existing.get(effective_date)
      if row is None:
          db.add(PaycheckProfile(person_id=primary.id, effective_date=effective_date, **fields))
          counts.creates += 1
          report.add_sample(f"paycheck_profiles[{effective_date.isoformat()}]: created")
      else:
          _diff_update(
              row, fields, counts, report, f"paycheck_profiles[{effective_date.isoformat()}]"
          )
  ```
  (The guard sits *after* the focal-year derivation on purpose: a workbook problem is still reported before a roster problem, so `test_apply_paycheck_without_focal_new_base_skips` keeps its exact warning.)

- [ ] **1.8 — Migration A.** Create `backend/alembic/versions/20260827_0900_d4f9a1c8e307_paycheck_profile_person_scope.py`:
  ```python
  """paycheck profile person scope

  `paycheck_profiles.person_id` (int FK -> people, NOT NULL) with the unique key swapped
  from `effective_date` to (person_id, effective_date), so every household member keeps
  their own profile timeline (2026-08-27 spec §3.1). The old unique was enforced in three
  places — the model, api/paycheck.py's 409 pre-check, and migration e301f88ed241 — and
  all three move together.

  Backfill: every existing profile becomes the PRIMARY person's; the sheet and the app have
  only ever modeled one earner. f3a91c7e2b45 seeds that member earlier in this same chain,
  so the roster is always there in practice — the guard below is for a hand-edited database,
  and it fails LOUDLY rather than dropping rows, because a profile with no owner is not a
  state this table may hold after today.

  Revision ID: d4f9a1c8e307
  Revises: e26b9d70a4c1
  Create Date: 2026-08-27 09:00:00.000000

  """

  from collections.abc import Sequence

  import sqlalchemy as sa

  from alembic import op

  # revision identifiers, used by Alembic.
  revision: str = "d4f9a1c8e307"
  down_revision: str | Sequence[str] | None = "e26b9d70a4c1"
  branch_labels: str | Sequence[str] | None = None
  depends_on: str | Sequence[str] | None = None

  OLD_CONSTRAINT = "uq_paycheck_profiles_effective_date"
  NEW_CONSTRAINT = "uq_paycheck_profiles_person_id"
  FOREIGN_KEY = "fk_paycheck_profiles_person_id_people"


  def upgrade() -> None:
      """Upgrade schema."""
      op.add_column("paycheck_profiles", sa.Column("person_id", sa.Integer(), nullable=True))
      op.create_foreign_key(
          FOREIGN_KEY, "paycheck_profiles", "people", ["person_id"], ["id"], ondelete="RESTRICT"
      )
      # Backfill BEFORE the NOT NULL. The scalar subquery is safe: ux_people_single_primary
      # caps the primary at one row.
      op.execute(
          "UPDATE paycheck_profiles SET person_id = "
          "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
          "WHERE person_id IS NULL"
      )
      orphans = op.get_bind().scalar(
          sa.text("SELECT count(*) FROM paycheck_profiles WHERE person_id IS NULL")
      )
      if orphans:
          # The sentence that says what to do, instead of a bare NOT NULL violation from the
          # ALTER below.
          raise RuntimeError(
              f"{orphans} paycheck_profiles rows have no owner: seed the people table "
              "(app.seed.seed_people) before upgrading"
          )
      op.alter_column("paycheck_profiles", "person_id", nullable=False)
      op.drop_constraint(OLD_CONSTRAINT, "paycheck_profiles", type_="unique")
      op.create_unique_constraint(
          NEW_CONSTRAINT, "paycheck_profiles", ["person_id", "effective_date"]
      )


  def downgrade() -> None:
      """Downgrade schema."""
      # Anybody but the primary person only has profiles because this migration ran; the
      # narrower `effective_date` key cannot hold them. IS DISTINCT FROM, not <>, so an empty
      # roster (NULL subquery) still deletes every owned row instead of none.
      op.execute(
          "DELETE FROM paycheck_profiles WHERE person_id IS DISTINCT FROM "
          "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1)"
      )
      # Belt and braces for a hand-edited database: keep the OLDEST row of any date pair.
      op.execute(
          "DELETE FROM paycheck_profiles a USING paycheck_profiles b "
          "WHERE a.effective_date = b.effective_date AND a.id > b.id"
      )
      op.drop_constraint(NEW_CONSTRAINT, "paycheck_profiles", type_="unique")
      op.create_unique_constraint(OLD_CONSTRAINT, "paycheck_profiles", ["effective_date"])
      op.drop_constraint(FOREIGN_KEY, "paycheck_profiles", type_="foreignkey")
      op.drop_column("paycheck_profiles", "person_id")
  ```

- [ ] **1.9 — Verify the chain has ONE head** (no database connection is opened):
  ```
  .venv/Scripts/python.exe -m alembic heads
  ```
  Expected: exactly one line, `d4f9a1c8e307 (head)`. If two lines appear, `down_revision` is wrong — fix before continuing.

- [ ] **1.10 — The mechanical test edits.** Every one of these exists because `person_id` is NOT NULL and `create_all` seeds no roster. This is the complete list; nothing else in the suite constructs a `PaycheckProfile`.
  1. `tests/test_models_comp.py` — done in 1.1.
  2. `tests/test_paycheck_comp_api.py` — the `me` fixture (done in 1.2), plus **`me` added to the signature of these 17 tests** (they POST or store a profile; the numbers are current line anchors):
     `test_profiles_crud_roundtrip` `:378` → `(auth_client, db, me)`;
     `test_create_profile_defaults_every_optional_pct_to_zero` `:409` → `(auth_client, me)`;
     `test_a_zero_pct_crosses_the_wire_in_plain_notation` `:421` → `(auth_client, me)`;
     `test_create_profile_rejects_a_duplicate_effective_date` `:435` → `(auth_client, me)`;
     `test_create_profile_validation_rules` `:466` → `(auth_client, me, overrides, message)`;
     `test_create_profile_writes_nothing_when_a_late_rule_fires` `:472` → `(auth_client, db, me)`;
     `test_patch_profile_validates_the_merged_row` `:480` → `(auth_client, me)`;
     `test_patch_profile_explicit_null_is_a_no_op_on_a_not_null_column` `:497` → `(auth_client, me)`;
     `test_breakdown_golden_over_the_real_profile` `:525` → `(auth_client, me)`;
     `test_breakdown_defaults_to_the_latest_profile_effective_today_or_earlier` `:544` → `(auth_client, me)`;
     `test_breakdown_falls_back_to_the_earliest_future_profile` `:558` → `(auth_client, me)`;
     `test_breakdown_accepts_an_explicit_profile_id` `:570` → `(auth_client, me)`;
     `test_breakdown_warns_on_over_100pct_contributions_and_a_negative_net` `:589` → `(auth_client, me)`;
     `test_breakdown_warns_on_a_negative_net_alone` `:604` → `(auth_client, me)`;
     `test_breakdown_is_silent_at_exactly_100pct_and_a_zero_net` `:623` → `(auth_client, me)`;
     `test_breakdown_judges_the_negative_net_warning_on_the_displayed_net` `:641` → `(auth_client, me)`;
     `test_breakdown_degrades_on_a_stored_zero_pay_period_count` `:663` → `(auth_client, db, me)` **and** its direct add at `:666` becomes `stored = profile(pay_periods_per_year=0, person_id=me.id)`.
     **Untouched on purpose:** `test_patch_profile_404_and_delete_404` `:515` (creates nothing), `test_breakdown_404_when_nothing_is_stored` `:583` (the roster-less 404 pin), `test_paycheck_endpoints_require_auth` `:681` (401 before anything), and the module-level `profile()` factory `:38-54` (the pure calc tests never commit, so an unset `person_id` on a transient object is fine).
  3. `tests/test_withholding_api.py` — replace `seed_profile` (`:107-125`) with the self-healing version, one edit covering all 8 call sites (`:189, 348, 366, 436, 689, 748, 768, 793`); at `:689` `seed_household` already ran and its "Me" is reused:
     ```python
     async def seed_profile(db, **overrides) -> PaycheckProfile:
         """The check test_withholding_calc hand-derives: gross 10000, taxable 9350, hold 2805.

         A profile needs an owner (paycheck_profiles.person_id is NOT NULL) and `create_all`
         seeds no roster, so this seeds the primary member when the test has not already —
         the married tests' `seed_household` runs first and its "Me" is reused."""
         primary = (await db.execute(select(Person).where(Person.is_primary))).scalars().first()
         if primary is None:
             primary = Person(name="Me", is_primary=True)
             db.add(primary)
             await db.flush()
         fields = {
             "person_id": primary.id,
             "effective_date": date(2025, 1, 1),
             "annual_salary": Decimal("240000.00"),
             "pay_periods_per_year": 24,
             "trad_401k_pct": Decimal("0.050000000"),
             "roth_401k_pct": Decimal("0"),
             "after_tax_401k_pct": Decimal("0"),
             "espp_pct": Decimal("0"),
             "withholding_pct": Decimal("0.300000000"),
             "dental_vision_per_check": Decimal("50.00"),
             "hsa_per_check": Decimal("100.00"),
         }
         fields.update(overrides)
         profile = PaycheckProfile(**fields)
         db.add(profile)
         await db.commit()
         return profile
     ```
  4. `tests/test_calendar_api.py` — add `Person` to the `app.models` import (`:7-16`) and a module helper right below `freeze_today` (`:25`):
     ```python
     async def seed_primary(db) -> Person:
         """paycheck_profiles.person_id is NOT NULL and `create_all` seeds no roster."""
         person = Person(name="Me", is_primary=True)
         db.add(person)
         await db.flush()
         return person
     ```
     then at `:153` (inside `test_calendar_composes_the_whole_household_datebook`):
     ```python
         db.add(
             PaycheckProfile(
                 person_id=(await seed_primary(db)).id,
                 effective_date=date(2026, 1, 1),
                 annual_salary=Decimal("120000"),
             )
         )
     ```
     and at `:200-206` (inside `test_calendar_omits_paydays_for_other_cadences`):
     ```python
         db.add(
             PaycheckProfile(
                 person_id=(await seed_primary(db)).id,
                 effective_date=date(2026, 1, 1),
                 annual_salary=Decimal("120000"),
                 pay_periods_per_year=26,
             )
         )
     ```
  5. `tests/test_importer_apply.py` — `test_apply_paycheck_derives_effective_date_from_focal` (`:740`) gains a roster. Add `Person` to its local import (`:743`) and seed before the first Apply:
     ```python
         from app.models import CompEvent, PaycheckProfile, Person

         db.add(Person(name="Me", is_primary=True))
         await db.flush()
         wb = sheets()
     ```
     and assert the owner landed, right after the `annual_salary` pin at `:755`:
     ```python
         assert profile.person_id == (await db.execute(select(Person))).scalar_one().id
     ```
     `test_apply_paycheck_without_focal_new_base_skips` (`:771`) is **not** edited — the workbook guard still fires first.

- [ ] **1.11 — Run to green.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_models_comp.py tests/test_paycheck_comp_api.py tests/test_withholding_api.py tests/test_calendar_api.py tests/test_importer_apply.py -q
  ```
  Then the whole backend suite:
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest -q
  ```
  Expected: 1042 baseline + 5 new (1 model uniqueness + 4 CRUD/owner) = **1047 passed**, 0 failed.

- [ ] **1.12 — Lint.**
  ```
  .venv/Scripts/python.exe -m ruff check app tests alembic
  ```

- [ ] **1.13 — Commit.**
  ```
  git add backend/app/models/comp.py backend/app/schemas/paycheck.py backend/app/api/paycheck.py backend/app/importer/apply.py backend/alembic/versions/20260827_0900_d4f9a1c8e307_paycheck_profile_person_scope.py backend/tests/test_models_comp.py backend/tests/test_paycheck_comp_api.py backend/tests/test_withholding_api.py backend/tests/test_calendar_api.py backend/tests/test_importer_apply.py
  git commit -m "feat(paycheck): person-scoped profiles — person_id column, per-person unique, primary-default CRUD"
  ```

---

## Task 2 — Partner profiles are import-immune

The workbook is ONE person's paycheck. Task 1 made the importer *write* the primary's owner, but its `existing` map still reads every row, so a partner profile on the same effective date would be diff-updated by an Apply. This task closes that, mirroring `apply_taxes`' person clause.

**Files:**
- `backend/tests/test_importer_apply.py` (new test after `test_apply_paycheck_without_focal_new_base_skips` `:771-786`; the tax-sweep immunity twin lives at `:585-668`)
- `backend/app/importer/apply.py` (the `existing` map inside `apply_paycheck`, as rewritten in step 1.7)

### Steps

- [ ] **2.1 — Failing test.** Append to `backend/tests/test_importer_apply.py`, immediately after `test_apply_paycheck_without_focal_new_base_skips` (`:786`):
  ```python
  async def test_apply_paycheck_never_touches_a_partner_profile(db):
      """The paycheck twin of the tax sweep's immunity (audit §9.1, spec §4.1): the workbook
      is ONE person's paycheck, so a partner's profile — even on the very date the sheet
      derives — is invisible to Apply."""
      from app.importer.apply import apply_focal_history, apply_paycheck
      from app.importer.parsers import parse_focal_history, parse_paycheck
      from app.models import PaycheckProfile, Person

      me = Person(name="Me", is_primary=True)
      partner = Person(name="Partner", is_primary=False)
      db.add_all([me, partner])
      await db.flush()
      db.add(
          PaycheckProfile(
              person_id=partner.id,
              effective_date=date(2024, 1, 1),  # the date the sheet derives, on purpose
              annual_salary=Decimal("96000.00"),
              withholding_pct=Decimal("0.220000000"),
          )
      )
      await db.commit()

      wb = sheets()
      report = SheetReport()
      focal = parse_focal_history(wb["Focal History"])
      await apply_focal_history(db, focal, report)
      await apply_paycheck(db, parse_paycheck(wb["Paycheck Modeler"]), focal, report)
      await db.commit()

      # A CREATE on the primary's timeline, not an update of somebody else's row.
      assert report.entities["paycheck_profiles"].creates == 1
      assert report.entities["paycheck_profiles"].updates == 0
      rows = {row.person_id: row for row in (await db.execute(select(PaycheckProfile))).scalars()}
      assert rows[partner.id].annual_salary == Decimal("96000.00")
      assert rows[partner.id].withholding_pct == Decimal("0.220000000")
      assert rows[me.id].annual_salary == Decimal("120000.00")  # the sheet's, on the primary
      assert rows[me.id].effective_date == date(2024, 1, 1)
  ```

- [ ] **2.2 — Run and confirm the failure.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py::test_apply_paycheck_never_touches_a_partner_profile -q
  ```
  Expected: `assert 0 == 1` on the `creates` pin — the unscoped `existing` map found the partner's row and diff-updated it (a `KeyError: <me.id>` follows if the assert order is changed).

- [ ] **2.3 — Scope the read.** In `backend/app/importer/apply.py`, replace the single `existing = {...}` line inside `apply_paycheck` with:
  ```python
      # The sheet may only ever read or WRITE the primary person's timeline (apply_taxes'
      # person clause, spec §4.1). A partner's profile — even on this very date — is
      # invisible here: import-immune, pinned by test.
      existing = {
          p.effective_date: p
          for p in (
              await db.execute(
                  select(PaycheckProfile).where(PaycheckProfile.person_id == primary.id)
              )
          ).scalars()
      }
  ```

- [ ] **2.4 — Run to green.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q
  ```
  Expected: all pass, including the re-import `skips == 1` pin at `:767`.

- [ ] **2.5 — Commit.**
  ```
  git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
  git commit -m "feat(paycheck): partner profiles are import-immune"
  ```

---

## Task 3 — `_default_profile(db, person_id, today)` and `GET /paycheck/breakdown?person_id=`

**Files:**
- `backend/app/api/paycheck.py` (`_default_profile` `:233-265`, `get_breakdown` `:268-297`)
- `backend/tests/test_paycheck_comp_api.py` (new tests after `test_breakdown_accepts_an_explicit_profile_id` `:570-580`)

### Steps

- [ ] **3.1 — Failing tests.** Add to `backend/tests/test_paycheck_comp_api.py`, right after `test_breakdown_accepts_an_explicit_profile_id` (`:580`):
  ```python
  async def test_breakdown_takes_a_person_and_defaults_to_the_primary(auth_client, db, me):
      partner = Person(name="Partner")
      db.add(partner)
      await db.commit()
      today = date.today()
      await create_profile(auth_client, effective_date=str(today - timedelta(days=30)))
      await create_profile(
          auth_client,
          person_id=partner.id,
          effective_date=str(today - timedelta(days=30)),
          annual_salary="96000",
      )

      mine = (await auth_client.get(BREAKDOWN)).json()
      assert mine["profile"]["person_id"] == me.id
      assert mine["profile"]["annual_salary"] == "188930.00"

      theirs = (await auth_client.get(BREAKDOWN, params={"person_id": partner.id})).json()
      assert theirs["profile"]["person_id"] == partner.id
      assert theirs["gross"] == "4000.00"  # 96000 / 24

      # Absent = primary, byte for byte.
      assert (await auth_client.get(BREAKDOWN, params={"person_id": me.id})).json() == mine


  async def test_breakdown_404s_an_unknown_person_and_an_empty_timeline(auth_client, db, me):
      partner = Person(name="Partner")
      db.add(partner)
      await db.commit()
      await create_profile(auth_client)

      unknown = await auth_client.get(BREAKDOWN, params={"person_id": 999})
      assert unknown.status_code == 404
      assert unknown.json()["detail"] == "person not found"

      # A real person with an empty timeline never borrows somebody else's profile.
      empty = await auth_client.get(BREAKDOWN, params={"person_id": partner.id})
      assert empty.status_code == 404
      assert empty.json()["detail"] == "no paycheck profiles"

      huge = await auth_client.get(BREAKDOWN, params={"person_id": 99999999999})
      assert huge.status_code == 422


  async def test_breakdown_profile_id_wins_over_person_id(auth_client, db, me):
      # An explicit ROW is explicit: person_id only names whose profile in force to pick,
      # and there is nothing to pick once the row itself is named.
      partner = Person(name="Partner")
      db.add(partner)
      await db.commit()
      mine = await create_profile(auth_client)
      body = (
          await auth_client.get(
              BREAKDOWN, params={"profile_id": mine["id"], "person_id": partner.id}
          )
      ).json()
      assert body["profile"]["id"] == mine["id"]
      assert body["profile"]["person_id"] == me.id
  ```

- [ ] **3.2 — Run and confirm the failure.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py -q -k "person_and_defaults or unknown_person_and_an_empty or profile_id_wins"
  ```
  Expected: `test_breakdown_takes_a_person_and_defaults_to_the_primary` fails on `assert 1 == 2` (the unknown `person_id` query param is ignored, so the primary's profile comes back for the partner); `test_breakdown_404s_an_unknown_person_and_an_empty_timeline` fails on `assert 200 == 404`.

- [ ] **3.3 — Implement.** In `backend/app/api/paycheck.py`, replace `_default_profile` (`:233-265`) with:
  ```python
  async def _default_profile(
      db: AsyncSession, person_id: int, today: date
  ) -> PaycheckProfile | None:
      """THIS PERSON's profile in force: their latest one effective today or earlier.

      A brand-new user only has a FUTURE profile (the raise lands next month), so rather
      than 404 on a table that is not empty, fall back to the earliest future one — the
      page then models the check that is coming.

      One profile in force PER PERSON, and the timelines never mix: a partner whose first
      profile starts next year does not borrow the primary's current one. `today` is a
      parameter, never a clock read — see the module docstring.
      """
      current = (
          (
              await db.execute(
                  select(PaycheckProfile)
                  .where(
                      PaycheckProfile.person_id == person_id,
                      PaycheckProfile.effective_date <= today,
                  )
                  .order_by(PaycheckProfile.effective_date.desc())
                  .limit(1)
              )
          )
          .scalars()
          .first()
      )
      if current is not None:
          return current
      return (
          (
              await db.execute(
                  select(PaycheckProfile)
                  .where(
                      PaycheckProfile.person_id == person_id,
                      PaycheckProfile.effective_date > today,
                  )
                  .order_by(PaycheckProfile.effective_date)
                  .limit(1)
              )
          )
          .scalars()
          .first()
      )
  ```
  and replace the head of `get_breakdown` (`:268-277`) with:
  ```python
  @router.get("/breakdown", response_model=BreakdownOut)
  async def get_breakdown(
      profile_id: IdQuery = None,
      person_id: IdQuery = None,
      db: AsyncSession = Depends(get_db),
  ) -> BreakdownOut:
      if profile_id is not None:
          # An explicit row wins outright: `person_id` only names WHOSE profile in force to
          # pick, and there is nothing to pick when the row itself is named.
          profile = await _get_profile(db, profile_id)
      else:
          owner = await _resolve_person_id(db, person_id)  # absent = the primary person
          profile = (
              None
              if owner is None
              else await _default_profile(db, owner, date.today())  # the ONLY clock read here
          )
          if profile is None:
              # Also the roster-less answer: person_id is NOT NULL, so a database with no
              # people has no profiles either — the legacy 404, word for word.
              raise HTTPException(status_code=404, detail="no paycheck profiles")
  ```
  Everything below (`:279` onward — the `pay_periods_per_year` stored-data guard, the lines, the warnings, the `BreakdownOut`) is unchanged.

- [ ] **3.4 — Run to green.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py tests/test_withholding_api.py -q
  ```
  Expected: all pass, including `test_breakdown_404_when_nothing_is_stored` (roster-less → the same 404) and `test_breakdown_degrades_on_a_stored_zero_pay_period_count` (the default branch still resolves to the hand-written row and still 422s).

- [ ] **3.5 — Commit.**
  ```
  git add backend/app/api/paycheck.py backend/tests/test_paycheck_comp_api.py
  git commit -m "feat(paycheck): breakdown takes a person, profile-in-force is per person"
  ```

---

## Task 4 — `hsa_coverage` on the profile

**Files:**
- `backend/alembic/versions/20260827_0901_a2c6b8d40f19_paycheck_profile_hsa_coverage.py` (new)
- `backend/app/models/comp.py` (`PaycheckProfile`, after `hsa_per_check`)
- `backend/app/schemas/paycheck.py` (`ProfileIn`, `ProfileUpdate`, `ProfileOut`)
- `backend/app/api/paycheck.py` (constants `:63-74`, `_validated_profile` `:104-129`, `create_profile`, `update_profile`)
- `backend/tests/test_paycheck_comp_api.py` (new tests after `test_patch_profile_never_changes_the_owner`, added in Task 1)

### Steps

- [ ] **4.1 — Failing tests.** Append to the paycheck API section of `backend/tests/test_paycheck_comp_api.py`:
  ```python
  async def test_hsa_coverage_defaults_to_self_and_round_trips(auth_client, me):
      created = await create_profile(auth_client)
      assert created["hsa_coverage"] == "self"

      patched = await auth_client.patch(
          f"{PROFILES}/{created['id']}", json={"hsa_coverage": "family"}
      )
      assert patched.status_code == 200, patched.text
      assert patched.json()["hsa_coverage"] == "family"
      assert (await auth_client.get(PROFILES)).json()[0]["hsa_coverage"] == "family"
      assert (await auth_client.get(BREAKDOWN)).json()["profile"]["hsa_coverage"] == "family"

      # The house PATCH convention: an explicit null on a NOT NULL column is a no-op.
      kept = await auth_client.patch(f"{PROFILES}/{created['id']}", json={"hsa_coverage": None})
      assert kept.json()["hsa_coverage"] == "family"


  @pytest.mark.parametrize("coverage", ["none", "self", "family"])
  async def test_hsa_coverage_accepts_every_tier(auth_client, me, coverage):
      created = await create_profile(auth_client, hsa_coverage=coverage)
      assert created["hsa_coverage"] == coverage


  async def test_hsa_coverage_rejects_anything_else(auth_client, me):
      resp = await auth_client.post(PROFILES, json=profile_payload(hsa_coverage="HDHP"))
      assert resp.status_code == 422
      assert resp.json()["detail"] == "hsa_coverage must be 'none', 'self' or 'family'"
      # A PATCH validates the MERGED row, so it refuses in the same words — and casing is
      # not a near-miss the writer forgives.
      created = await create_profile(auth_client)
      bad = await auth_client.patch(f"{PROFILES}/{created['id']}", json={"hsa_coverage": "Self"})
      assert bad.status_code == 422
      assert bad.json()["detail"] == "hsa_coverage must be 'none', 'self' or 'family'"
  ```

- [ ] **4.2 — Run and confirm the failure.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py -q -k hsa_coverage
  ```
  Expected: `KeyError: 'hsa_coverage'` on the round-trip and tier tests; `assert 201 == 422` on the rejection test.

- [ ] **4.3 — Model.** In `backend/app/models/comp.py`, insert one column into `PaycheckProfile`, between `hsa_per_check` and `notes`:
  ```python
      hsa_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
      # 'none' | 'self' | 'family' — which HSA cap applies to this person (Plan 4's limit
      # registry reads it). Python-validated by api/paycheck.py rather than a DB enum or
      # CHECK (rsu_grants.kind's posture): the vocabulary is the app's, and a constraint
      # would need a migration every time it grew. The server_default is repeated from the
      # migration so `alembic check` stays clean (rsu_grants.vest_quantum's precedent).
      hsa_coverage: Mapped[str] = mapped_column(String(10), default="self", server_default="self")
      notes: Mapped[str | None] = mapped_column(Text)
  ```

- [ ] **4.4 — Schemas.** In `backend/app/schemas/paycheck.py`, add one line to each class:
  - `ProfileIn`, after `hsa_per_check`:
    ```python
      hsa_per_check: Decimal = Decimal("0")
      # 'none' | 'self' | 'family'; the default matches the column's server_default, so an
      # old client that never sends it stores exactly what the migration backfilled.
      hsa_coverage: str = "self"
      notes: str | None = None
    ```
  - `ProfileUpdate`, after `hsa_per_check`:
    ```python
      hsa_per_check: Decimal | None = None
      hsa_coverage: str | None = None
      notes: str | None = None
    ```
  - `ProfileOut`, after `hsa_per_check`:
    ```python
      hsa_per_check: Decimal
      hsa_coverage: str
      notes: str | None
    ```

- [ ] **4.5 — Router.** In `backend/app/api/paycheck.py`, add the vocabulary beside `CONTRIBUTION_FIELDS` (`:71-74`):
  ```python
  CONTRIBUTIONS_WARNING = "contribution percentages exceed 100%"
  NEGATIVE_NET_WARNING = "net pay is negative"
  # Which HSA cap applies to this person. One tuple, one message — the message names the
  # whole vocabulary, so it never needs reading alongside the code (comp.py's GRANT_KINDS).
  HSA_COVERAGES = ("none", "self", "family")
  HSA_COVERAGE_MESSAGE = "hsa_coverage must be 'none', 'self' or 'family'"
  NO_PRIMARY_PERSON_MESSAGE = "household has no primary person"
  ```
  Add the validator beside the other field validators (after `_validated_pct`, `:101`):
  ```python
  def _validated_coverage(value: str) -> str:
      if value not in HSA_COVERAGES:
          raise HTTPException(status_code=422, detail=HSA_COVERAGE_MESSAGE)
      return value
  ```
  Replace `_validated_profile` (`:104-129`) with:
  ```python
  def _validated_profile(
      effective_date: date,
      annual_salary: Decimal,
      pay_periods_per_year: int,
      dental_vision_per_check: Decimal,
      hsa_per_check: Decimal,
      hsa_coverage: str,
      pcts: dict[str, Decimal],
  ) -> dict:
      """One profile's stored columns, validated as a WHOLE row (Plan 4 house law) so a
      PATCH can hand over the merged values and get the same rules as a POST.

      Raises before it returns anything, so a rejected request leaves no partial state.
      """
      require_reasonable_date(effective_date, "effective_date")
      if not MIN_PAY_PERIODS <= pay_periods_per_year <= MAX_PAY_PERIODS:
          raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)
      return {
          "effective_date": effective_date,
          "annual_salary": _positive_salary(annual_salary, "annual_salary"),
          "pay_periods_per_year": pay_periods_per_year,
          "dental_vision_per_check": _non_negative_per_check(
              dental_vision_per_check, "dental_vision_per_check"
          ),
          "hsa_per_check": _non_negative_per_check(hsa_per_check, "hsa_per_check"),
          "hsa_coverage": _validated_coverage(hsa_coverage),
          **{name: _validated_pct(pcts[name], name) for name in PCT_FIELDS},
      }
  ```
  In `create_profile`, add one argument to the call:
  ```python
          hsa_per_check=body.hsa_per_check,
          hsa_coverage=body.hsa_coverage,
          pcts={name: getattr(body, name) for name in PCT_FIELDS},
  ```
  In `update_profile`, add one merged argument:
  ```python
          hsa_per_check=_merged(provided, "hsa_per_check", profile.hsa_per_check),
          hsa_coverage=_merged(provided, "hsa_coverage", profile.hsa_coverage),
          pcts={name: _merged(provided, name, getattr(profile, name)) for name in PCT_FIELDS},
  ```

- [ ] **4.6 — Migration B.** Create `backend/alembic/versions/20260827_0901_a2c6b8d40f19_paycheck_profile_hsa_coverage.py`:
  ```python
  """paycheck profile hsa coverage

  `paycheck_profiles.hsa_coverage` — 'none' | 'self' | 'family', which HSA cap applies to
  this person (2026-08-27 spec §3.2). NOT NULL with server_default 'self': every existing
  profile is the primary's single-coverage HDHP until the user says otherwise in the form,
  which is the honest default for a household that has only ever had one earner.

  Validated in Python (api/paycheck.py's HSA_COVERAGES), not by a CHECK constraint — the
  vocabulary is the app's and later batches may grow it without a migration. The model
  repeats the server_default so `alembic check` stays clean.

  Revision ID: a2c6b8d40f19
  Revises: d4f9a1c8e307
  Create Date: 2026-08-27 09:01:00.000000

  """

  from collections.abc import Sequence

  import sqlalchemy as sa

  from alembic import op

  # revision identifiers, used by Alembic.
  revision: str = "a2c6b8d40f19"
  down_revision: str | Sequence[str] | None = "d4f9a1c8e307"
  branch_labels: str | Sequence[str] | None = None
  depends_on: str | Sequence[str] | None = None


  def upgrade() -> None:
      """Upgrade schema."""
      op.add_column(
          "paycheck_profiles",
          sa.Column(
              "hsa_coverage",
              sa.String(length=10),
              server_default="self",
              nullable=False,
          ),
      )


  def downgrade() -> None:
      """Downgrade schema."""
      op.drop_column("paycheck_profiles", "hsa_coverage")
  ```

- [ ] **4.7 — Verify ONE head.**
  ```
  .venv/Scripts/python.exe -m alembic heads
  ```
  Expected: exactly one line, `a2c6b8d40f19 (head)`.

- [ ] **4.8 — Run to green.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py tests/test_models_comp.py -q
  ```
  Expected: all pass. `test_profiles_crud_roundtrip` and the other whole-row pins assert key by key, so the new field needs no edits there.

- [ ] **4.9 — Commit.**
  ```
  git add backend/app/models/comp.py backend/app/schemas/paycheck.py backend/app/api/paycheck.py backend/alembic/versions/20260827_0901_a2c6b8d40f19_paycheck_profile_hsa_coverage.py backend/tests/test_paycheck_comp_api.py
  git commit -m "feat(paycheck): hsa_coverage tier on the profile"
  ```

---

## Task 5 — Each tax-input person column suggests THAT person's in-force salary

**Context you must read before writing code:** `api/taxes.py:_inputs_payload` (`:343-403`) builds **one suggestion map per person column** — `suggestions = {column: derive_suggestions(year, household | values, filing_status) ...}` at `:369-372` — and an item reads `suggestions[column if definition.is_per_person else columns[0]]` at `:390`. `derive_suggestions` (`services/tax_service.py:569-650`) is pure and computes the derived-W2 chain from **stored tax-input rows**: `gross_paycheck = annual_salary / 24`, `latest_w2_income = pay_periods × gross_paycheck`. The head of that chain, **`annual_salary`, has no formula and therefore no suggestion at all today** (pinned: `tests/test_taxes_api.py:209` asserts `items["annual_salary"]["suggested"] is None`).

That head is exactly what a paycheck profile knows. This task sources it per column from that person's profile in force, and leaves everything downstream of it untouched — `gross_paycheck` keeps dividing the *stored* `annual_salary` by the hardcoded 24, so every existing golden (`"6750.0000"` at `:219`, `"144000.0000"`/`"96000.0000"` at `:1310-1311`) is byte-identical. A person with no profile gets no suggestion, which is today's behavior for every column.

**Files:**
- `backend/app/api/taxes.py` (`_inputs_payload` `:343-403`; the cross-router import at `:38`; the `tax_service` import block `:97-107`)
- `backend/tests/test_taxes_api.py` (imports `:12` and `:18-28`; new tests after `test_suggestions_are_computed_per_column` `:1286-1313`)

### Steps

- [ ] **5.1 — Failing tests.** In `backend/tests/test_taxes_api.py`, widen two imports:
  ```python
  from datetime import UTC, date, datetime, timedelta
  ```
  ```python
  from app.models import (
      EsppLot,
      LatestPrice,
      PaycheckProfile,
      Person,
      PositionTransaction,
      Security,
      TaxBracket,
      TaxInput,
      TaxInputDefinition,
      TaxYear,
  )
  ```
  Then append after `test_suggestions_are_computed_per_column` (`:1313`):
  ```python
  async def test_annual_salary_suggests_each_persons_in_force_profile(
      auth_client, db, household, definitions
  ):
      """The head of the derived-W2 chain has no sheet formula — but a person with a
      paycheck profile has already told the app their salary, so the Taxes page offers it
      instead of asking twice (spec §4.1). One profile in force PER PERSON."""
      me, partner = household
      today = date.today()
      db.add_all(
          [
              PaycheckProfile(
                  person_id=me.id,
                  effective_date=today - timedelta(days=800),
                  annual_salary=Decimal("150000.00"),
              ),
              PaycheckProfile(
                  person_id=me.id,
                  effective_date=today - timedelta(days=30),
                  annual_salary=Decimal("188930.00"),
              ),
              PaycheckProfile(
                  person_id=partner.id,
                  effective_date=today - timedelta(days=30),
                  annual_salary=Decimal("96000.00"),
              ),
          ]
      )
      await db.commit()
      await put_inputs(auth_client, 2026, {})
      await set_status(auth_client, 2026, "married_joint")

      body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
      suggested = {
          (item["key"], item["person_id"]): item["suggested"]
          for section in body["sections"]
          for item in section["items"]
      }
      # The LATER profile, at the suggestion scale (4dp) every other suggestion uses.
      assert suggested[("annual_salary", me.id)] == "188930.0000"
      assert suggested[("annual_salary", partner.id)] == "96000.0000"
      # Downstream of the head is untouched: gross_paycheck still divides the STORED value,
      # which is null here, so it keeps suggesting the empty-cell zero.
      assert suggested[("gross_paycheck", me.id)] == "0.0000"


  async def test_annual_salary_has_no_suggestion_without_a_profile(
      auth_client, db, household, definitions
  ):
      me, partner = household
      db.add(
          PaycheckProfile(
              person_id=me.id,
              effective_date=date.today() - timedelta(days=30),
              annual_salary=Decimal("188930.00"),
          )
      )
      await db.commit()
      await put_inputs(auth_client, 2026, {})
      await set_status(auth_client, 2026, "married_joint")

      body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
      suggested = {
          (item["key"], item["person_id"]): item["suggested"]
          for section in body["sections"]
          for item in section["items"]
      }
      assert suggested[("annual_salary", me.id)] == "188930.0000"
      # Nothing is invented for a person the app has no paycheck for.
      assert suggested[("annual_salary", partner.id)] is None
  ```

- [ ] **5.2 — Run and confirm the failure.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q -k annual_salary_suggest
  ```
  Expected: both fail on `assert None == '188930.0000'`.

- [ ] **5.3 — Implement.** In `backend/app/api/taxes.py`, widen the cross-router import at `:38`:
  ```python
  from app.api.paycheck import (
      MAX_PAY_PERIODS,
      MIN_PAY_PERIODS,
      PAY_PERIODS_MESSAGE,
      _default_profile,
  )
  ```
  and add `SUGGESTION_QUANTUM` to the `tax_service` import block (`:97-107`, alphabetical within the parentheses):
  ```python
  from app.services.tax_service import (
      JURISDICTION_WARN_MISSING,
      SUGGESTION_QUANTUM,
      Bracket,
      EarnerWages,
      JurisdictionResult,
      TaxBreakdown,
      compute_breakdown,
      derive_suggestions,
      earner_from_inputs,
      shift_earners,
  )
  ```
  Add the helper immediately above `_inputs_payload` (`:343`):
  ```python
  async def _profile_salaries(
      db: AsyncSession, columns: list[int | None], today: date
  ) -> dict[int, Decimal]:
      """Each person column's annual salary from THEIR paycheck profile in force, or no
      entry at all for a person who has none.

      `_default_profile` is the paycheck router's own "profile in force" rule, borrowed
      rather than re-derived (this module's cross-router note): the Paycheck page and the
      Taxes page must never disagree about which profile is current, which is also why the
      clock read here is `date.today()` — the same one that router reads. One query per
      person on a household of two or three.
      """
      salaries: dict[int, Decimal] = {}
      for column in columns:
          if column is None:
              continue  # the roster-less column: no person, so no profile can exist
          profile = await _default_profile(db, column, today)
          if profile is not None:
              salaries[column] = profile.annual_salary.quantize(
                  SUGGESTION_QUANTUM, rounding=ROUND_HALF_UP
              )
      return salaries
  ```
  Then, inside `_inputs_payload`, insert the overlay directly after the `suggestions = {...}` comprehension (`:369-372`), before `by_section` is built:
  ```python
      suggestions = {
          column: derive_suggestions(year, household | values, filing_status)
          for column, values in owned.items()
      }
      # The HEAD of the derived-W2 chain. `annual_salary` has no sheet formula, so
      # derive_suggestions never offers one — but a person with a paycheck profile in force
      # has already told the app their salary, and this page should offer it rather than ask
      # twice (2026-08-27 spec §4.1). Per column, from THAT person's profile: a column whose
      # person has none keeps today's empty suggestion, and nothing downstream moves, because
      # gross_paycheck still divides the STORED annual_salary.
      for column, salary in (await _profile_salaries(db, columns, date.today())).items():
          suggestions[column][ANNUAL_SALARY_KEY] = salary
  ```
  Add the key constant at the end of the module's constants block, directly after `RATE_MAX_ABS` (`:143-145`):
  ```python
  # Above this the ratio is nonsense anyway (near-zero denominator), and quantize_pct would
  # need more digits than the Decimal context has.
  RATE_MAX_ABS = Decimal("1e12")
  # Spelled once: the ONE per-person key whose suggestion comes from outside tax_inputs.
  ANNUAL_SALARY_KEY = "annual_salary"
  ```

- [ ] **5.4 — Run to green.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py tests/test_tax_service.py tests/test_tax_service_married.py -q
  ```
  Expected: all pass — including `tests/test_taxes_api.py:189` (`suggested is None` for `annual_salary` on a database with no profiles), `:212` (the `"6750.0000"` gross_paycheck golden), and `:1286` (the per-column `latest_w2_income` pins).

- [ ] **5.5 — Commit.**
  ```
  git add backend/app/api/taxes.py backend/tests/test_taxes_api.py
  git commit -m "feat(paycheck): annual-salary tax suggestion from each person's profile in force"
  ```

---

## Task 6 — Pin the contracts: byte-identity, single head, full gates

Nothing new is implemented here. This task writes the pins other plans will rely on, and proves the whole suite is green.

**Files:**
- `backend/tests/test_paycheck_comp_api.py` (append to the paycheck API section)
- `backend/tests/test_importer_apply.py` (no change — the immunity pin landed in Task 2)

### Steps

- [ ] **6.1 — Write the byte-identity pins.** Append to `backend/tests/test_paycheck_comp_api.py`:
  ```python
  async def test_a_primary_only_database_answers_exactly_as_it_did_before_people(
      auth_client, db, me
  ):
      """The legacy wire, pinned. A one-person household is what every existing deployment
      is, and its two read endpoints must answer character for character as they did before
      profiles had owners — the only difference being the two additive fields."""
      await create_profile(auth_client, effective_date="2025-01-01", annual_salary="162000")
      await create_profile(auth_client)

      listed = (await auth_client.get(PROFILES)).json()
      assert [row["effective_date"] for row in listed] == ["2026-01-01", "2025-01-01"]
      assert {row["person_id"] for row in listed} == {me.id}
      assert {row["hsa_coverage"] for row in listed} == {"self"}
      # Additive ONLY: the row is the old row plus exactly two keys.
      assert set(listed[0]) == {
          "id",
          "person_id",
          "effective_date",
          "annual_salary",
          "pay_periods_per_year",
          "trad_401k_pct",
          "roth_401k_pct",
          "after_tax_401k_pct",
          "espp_pct",
          "withholding_pct",
          "dental_vision_per_check",
          "hsa_per_check",
          "hsa_coverage",
          "notes",
      }

      # No params at all = the primary's profile in force, the pre-P3 call verbatim.
      legacy = (await auth_client.get(BREAKDOWN)).json()
      assert legacy["profile"]["effective_date"] == "2026-01-01"
      assert legacy["gross"] == "7872.08"
      assert legacy["net_pay"] == "3384.16"
      assert legacy["warnings"] == []
      # ... and naming the primary explicitly changes nothing.
      assert (await auth_client.get(BREAKDOWN, params={"person_id": me.id})).json() == legacy


  async def test_a_partner_timeline_is_independent_end_to_end(auth_client, db, me):
      """One household, two timelines that never touch: same dates, own 409s, own
      profile-in-force, and a delete on one leaves the other alone."""
      partner = Person(name="Partner")
      db.add(partner)
      await db.commit()

      mine_old = await create_profile(auth_client, effective_date="2025-01-01")
      theirs_old = await create_profile(
          auth_client, person_id=partner.id, effective_date="2025-01-01", annual_salary="80000"
      )
      theirs_new = await create_profile(
          auth_client, person_id=partner.id, annual_salary="96000"
      )
      assert mine_old["id"] != theirs_old["id"]

      # One ordered list for the whole household; the UI groups it by person.
      listed = (await auth_client.get(PROFILES)).json()
      assert len(listed) == 3
      assert [row["effective_date"] for row in listed] == [
          "2026-01-01",
          "2025-01-01",
          "2025-01-01",
      ]

      assert (await auth_client.delete(f"{PROFILES}/{theirs_new['id']}")).status_code == 204
      remaining = {row["id"] for row in (await auth_client.get(PROFILES)).json()}
      assert remaining == {mine_old["id"], theirs_old["id"]}
      assert await db.get(PaycheckProfile, mine_old["id"]) is not None
  ```

- [ ] **6.2 — Run the new pins.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py -q -k "primary_only_database or partner_timeline_is_independent"
  ```
  Expected: both pass on the first run — they describe behavior Tasks 1-4 already built. If either fails, the failure is a real contract gap; fix the router, not the test.

- [ ] **6.3 — Single-head verification, one last time.**
  ```
  .venv/Scripts/python.exe -m alembic heads
  ```
  Expected: exactly one line, `a2c6b8d40f19 (head)`. Two migration files exist and chain `e26b9d70a4c1 → d4f9a1c8e307 → a2c6b8d40f19`. **Do not run `upgrade`** — the orchestrator applies these at merge.

- [ ] **6.4 — Full backend suite + lint.**
  ```
  FINANCE_TEST_DB=finance_test_p3profiles .venv/Scripts/python.exe -m pytest -q
  .venv/Scripts/python.exe -m ruff check app tests alembic
  ```
  Expected: **1060 passed** (1042 baseline + 18 new: 1 model uniqueness, 4 CRUD/owner, 1 importer immunity, 3 breakdown-person, 5 hsa_coverage (one is parametrized ×3), 2 suggestion, 2 byte-identity), 0 failed, ruff clean. Record the real number from the run; if it is not 1060, an expected test did not land.

- [ ] **6.5 — Frontend suite is untouched but must still be green** (this plan changes no `src/` file; the check is that nothing else drifted). From the repo root:
  ```
  npm run test -- --run
  ```
  Expected: 1168 passed.

- [ ] **6.6 — Commit.**
  ```
  git add backend/tests/test_paycheck_comp_api.py
  git commit -m "feat(paycheck): pin the person-scoped profile contracts (byte-identity + single alembic head)"
  ```

---

## Pinned contracts — what the other three P3 plans may rely on

These are exact. Plans 2-4 were written against them; changing any of them means amending those plans too.

| Contract | Exact shape |
|---|---|
| Absent person param | Resolves to the **primary person**, everywhere on the paycheck router. `_resolve_person_id(db, None)` returns the primary's id, or `None` only on a roster-less database. |
| Profile in force | `await _default_profile(db, person_id, today)` → `PaycheckProfile | None`. **Three positional arguments** — `today` is a parameter, never a clock read inside (the spec's `_default_profile(db, person_id)` shorthand omits it; the module's "`date.today()` is read HERE and only here" rule requires it). Latest profile effective ≤ `today` for THAT person; else their earliest future one; else `None`. |
| Breakdown | `GET /api/v1/paycheck/breakdown?profile_id=&person_id=` — both optional, both int4-fenced. `profile_id` wins outright. Absent `person_id` = primary. Unknown person → 404 `"person not found"`. Known person with no profile → 404 `"no paycheck profiles"`. |
| Profile rows | `ProfileOut` carries `person_id: int` (always populated) and `hsa_coverage: str` (`'none' | 'self' | 'family'`), on top of the pre-P3 fields, which are unchanged. |
| Profile list | `GET /paycheck/profiles` takes **no** person param and returns ONE list ordered `effective_date DESC, id ASC`. |
| Create | `POST /paycheck/profiles` accepts optional `person_id` (default primary, `ge=1, le=2**31-1`), 404s an unknown person, 422s `"household has no primary person"` on a roster-less database. |
| 409 | `_require_free_effective_date(db, person_id, effective_date)` — scoped to the owner; message unchanged: `f"a paycheck profile for {effective_date} already exists"`. |
| Owner is immutable | `ProfileUpdate` has no `person_id`; a body carrying one is silently ignored. |
| Importer | `apply_paycheck` reads AND writes only `person_id == primary.id`; partner profiles are import-immune; a roster-less database gets the warning `"Paycheck Modeler: the household has no primary person — profile not imported"` and no write. |
| Suggestions | Each per-person tax-input column's `annual_salary.suggested` is that person's in-force `annual_salary` at 4dp, or `null` when they have no profile. Every other suggestion, including the whole `gross_paycheck`/`latest_w2_income` chain, is unchanged. |
| Migrations | `e26b9d70a4c1 → d4f9a1c8e307` (person scope) `→ a2c6b8d40f19` (hsa_coverage). Head after this plan: `a2c6b8d40f19`. |

## Out of scope — deliberately not done here

- `gross_paycheck` still divides the **stored** `annual_salary` by the hardcoded `PAYCHECKS_PER_YEAR = 24` rather than by the profile's `pay_periods_per_year`. Sourcing it from the profile would move the `"6750.0000"` golden and the two `latest_w2_income` married pins; the spec's standing fact is that both earners are semi-monthly, so there is nothing to gain and a golden to lose.
- `api/calendar.py:132` still takes "the latest profile" household-wide — per-person paydays are Plan 2.
- `api/taxes.py`'s withholding endpoint (`:1070-1080`) still loads **every** profile into `withholding_calc.estimate` — the simulated partner leg is Plan 2.
- No frontend file is touched; `person_id` / `hsa_coverage` are additive JSON fields that the current TypeScript types simply do not name yet (Plan 3 adds them).
- No `alembic upgrade` is run and nothing is pushed.
