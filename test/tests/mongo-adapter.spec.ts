import { ObjectId } from "mongodb";
import MongoDbAdapter from "../../src";

const URI = `${process.env.MONGO_SERVER}`;

describe("MongoDbAdapter", () => {
	const collection = `adapter_spec_${Date.now()}`;
	const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
	const adapter = new MongoDbAdapter(URI);

	beforeAll(async () => {
		adapter.init({} as any, { schema: { collection }, logger } as any);
		await adapter.connect();
	});

	afterAll(async () => {
		await adapter.collection.drop().catch(() => undefined);
		await adapter.disconnect();
	});

	beforeEach(() => adapter.clear());

	describe("lifecycle", () => {
		it("refuses a schema without a collection", () => {
			expect(() => new MongoDbAdapter("mongodb://x").init({} as any, { schema: {} } as any)).toThrow(/collection/);
		});

		it("keeps the broker and service handed to init", () => {
			const a = new MongoDbAdapter(URI);
			const broker: any = {};
			const service: any = { schema: { collection: "c" } };
			a.init(broker, service);
			expect(a.broker).toBe(broker);
			expect(a.service).toBe(service);
		});

		it("connects to the configured collection and logs it", () => {
			expect(adapter.collection.collectionName).toBe(collection);
			expect(adapter.db).toBeDefined();
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("connected"));
		});

		it("honours dbName and client options", async () => {
			const a = new MongoDbAdapter(URI, { appName: "adapter-spec" }, "other_db");
			a.init({} as any, { schema: { collection }, logger } as any);
			await a.connect();
			try {
				expect(a.db.databaseName).toBe("other_db");
				expect(a.client.options.appName).toBe("adapter-spec");
			} finally {
				await a.disconnect();
			}
		});

		it("rejects connect when the server cannot be reached", async () => {
			const a = new MongoDbAdapter("mongodb://127.0.0.1:1/x", { serverSelectionTimeoutMS: 300 });
			a.init({} as any, { schema: { collection }, logger } as any);
			await expect(a.connect()).rejects.toThrow();
		});

		it("disconnect is a no-op before connect and idempotent after", async () => {
			const a = new MongoDbAdapter(URI);
			a.init({} as any, { schema: { collection }, logger } as any);
			await expect(a.disconnect()).resolves.toBeUndefined();
			await a.connect();
			await a.disconnect();
			await expect(a.disconnect()).resolves.toBeUndefined();
		});
	});

	describe("insert", () => {
		it("inserts one document and hands it back with its generated _id", async () => {
			const doc = await adapter.insert({ name: "a" });
			expect(doc?._id).toBeInstanceOf(ObjectId);
			expect(await adapter.findById(doc!._id.toHexString())).toMatchObject({ name: "a" });
		});

		it("keeps a caller-supplied _id", async () => {
			const _id = new ObjectId();
			const doc = await adapter.insert({ _id, name: "a" });
			expect(doc?._id).toEqual(_id);
		});

		it("inserts many documents and hands each back with its _id", async () => {
			const docs = await adapter.insertMany([{ name: "a" }, { name: "b" }]);
			expect(docs.map((d) => d.name)).toEqual(["a", "b"]);
			expect(new Set(docs.map((d) => String(d._id))).size).toBe(2);
			expect(await adapter.count()).toBe(2);
		});
	});

	describe("find / count", () => {
		beforeEach(() =>
			adapter.insertMany([
				{ name: "c", n: 3 },
				{ name: "a", n: 1 },
				{ name: "b", n: 2 },
			]),
		);
		const names = async (filters?: any) => (await adapter.find(filters)).map((d: any) => d.name);

		it("finds everything without filters", async () => {
			expect((await names()).sort()).toEqual(["a", "b", "c"]);
			expect((await names({})).sort()).toEqual(["a", "b", "c"]);
		});

		it("filters by query", async () => {
			expect(await names({ query: { n: { $gt: 1 } }, sort: "n" })).toEqual(["b", "c"]);
			expect(await names({ query: { n: 99 } })).toEqual([]);
		});

		it("sorts by string, comma string, array and object", async () => {
			expect(await names({ sort: "n" })).toEqual(["a", "b", "c"]);
			expect(await names({ sort: "-n" })).toEqual(["c", "b", "a"]);
			expect(await names({ sort: "-n,name" })).toEqual(["c", "b", "a"]);
			expect(await names({ sort: ["-n"] })).toEqual(["c", "b", "a"]);
			expect(await names({ sort: { n: -1 } })).toEqual(["c", "b", "a"]);
		});

		it("pages with offset and limit; zero or negative values are ignored", async () => {
			expect(await names({ sort: "n", offset: 1, limit: 1 })).toEqual(["b"]);
			expect(await names({ sort: "n", offset: 2 })).toEqual(["c"]);
			expect(await names({ sort: "n", limit: 2 })).toEqual(["a", "b"]);
			expect(await names({ sort: "n", offset: 0, limit: 0 })).toEqual(["a", "b", "c"]);
			expect(await names({ sort: "n", offset: -1, limit: -1 })).toEqual(["a", "b", "c"]);
		});

		it("counts, ignoring sort and paging", async () => {
			expect(await adapter.count()).toBe(3);
			expect(await adapter.count({})).toBe(3);
			expect(await adapter.count({ query: { n: { $gt: 1 } }, offset: 1, limit: 1, sort: "n" })).toBe(2);
		});

		it("finds one, returning null on a miss", async () => {
			expect(await adapter.findOne({ name: "b" })).toMatchObject({ name: "b" });
			expect(await adapter.findOne({ name: "zzz" })).toBeNull();
		});

		it("finds by id (hex string or ObjectId), returning null on a miss", async () => {
			const doc: any = await adapter.findOne({ name: "a" });
			expect(await adapter.findById(doc._id.toHexString())).toMatchObject({ name: "a" });
			expect(await adapter.findById(doc._id)).toMatchObject({ name: "a" });
			expect(await adapter.findById(new ObjectId().toHexString())).toBeNull();
		});

		it("finds by ids, ignoring unknown ones", async () => {
			const all: any[] = await adapter.find();
			const ids = [all[0]._id.toHexString(), all[1]._id.toHexString(), new ObjectId().toHexString()];
			expect(await adapter.findByIds(ids)).toHaveLength(2);
			expect(await adapter.findByIds([])).toEqual([]);
		});

		it("supports custom (non-ObjectId) _id values", async () => {
			await adapter.collection.insertOne({ _id: "slug-1" as any, name: "s" });
			expect(await adapter.findById("slug-1")).toMatchObject({ name: "s" });
			expect(await adapter.findByIds(["slug-1"])).toHaveLength(1);
		});
	});

	describe("text search", () => {
		beforeAll(() => adapter.collection.createIndex({ title: "text", body: "text" }));
		beforeEach(() =>
			adapter.insertMany([
				{ title: "red apple", body: "fruit", n: 1 },
				{ title: "green apple", body: "fruit apple", n: 2 },
				{ title: "banana", body: "yellow fruit", n: 3 },
			]),
		);

		it("searches by text and orders by text score", async () => {
			const found: any[] = await adapter.find({ search: "apple" });
			expect(found.map((d) => d.title).sort()).toEqual(["green apple", "red apple"]);
			expect(found[0].title).toBe("green apple"); // matches in both fields: higher score
			expect(found[0]._score).toBeGreaterThan(found[1]._score);
		});

		it("combines search with query, paging and count", async () => {
			expect(await adapter.find({ search: "apple", query: { n: 1 } })).toHaveLength(1);
			expect(await adapter.find({ search: "apple", limit: 1 })).toHaveLength(1);
			expect(await adapter.find({ search: "apple", offset: 1 })).toHaveLength(1);
			expect(await adapter.count({ search: "apple" })).toBe(2);
			expect(await adapter.count({ search: "fruit", query: { n: { $gt: 1 } } })).toBe(2);
		});

		it("treats an empty search string as no search", async () => {
			expect(await adapter.find({ search: "" })).toHaveLength(3);
		});
	});

	describe("update / remove", () => {
		it("updates by id and returns the document after the update", async () => {
			const doc = await adapter.insert({ name: "a", n: 1 });
			const updated = await adapter.updateById(doc!._id.toHexString(), { $set: { n: 2 } });
			expect(updated).toMatchObject({ name: "a", n: 2 });
			expect(await adapter.updateById(new ObjectId().toHexString(), { $set: { n: 2 } })).toBeNull();
		});

		it("updates many and reports the modified count", async () => {
			await adapter.insertMany([{ k: 1 }, { k: 1 }, { k: 2 }]);
			expect(await adapter.updateMany({ k: 1 }, { $set: { k: 3 } })).toBe(2);
			expect(await adapter.updateMany({ k: 99 }, { $set: { k: 3 } })).toBe(0);
			expect(await adapter.count({ query: { k: 3 } })).toBe(2);
		});

		it("removes by id, returning the removed document or null", async () => {
			const doc = await adapter.insert({ k: 1 });
			expect((await adapter.removeById(doc!._id.toHexString()))?.k).toBe(1);
			expect(await adapter.removeById(doc!._id.toHexString())).toBeNull();
		});

		it("removes many and clears", async () => {
			await adapter.insertMany([{ k: 1 }, { k: 2 }, { k: 3 }]);
			expect(await adapter.removeMany({ k: { $gte: 2 } })).toBe(2);
			expect(await adapter.count()).toBe(1);
			await adapter.insertMany([{ k: 4 }, { k: 5 }]);
			expect(await adapter.clear()).toBe(3);
			expect(await adapter.count()).toBe(0);
		});
	});

	describe("dotted field names", () => {
		it("stores and reads back field names that contain dots", async () => {
			const doc = await adapter.insert({ "a.b": 1, nested: { "c.d": 2 } });
			expect(await adapter.findById(doc!._id.toHexString())).toMatchObject({ "a.b": 1, nested: { "c.d": 2 } });
		});

		it("can query and update them with $getField / $set via an aggregation pipeline", async () => {
			const doc = await adapter.insert({ "a.b": 1 });
			await adapter.updateById(doc!._id.toHexString(), [{ $set: { "x": { $getField: "a.b" } } }]);
			expect(await adapter.findById(doc!._id.toHexString())).toMatchObject({ "a.b": 1, x: 1 });
		});
	});

	describe("id transforms", () => {
		const id = new ObjectId();

		it("converts ids both ways", () => {
			expect(adapter.stringToObjectID(id.toHexString())).toEqual(id);
			expect(adapter.stringToObjectID("not-an-id")).toBe("not-an-id");
			expect(adapter.stringToObjectID("123456789012")).toBe("123456789012"); // 12 chars: not mangled
			expect(adapter.stringToObjectID(7)).toBe(7);
			expect(adapter.objectIDToString(id)).toBe(id.toHexString());
			expect(adapter.objectIDToString("x")).toBe("x");
			expect(adapter.objectIDToString(undefined)).toBeUndefined();
		});

		it("entityToObject stringifies _id and does not mutate the entity", () => {
			const entity = { _id: id, a: 1 };
			expect(adapter.entityToObject(entity)).toEqual({ _id: id.toHexString(), a: 1 });
			expect(entity._id).toBe(id);
			expect(adapter.entityToObject({ a: 1 })).toEqual({ a: 1 });
		});

		it("maps a custom idField on the way in", () => {
			const input = { id: id.toHexString(), a: 1 };
			expect(adapter.beforeSaveTransformID(input, "id")).toEqual({ _id: id, a: 1 });
			expect(input).toEqual({ id: id.toHexString(), a: 1 });
			expect(adapter.beforeSaveTransformID({ _id: id, a: 1 }, "_id")).toEqual({ _id: id, a: 1 });
			expect(adapter.beforeSaveTransformID({ a: 1 }, "id")).toEqual({ a: 1 });
		});

		it("maps a custom idField on the way out", () => {
			expect(adapter.afterRetrieveTransformID({ _id: id, a: 1 }, "id")).toEqual({ id: id.toHexString(), a: 1 });
			expect(adapter.afterRetrieveTransformID({ _id: id, a: 1 }, "_id")).toEqual({ _id: id, a: 1 });
		});
	});

	describe("transformSort", () => {
		it("normalises every accepted shape", () => {
			expect(adapter.transformSort("-votes title")).toEqual({ votes: -1, title: 1 });
			expect(adapter.transformSort("-votes,title")).toEqual({ votes: -1, title: 1 });
			expect(adapter.transformSort(["-votes", "title"])).toEqual({ votes: -1, title: 1 });
			expect(adapter.transformSort({ votes: -1 })).toEqual({ votes: -1 });
			expect(adapter.transformSort(undefined)).toBeUndefined();
		});
	});
});
