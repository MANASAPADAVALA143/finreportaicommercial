"""Unit tests for product role middleware — uae_suite access rules."""

from __future__ import annotations

import unittest

from app.middleware.product_role_middleware import _path_allowed


class ProductRoleMiddlewareTests(unittest.TestCase):
    def test_uae_suite_ar_routes_allowed(self):
        role = "uae_suite"
        for path in (
            "/api/uae/ar/aging",
            "/api/uae/ar/credit-notes",
            "/api/ar-collections/summary",
            "/api/uae-suite/summary",
            "/api/gulftax/recon/status",
            "/api/ap/aging",
        ):
            self.assertTrue(_path_allowed(role, "accountant", path), path)

    def test_uae_suite_fpa_blocked(self):
        self.assertFalse(_path_allowed("uae_suite", "accountant", "/api/fpa/variance"))
        self.assertFalse(_path_allowed("uae_suite", "accountant", "/api/india/journals"))
        self.assertFalse(_path_allowed("uae_suite", "accountant", "/api/o2c/summary"))
        self.assertFalse(_path_allowed("uae_suite", "accountant", "/api/consolidation/run"))

    def test_uae_client_unchanged_ar_blocked(self):
        self.assertFalse(_path_allowed("uae_client", "accountant", "/api/uae/ar/aging"))
        self.assertTrue(_path_allowed("uae_client", "accountant", "/api/ap/aging"))

    def test_uae_full_o2c_allowed(self):
        self.assertTrue(_path_allowed("uae_full", "accountant", "/api/o2c/summary"))
        self.assertTrue(_path_allowed("uae_full", "accountant", "/api/uae-suite/summary"))


if __name__ == "__main__":
    unittest.main()
