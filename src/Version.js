// Single source of truth for the app version (MAJOR.MINOR.PATCH). Shown in the admin console,
// read by p.bat and commit-and-push.bat for the push banner, git tag and GitHub release.
// Keep "version" in package.json equal to it (tests/version.test.js checks this).
const APP_VERSION = '0.2.0';

if (typeof module !== 'undefined') module.exports = { APP_VERSION };
