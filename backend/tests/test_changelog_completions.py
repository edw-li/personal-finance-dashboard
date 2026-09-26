"""The spending and net-worth routes that were already logged, completed (2026-09-25 polish
spec §6.1): every one now answers X-Change-Batch, and the two deletes image what hangs off the
row they remove — a category's budget history and reward-category links, an account's
components and card links — so an Undo restores those too."""

from tests.exact_undo import logged

NW = "/api/v1/net-worth"
SP = "/api/v1/spending"


async def test_account_and_category_writes_answer_their_batch(auth_client, db):
    async def named(resp, label: str) -> None:
        assert resp.status_code in (200, 201), resp.text
        rows = await logged(db, resp.headers["x-change-batch"])
        assert rows and {row.label for row in rows} == {label}

    account = await auth_client.post(
        f"{NW}/accounts", json={"name": "Brokerage", "group": "taxable"}
    )
    await named(account, "Created account Brokerage")
    account_path = f"{NW}/accounts/{account.json()['id']}"
    retire = {"is_active": False}
    await named(await auth_client.patch(account_path, json=retire), "Updated account Brokerage")
    category = await auth_client.post(f"{SP}/categories", json={"name": "Dining"})
    await named(category, "Created category Dining")
    category_path = f"{SP}/categories/{category.json()['id']}"
    kind = {"kind": "transfer"}
    await named(await auth_client.patch(category_path, json=kind), "Updated category Dining")
    budget = {"amount": "400.00", "effective_month": "2026-09-01"}
    await named(
        await auth_client.put(f"{category_path}/budget", json=budget),
        "Set Dining budget from Sep 2026",
    )
    # A write that changes nothing names no batch, so the client offers no Undo.
    for resp in (
        await auth_client.patch(account_path, json=retire),
        await auth_client.patch(category_path, json=kind),
        await auth_client.put(f"{category_path}/budget", json=budget),
    ):
        assert resp.status_code == 200 and "x-change-batch" not in resp.headers
