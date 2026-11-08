from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import run  # noqa: E402


class ConformanceEnvTest(unittest.TestCase):
    def test_composer_home_is_pinned_to_the_case_home_for_every_port(self):
        home = Path("/tmp/pmsec-conformance-home")
        for impl in ("bash", "node", "python", "powershell"):
            with self.subTest(impl=impl):
                env = run.env_for(impl, home)
                self.assertEqual(env["COMPOSER_HOME"], str(home / ".config" / "composer"))
                self.assertEqual(env["XDG_CONFIG_HOME"], str(home / ".config"))

    def test_composer_cases_expect_the_pinned_composer_home(self):
        home = Path("/tmp/pmsec-conformance-home")
        expected = (home / ".config" / "composer" / "config.json").as_posix()
        cases = [json.loads(path.read_text()) for path in sorted(run.CASES_DIR.glob("*.json"))]
        composer_rows = [
            row
            for case in cases
            for row in case["expected_json"].get("rows", [])
            if row.get("tool") == "composer"
        ]
        self.assertTrue(composer_rows)
        for row in composer_rows:
            with self.subTest(path=row["path"]):
                self.assertEqual(row["path"].replace("<HOME>", home.as_posix()), expected)

    def test_case_env_expands_home_token(self):
        home = Path("/tmp/pmsec-conformance-home")
        env = run.case_env("node", {"env": {"PMSEC_HOME": "<HOME>", "HOME": "<HOME>/not-home"}}, home)
        self.assertEqual(env["PMSEC_HOME"], str(home))
        self.assertEqual(env["HOME"], str(home / "not-home"))

    def test_impls_limits_a_case_to_the_listed_ports(self):
        self.assertTrue(run.applies_to("powershell", {}))
        self.assertTrue(run.applies_to("bash", {"impls": ["bash", "node"]}))
        self.assertFalse(run.applies_to("powershell", {"impls": ["bash", "node"]}))


if __name__ == "__main__":
    unittest.main()
