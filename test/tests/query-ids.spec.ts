import { ServiceBroker } from "moleculer";
import DbService from "moleculer-db";
import { ObjectId } from "mongodb";
import MongoDbAdapter from "../../src";

const URI = `${process.env.MONGO_SERVER}`;
const HASH = "a".repeat(64);

describe("string ids in find / count queries", () => {
	const collection = `query_ids_${Date.now()}`;
	const adapter = new MongoDbAdapter(URI);
	let a: ObjectId, b: ObjectId, c: ObjectId;
	const hex = (id: ObjectId) => id.toHexString();
	const names = async (query: any, search?: string) =>
		((await adapter.find({ query, search, sort: "name" })) as any[]).map((d) => d.name);

	beforeAll(async () => {
		adapter.init({} as any, { schema: { collection }, settings: {}, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } } as any);
		await adapter.connect();
		await adapter.collection.createIndex({ name: "text" });
	});
	afterAll(async () => {
		await adapter.collection.drop().catch(() => undefined);
		await adapter.disconnect();
	});
	beforeEach(async () => {
		await adapter.clear();
		[a, b, c] = [new ObjectId(), new ObjectId(), new ObjectId()];
		await adapter.collection.insertMany([
			{ _id: a, name: "apple fruit" },
			{ _id: b, name: "banana fruit" },
			{ _id: c, name: "cherry fruit" },
			{ _id: HASH as any, name: "hashed fruit" },
		]);
	});

	it("matches a plain string _id", async () => {
		expect(await names({ _id: hex(a) })).toEqual(["apple fruit"]);
		expect(await adapter.count({ query: { _id: hex(a) } })).toBe(1);
	});

	it("matches $eq, $ne, $in and $nin", async () => {
		expect(await names({ _id: { $eq: hex(b) } })).toEqual(["banana fruit"]);
		expect(await names({ _id: { $ne: hex(b) } })).toEqual(["apple fruit", "cherry fruit", "hashed fruit"]);
		expect(await names({ _id: { $in: [hex(a), hex(c)] } })).toEqual(["apple fruit", "cherry fruit"]);
		expect(await names({ _id: { $nin: [hex(a), hex(c), HASH] } })).toEqual(["banana fruit"]);
		expect(await adapter.count({ query: { _id: { $in: [hex(a), hex(c)] } } })).toBe(2);
		expect(await adapter.count({ query: { _id: { $nin: [hex(a)] } } })).toBe(3);
	});

	it("converts inside $and / $or", async () => {
		expect(await names({ $or: [{ _id: hex(a) }, { _id: { $in: [hex(c)] } }] })).toEqual(["apple fruit", "cherry fruit"]);
		expect(await names({ $and: [{ _id: { $ne: hex(a) } }, { $or: [{ _id: hex(b) }, { name: "none" }] }] })).toEqual(["banana fruit"]);
		expect(await adapter.count({ query: { $or: [{ _id: hex(a) }, { _id: hex(b) }] } })).toBe(2);
	});

	it("works together with search", async () => {
		expect(await names({ _id: hex(a) }, "fruit")).toEqual(["apple fruit"]);
		expect(await adapter.count({ query: { _id: { $in: [hex(a), hex(b)] } }, search: "fruit" })).toBe(2);
	});

	it("leaves non-ObjectId strings and ObjectId instances alone", async () => {
		expect(await names({ _id: HASH })).toEqual(["hashed fruit"]);
		expect(await names({ _id: { $in: [HASH, hex(a)] } })).toEqual(["apple fruit", "hashed fruit"]);
		expect(await names({ _id: a })).toEqual(["apple fruit"]);
		expect(await names({ _id: { $in: [b] } })).toEqual(["banana fruit"]);
	});

	it("does not touch other fields or mutate the caller's query", async () => {
		const q = { name: hex(a), _id: { $in: [hex(a)] } };
		const copy = JSON.parse(JSON.stringify(q));
		expect(await names(q)).toEqual([]);
		expect(q).toEqual(copy);
	});

	describe("through moleculer-db with a custom idField", () => {
		const broker = new ServiceBroker({ logger: false });
		broker.createService({
			name: "renamed",
			mixins: [DbService],
			adapter: new MongoDbAdapter(URI),
			collection,
			settings: { idField: "id", fields: ["id", "name"] },
		});
		beforeAll(() => broker.start());
		afterAll(() => broker.stop());

		it("matches a string id on the idField or on _id", async () => {
			const byId: any = await broker.call("renamed.find", { query: { id: hex(a) } });
			expect(byId.map((d: any) => d.name)).toEqual(["apple fruit"]);
			const byInternal: any = await broker.call("renamed.find", { query: { _id: { $in: [hex(b)] } } });
			expect(byInternal.map((d: any) => d.name)).toEqual(["banana fruit"]);
			expect(await broker.call("renamed.count", { query: { id: { $in: [hex(a), hex(b)] } } })).toBe(2);
		});
	});
});
