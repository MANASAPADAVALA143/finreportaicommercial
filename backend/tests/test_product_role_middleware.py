"""Product-role middleware path guards — AP-7 security regression.

Access contract for AR API families is derived from ROLE_API_PREFIXES,
ROLE_API_EXCLUSIONS and _path_allowed() in product_role_middleware.py, cross-
checked against frontend ROLE_PATH_PREFIXES where relevant.

Commercial entitlement for uae_full × /api/ar-collections remains an OPEN
decision (middleware comment vs prefixes disagree). Tests pin the *configured*
behaviour for that case and do not treat it as product sign-off.
"""

from __future__ import annotations

import unittest

from app.middleware.product_role_middleware import (
    ROLE_API_EXCLUSIONS,
    ROLE_API_PREFIXES,
    _path_allowed,
)


class ProductRoleMiddlewareTests(unittest.TestCase):
    """Legacy suite-focused cases retained for continuity."""

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


class UaeClientArExclusionsTests(unittest.TestCase):
    """AP-7: uae_client must be denied both AR API families via ROLE_API_EXCLUSIONS."""

    def test_exclusions_table_lists_both_ar_families(self):
        self.assertIn("uae_client", ROLE_API_EXCLUSIONS)
        self.assertEqual(
            ROLE_API_EXCLUSIONS["uae_client"],
            ("/api/uae/ar", "/api/ar-collections"),
        )

    def test_uae_client_denied_exact_uae_ar_prefix(self):
        self.assertFalse(_path_allowed("uae_client", "accountant", "/api/uae/ar"))

    def test_uae_client_denied_uae_ar_subpaths(self):
        for path in (
            "/api/uae/ar/aging",
            "/api/uae/ar/credit-notes",
            "/api/uae/ar/invoices",
            "/api/uae/ar/approve-and-post",
        ):
            self.assertFalse(_path_allowed("uae_client", "accountant", path), path)

    def test_uae_client_denied_exact_ar_collections_prefix(self):
        self.assertFalse(_path_allowed("uae_client", "accountant", "/api/ar-collections"))

    def test_uae_client_denied_ar_collections_subpaths(self):
        for path in (
            "/api/ar-collections/summary",
            "/api/ar-collections/ai-insight",
        ):
            self.assertFalse(_path_allowed("uae_client", "accountant", path), path)

    def test_uae_client_prefix_boundary_archive_not_excluded(self):
        # /api/uae/archive must not match exclusion prefix /api/uae/ar
        self.assertTrue(_path_allowed("uae_client", "accountant", "/api/uae/archive"))
        self.assertTrue(_path_allowed("uae_client", "accountant", "/api/uae/archive/list"))

    def test_uae_client_neighbouring_paths_not_accidentally_excluded(self):
        for path in (
            "/api/uae/journals",
            "/api/uae/coa",
            "/api/uae/area-reports",  # shares letters with "ar" but not /api/uae/ar/
            "/api/ap/aging",
            "/api/gulftax/recon/status",
            "/api/vat/returns",
        ):
            self.assertTrue(_path_allowed("uae_client", "accountant", path), path)


class UaeSuiteArAccessTests(unittest.TestCase):
    """uae_suite explicitly lists both AR families in ROLE_API_PREFIXES."""

    def test_uae_suite_allows_uae_ar_family(self):
        for path in ("/api/uae/ar", "/api/uae/ar/aging", "/api/uae/ar/credit-notes"):
            self.assertTrue(_path_allowed("uae_suite", "accountant", path), path)

    def test_uae_suite_allows_ar_collections_family(self):
        for path in ("/api/ar-collections", "/api/ar-collections/summary"):
            self.assertTrue(_path_allowed("uae_suite", "accountant", path), path)

    def test_uae_suite_prefixes_include_both_ar_families(self):
        prefixes = ROLE_API_PREFIXES["uae_suite"]
        assert prefixes is not None
        self.assertIn("/api/uae/ar", prefixes)
        self.assertIn("/api/ar-collections", prefixes)


class UaeFullArAccessTests(unittest.TestCase):
    """uae_full AR: /api/uae/ar established via /api/uae; ar-collections OPEN decision."""

    def test_uae_full_prefixes_include_uae_not_ar_collections(self):
        prefixes = ROLE_API_PREFIXES["uae_full"]
        assert prefixes is not None
        self.assertIn("/api/uae", prefixes)
        self.assertNotIn("/api/ar-collections", prefixes)
        # Explicit /api/uae/ar is also absent; access relies on /api/uae parent prefix.
        self.assertNotIn("/api/uae/ar", prefixes)

    def test_uae_full_allows_uae_ar_family_via_uae_prefix(self):
        """Established from ROLE_API_PREFIXES: /api/uae covers /api/uae/ar*."""
        for path in ("/api/uae/ar", "/api/uae/ar/aging", "/api/uae/ar/credit-notes"):
            self.assertTrue(_path_allowed("uae_full", "accountant", path), path)

    def test_uae_full_ar_collections_current_config_denied(self):
        """Pins *configured* denial of /api/ar-collections for uae_full.

        OPEN COMMERCIAL DECISION — not product sign-off:
        - ROLE_API_EXCLUSIONS comment says AR is for uae_suite / uae_full.
        - ROLE_API_PREFIXES for uae_full omits /api/ar-collections.
        - Frontend ROLE_PATH_PREFIXES for uae_full omits /cfo/ar-collections.
        Do not change middleware until commercial entitlement is decided.
        """
        for path in ("/api/ar-collections", "/api/ar-collections/summary"):
            self.assertFalse(_path_allowed("uae_full", "accountant", path), path)


class OtherRolesArAccessTests(unittest.TestCase):
    def test_india_client_denied_ar_families(self):
        for path in (
            "/api/uae/ar",
            "/api/uae/ar/aging",
            "/api/ar-collections",
            "/api/ar-collections/summary",
        ):
            self.assertFalse(_path_allowed("india_client", "accountant", path), path)

    def test_fpa_client_denied_ar_families(self):
        for path in (
            "/api/uae/ar",
            "/api/uae/ar/aging",
            "/api/ar-collections",
            "/api/ar-collections/summary",
        ):
            self.assertFalse(_path_allowed("fpa_client", "accountant", path), path)

    def test_full_access_allows_ar_families(self):
        for path in (
            "/api/uae/ar",
            "/api/uae/ar/aging",
            "/api/ar-collections",
            "/api/ar-collections/summary",
        ):
            self.assertTrue(_path_allowed("full_access", "accountant", path), path)

    def test_super_admin_allows_ar_regardless_of_product_role(self):
        for role in ("uae_client", "india_client", "fpa_client"):
            for path in ("/api/uae/ar/aging", "/api/ar-collections/summary"):
                self.assertTrue(_path_allowed(role, "super_admin", path), f"{role} {path}")

    def test_legitimate_non_ar_access_retained(self):
        """Regression: exclusions must not remove intended non-AR APIs."""
        cases = [
            ("uae_client", "/api/ap/aging"),
            ("uae_client", "/api/gulftax/recon/status"),
            ("uae_client", "/api/uae/journals"),
            ("uae_suite", "/api/ap/aging"),
            ("uae_suite", "/api/gulftax/recon/status"),
            ("uae_full", "/api/o2c/summary"),
            ("uae_full", "/api/ap/aging"),
            ("india_client", "/api/india/journals"),
            ("india_client", "/api/ap/aging"),
            ("fpa_client", "/api/fpa/variance"),
            ("full_access", "/api/fpa/variance"),
        ]
        for role, path in cases:
            self.assertTrue(_path_allowed(role, "accountant", path), f"{role} {path}")


if __name__ == "__main__":
    unittest.main()
