"""Route placement for the reorder PUTs (2026-09-23 drag-to-reorder spec §3.2): each
`…/order` path is declared BEFORE its router's `/{id}` routes, so a PUT on `/{id}` added
later can never shadow it (routes match in declaration order). Read off each module's own
router: the app mounts routers lazily, so `app.routes` is not a flat list."""

import pytest
from fastapi.routing import APIRoute

from app.api import net_worth

ORDER_ROUTES = ((net_worth.router, "/net-worth/accounts/order"),)


@pytest.mark.parametrize(("router", "path"), ORDER_ROUTES, ids=[path for _, path in ORDER_ROUTES])
def test_each_order_route_is_a_put_declared_before_its_id_routes(router, path):
    routes = [route for route in router.routes if isinstance(route, APIRoute)]
    [order_index] = [index for index, route in enumerate(routes) if route.path == path]
    assert routes[order_index].methods == {"PUT"}
    prefix = path.removesuffix("/order") + "/{"
    id_indexes = [index for index, route in enumerate(routes) if route.path.startswith(prefix)]
    assert id_indexes, "no /{id} routes found — the pin would pin nothing"
    assert order_index < min(id_indexes)
