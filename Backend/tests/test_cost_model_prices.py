"""Regression tests for prices disappearing when a quantity save outlives the ERP cache."""
import unittest
from unittest.mock import MagicMock, patch

from app.services import cost_model


class CostModelPriceRetentionTests(unittest.TestCase):
    def setUp(self):
        self.session = MagicMock()
        self.session.scalars.return_value.all.return_value = []
        self.saved_cache = dict(cost_model._live_prices)
        cost_model._live_prices.clear()
        self.addCleanup(self.restore_cache)
        for target, value in [
            ("app.services.cost_model._project_skus", ["VENT0238"]),
            ("app.services.erp.erp_search_available", True),
            ("app.services.cost_model.time.monotonic", cost_model.LIVE_PRICE_TTL_SECONDS + 10),
        ]:
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        cost_model._live_prices["VENT0238"] = (0, 371909.86)

    def restore_cache(self):
        cost_model._live_prices.clear()
        cost_model._live_prices.update(self.saved_cache)

    def prices(self, live):
        return cost_model._load_cost_model_prices(self.session, settings=object(), project_data={}, live=live)

    @patch("app.services.erp._open_connection")
    def test_save_view_keeps_expired_price_and_requests_background_refresh(self, connection):
        prices, pending = self.prices(live=False)
        self.assertEqual(prices["VENT0238"], 371909.86)
        self.assertTrue(pending)
        connection.assert_not_called()

    @patch("app.services.erp._open_connection", side_effect=RuntimeError("ERP unavailable"))
    def test_failed_refresh_keeps_last_known_price_and_reports_pending(self, connection):
        prices, pending = self.prices(live=True)
        self.assertEqual(prices["VENT0238"], 371909.86)
        self.assertTrue(pending)
        self.assertEqual(cost_model._live_prices["VENT0238"], (0, 371909.86))

    @patch("app.services.erp._get_purchase_order_lines_for_products_batch", return_value={"VENT0238": [{"unit_price": 380000}]})
    @patch("app.services.erp._get_average_prices_for_products_batch", return_value={"VENT0238": 0})
    @patch("app.services.erp._open_connection")
    def test_expired_purchase_order_price_gets_refreshed_instead_of_blocking_the_lookup(self, connection, average, orders):
        prices, pending = self.prices(live=True)
        self.assertEqual(prices["VENT0238"], 380000)
        self.assertFalse(pending)
        orders.assert_called_once()
        self.assertEqual(self.prices(live=False), ({"VENT0238": 380000}, False))

    @patch("app.services.erp._get_purchase_order_lines_for_products_batch", return_value={})
    @patch("app.services.erp._get_average_prices_for_products_batch", return_value={"VENT0238": None})
    @patch("app.services.erp._open_connection")
    def test_empty_refresh_does_not_poison_cache_for_the_next_save(self, connection, average, orders):
        self.assertEqual(self.prices(live=True), ({"VENT0238": 371909.86}, True))
        self.assertEqual(self.prices(live=False), ({"VENT0238": 371909.86}, True))


if __name__ == "__main__":
    unittest.main()
