# @keletes/moleculer-db-adapter-mongo

[moleculer-db](https://github.com/moleculerjs/moleculer-db) adapter for MongoDB on the **current `mongodb` driver (6.x)**.
A TypeScript port of [`moleculer-db-adapter-mongo@0.4.21`](https://github.com/moleculerjs/moleculer-db/tree/master/packages/moleculer-db-adapter-mongo)
(MIT, (c) MoleculerJS), which bundles driver 3.7 (EOL) and so duplicated the driver in any service that also imports `mongodb`.
This adapter uses *your* `mongodb` dependency: one driver in the tree.

Same adapter interface and same behaviour for the methods moleculer-db calls: it is a drop-in replacement.

## Install

Not on npm; installed from a git tag, with compiled output committed on the release commit (no build step, no auth: the repo is public).

```json
"@keletes/moleculer-db-adapter-mongo": "git+https://github.com/keletes/moleculer-db-adapter-mongo#vX.Y.Z",
"mongodb": "^6.21.0",
"moleculer": "^0.14.32",
"moleculer-db": "^0.8.29"
```

`mongodb`, `moleculer` and `moleculer-db` are peer dependencies. Node >= 22.

## Usage

```ts
import DbService from "moleculer-db";
import MongoDbAdapter from "@keletes/moleculer-db-adapter-mongo"; // or { MongoDbAdapter }

export default {
	name: "products",
	mixins: [DbService],
	adapter: new MongoDbAdapter(process.env.MONGO_SERVER!),
	collection: "product",
};
```

`new MongoDbAdapter(uri, opts?, dbName?)`: `opts` are `MongoClientOptions`, `dbName` defaults to the one in the URI.
After connecting, `this.adapter.client`, `.db` and `.collection` are the driver objects, for anything moleculer-db does not cover.

### Differences from upstream 0.4.21

Forced by the driver upgrade, invisible to moleculer-db:

- `insert`/`insertMany` return the input plus the generated `_id` (driver 6 no longer returns the documents).
- `updateById`/`removeById` use `findOneAndUpdate`/`findOneAndDelete`, resolving to the document or `null`.
- `stringToObjectID` leaves 12-character strings as they are (a 12-char custom `_id` is not turned into a bogus ObjectId).
- Dotted field names (`{ "a.b": 1 }`) are stored as-is (driver 3.7 rejected them); needs MongoDB server >= 5.0.
- Driver errors are the driver 6 ones (e.g. `MongoServerSelectionError`).

Exports: default and named `MongoDbAdapter`, type `Filters`.

## Design

Two options were evaluated: (a) ship only the adapter class; (b) also ship a mixin on top of moleculer-db that factors out the pattern
in `business-product` (`__v` bump, `expectedVersion` compare-and-swap -> 409 `ERR_VERSION_CONFLICT` / 404 `ERR_NOT_FOUND`, `updatedBy`,
server-managed `updatedAt`, history collection with trimming, `restore`).

**Decision: (a).** Of the fleet's services only `business-product` uses that pattern on MongoDB. `business-table` has an `expectedVersion`
check too but on Postgres/Sequelize with a snapshot table, a different storage model that a Mongo mixin would not serve.
`business-role`, `business-access-key`, `business-integration` and `business-documentation` use plain moleculer-db CRUD over this adapter;
`business-cad` uses a GridFS adapter. One consumer does not justify a shared abstraction yet.

**Future option (b):** if a second Mongo service needs optimistic concurrency/history, add `VersionedMixin` here (a plain Moleculer mixin
overriding moleculer-db's `_update` and adding `history`/`restore` actions, taking `historyCollection` and `maxVersions` settings), extracted from
`business-product/services/product.service.ts`. It must be opt-in, so services that do not use it see no change.

## Tests

Real `mongod` through [`mongodb-memory-server`](https://github.com/typegoose/mongodb-memory-server), no containers.

```
yarn test        # jest --coverage; starts a throwaway mongod
yarn verify      # typecheck + lint (fast, no mongod)
```

- The mongod version is **pinned** in `package.json` (`config.mongodbMemoryServer.version`, default `7.0.14`: MongoDB 7.0 supports driver 6 and
  server-side dotted field names, which need >= 5.0). Override with `MONGOMS_VERSION=...`.
- Set `MONGO_SERVER=mongodb://...` to test against an existing server instead (the version/arch guard is then skipped).
- `test/tests/mongod-pin.spec.ts` asserts the running mongod has the pinned version and was built for the host OS/architecture.
- First run downloads the binary (~150 MB) to `node_modules/.cache/mongodb-memory-server` (or reuses `~/.cache/mongodb-binaries`).

### Why the cache once showed the wrong version

The pin passed to `MongoMemoryServer.create({ binary: { version } })` *was* applied (the running mongod was always the pinned one). The stray
`mongod-<arch>-8.2.6` in `node_modules/.cache` came from the package's own **postinstall**, which pre-downloads the library default (8.2.6)
unless told otherwise. The version is now declared once in `package.json` (`config.mongodbMemoryServer`), which both the postinstall and
the test setup read, and the guard test fails if the running mongod differs.

## Releases

Trunk-based on `main`; PR titles must be Conventional Commits (`feat:`, `fix:`, ...), enforced by `pr-title.yml`. `tag.yml` runs
semantic-release on every push to `main`: it builds `dist/`, commits it with the version bump and tags `vX.Y.Z`.
CI (`verify.yml`) runs typecheck, lint, build and the Mongo tests on `ubuntu-latest` (x64) and `ubuntu-24.04-arm`.

## License

MIT. Port of `moleculer-db-adapter-mongo` (c) 2019 MoleculerJS.
