from datetime import date
import unittest

from app.services.dashboard import _project_material_stockout, _scheduled_stock_arrivals


class MaterialDashboardStockRiskTests(unittest.TestCase):
    def test_scheduled_arrival_delays_projected_stockout(self) -> None:
        status, days, stockout_date = _project_material_stockout(
            stock_on_hand=10.0,
            daily_rate=5.0,
            arrivals=[(date(2026, 7, 15), 10.0)],
            today=date(2026, 7, 13),
        )

        self.assertEqual(status, "projected")
        self.assertEqual(days, 4)
        self.assertEqual(stockout_date, date(2026, 7, 17))

    def test_no_consumption_is_not_reported_as_a_stockout(self) -> None:
        self.assertEqual(
            _project_material_stockout(
                stock_on_hand=0.0,
                daily_rate=0.0,
                arrivals=[],
                today=date(2026, 7, 13),
            ),
            ("no_consumption", None, None),
        )

    def test_only_future_dated_pending_orders_count_as_arrivals(self) -> None:
        arrivals = _scheduled_stock_arrivals(
            [
                {"counted_in_pending": True, "pending_quantity": 7, "estimated_delivery": "2026-07-15T00:00:00"},
                {"counted_in_pending": True, "pending_quantity": 4, "estimated_delivery": "2026-07-13"},
                {"counted_in_pending": False, "pending_quantity": 9, "estimated_delivery": "2026-07-16"},
            ],
            today=date(2026, 7, 13),
        )

        self.assertEqual(arrivals, [(date(2026, 7, 15), 7.0)])


if __name__ == "__main__":
    unittest.main()
