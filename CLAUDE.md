# moleculer-db-adapter-mongo

`@keletes/moleculer-db-adapter-mongo`: moleculer-db adapter for MongoDB on driver 6.x (port of upstream `moleculer-db-adapter-mongo@0.4.21`). Not a Moleculer service: no `deploy.yml`, no `k8s/`. Design and usage are in `README.md`.

## Shape of this repo (like `@keletes/services-common`)

- **No npm registry.** Consumers install from a git tag: `"@keletes/moleculer-db-adapter-mongo": "git+https://github.com/keletes/moleculer-db-adapter-mongo#vX.Y.Z"`. Public repo, so no `PACKAGES_READ_PAT` anywhere.
- **`dist/` is built and committed by the release commit only** (`@semantic-release/exec` runs `yarn build`, `@semantic-release/git` force-adds `dist/**`). `dist/` is gitignored on purpose: do NOT commit it in PRs. Consumers get compiled output from the tag.
- `yarn.lock` is committed (CI installs with `--frozen-lockfile`).
- `mongodb`, `moleculer`, `moleculer-db` are peer dependencies (also devDependencies for tests).

## Commands

```
yarn verify       # typecheck + lint (no mongod)
yarn test         # jest against a real throwaway mongod (mongodb-memory-server); = verify:int
yarn build        # tsc -> dist/
```

CI (`verify.yml`) runs `verify` plus `test` on ubuntu x64 and ubuntu-24.04-arm; all three are required checks on `main`.

## Gotchas

- **mongod version is pinned in `package.json` `config.mongodbMemoryServer.version`**, read by both mongodb-memory-server's postinstall and `test/pin.ts`/`test/global-setup.ts`. Do not hard-code the version elsewhere. `MONGOMS_VERSION` overrides. `test/tests/mongod-pin.spec.ts` fails if the running mongod is not the pinned version or not built for the host arch. When bumping the pin, check a build exists for `ubuntu-24.04` on both x64 and arm64 (CI runners).
- The CI mongod cache key is `hashFiles('package.json')`; any package.json change re-downloads once.
- Server must be >= 5.0 (dotted field names).
- Behaviour must stay a drop-in for `moleculer-db-adapter-mongo@0.4.21`; the differences are listed in the README and are driver-forced. Don't add opt-in behaviour to the adapter; a versioning/history mixin is a documented future option (README "Design"), not shipped.

## Releases: trunk-based, Conventional Commits

**Every PR title must follow [Conventional Commits](https://www.conventionalcommits.org/)** (`.github/workflows/pr-title.yml`). Squash-merge uses the PR title as the `main` commit message, which `tag.yml` feeds to `semantic-release`:

| Prefix | Effect |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` footer | major |
| `chore:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `ci:`, `build:` | no release |

On a release, semantic-release builds `dist/`, commits `package.json` + `dist/` as `chore(release): X.Y.Z [skip ci]`, tags `vX.Y.Z` and publishes a GitHub Release. **Never bump the version or push a `v*` tag by hand.**

`tag.yml` pushes through branch protection with the GitHub App token (org secrets `DEPLOY_APP_ID`, `DEPLOY_APP_PRIVATE_KEY`; the app must be installed on this repo). Node 22 is required for `yarn install` (semantic-release engines).

## Branching: check merge status first

*Always* check whether the current branch has already been merged into `main` before starting work: `git fetch origin`, `git branch -r --merged origin/main`, `git cherry origin/main`, and (squash merges) `gh pr list --head <branch> --state merged`. If merged, branch from an up-to-date `origin/main`. Every change goes through a feature branch and PR; `main` is protected. After a PR merges, check `main` out and fast-forward it before starting anything else.
