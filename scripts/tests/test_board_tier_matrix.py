import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "board_tier_matrix", ROOT / "scripts" / "gen_board_tier_matrix.py"
)
MATRIX = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MATRIX
SPEC.loader.exec_module(MATRIX)


class BoardTierMatrixTests(unittest.TestCase):
    def test_esp32s31_keeps_its_own_chip_identity_and_standard_features(self):
        chip = MATRIX.detect_chip("IDF_TARGET_ESP32S31")
        self.assertEqual(chip, "ESP32S31")
        self.assertEqual(
            MATRIX.to_tier_and_features(chip),
            MATRIX.to_tier_and_features("ESP32S3"),
        )

    def test_current_board_matrix_covers_all_unique_board_symbols(self):
        entries = MATRIX.parse_board_entries(MATRIX.KCONFIG_PATH.read_text())
        self.assertEqual(len(entries), 161)
        self.assertEqual(len({entry.symbol for entry in entries}), len(entries))
        self.assertNotIn("UNKNOWN", {entry.chip for entry in entries})

    def test_generated_files_match_the_merged_board_configuration(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "gen_board_tier_matrix.py"), "--check"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
