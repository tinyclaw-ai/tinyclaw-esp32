from pathlib import Path
import subprocess
import tempfile
import unittest


HOOKS = Path(__file__).resolve().parents[2] / '.githooks'


class ReferenceTransactionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Branch policy test')
        self.git('config', 'user.email', 'branch-policy@example.invalid')
        self.git('commit', '--allow-empty', '-m', 'seed')
        self.git('config', 'core.hooksPath', str(HOOKS))

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args, check=True):
        return subprocess.run(['git', '-C', str(self.root), *args], check=check, capture_output=True, text=True)

    def test_allowed_branches_and_main_commit(self):
        for name in ['dev', 'feature/topic', 'feature/team/topic', 'fix/bug', 'fix/team/bug']:
            self.git('branch', name)
        self.git('commit', '--allow-empty', '-m', 'valid main update')

    def test_invalid_creations_are_rejected(self):
        for name in ['release/v1', 'master', 'hotfix/bug', 'feature', 'fix', 'dev/topic']:
            with self.subTest(name=name):
                result = self.git('branch', name, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('branch policy', result.stderr)
                self.assertNotEqual(self.git('show-ref', '--verify', '--quiet', 'refs/heads/' + name, check=False).returncode, 0)

    def test_existing_invalid_branch_can_be_deleted(self):
        self.git('-c', 'core.hooksPath=/dev/null', 'branch', 'legacy')
        self.git('branch', '-d', 'legacy')

    def test_non_branch_references_are_not_restricted(self):
        self.git('tag', 'v1.0.0')
        self.git('update-ref', 'refs/remotes/origin/release/v1', 'HEAD')


if __name__ == '__main__':
    unittest.main()
