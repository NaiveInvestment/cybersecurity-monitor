import importlib.util
from pathlib import Path
import unittest

file = Path(__file__).resolve().parents[1] / "scripts" / "translate-headlines.py"
spec = importlib.util.spec_from_file_location("headline_translation", file)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class HeadlineQuantities(unittest.TestCase):
    def test_currency_magnitude_and_record_counts(self):
        for source, expected in [
            ("$6.3 billion", "63억 달러"), ("$6.43B", "64.3억 달러"),
            ("$6.5bn", "65억 달러"), ("1.2mn records", "120만"),
            ("1.6m patients", "160만"), ("£750,000", "75만 파운드"),
            ("192 cryptocurrencies", "192"), ("11 networks", "11"),
        ]:
            with self.subTest(source=source):
                parts = worker.protect_quantities(source)
                self.assertEqual(parts[1][2], expected)
                self.assertEqual(worker.restore_quantities(parts, "796,001"), expected)
                self.assertIsNone(worker.restore_quantities(parts, "누락"))

    def test_multiple_units_and_product_versions(self):
        parts = worker.protect_quantities("Gets 6 years in $11.6M case on Windows 11")
        self.assertEqual(worker.restore_quantities(parts, "796002 달러 사건 796001년"),
                         "1,160만 달러 사건 6년")
        self.assertTrue(worker.masked_text(parts).endswith("Windows 11"))
