# Changesets

Every PR that changes the published package adds a changeset with `pnpm changeset`. On merge to main, the release workflow opens or updates a release PR that bumps the version and writes `CHANGELOG.md`; merging that PR publishes to npm.
