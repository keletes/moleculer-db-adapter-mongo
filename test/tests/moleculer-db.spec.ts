import { ServiceBroker } from "moleculer";
import DbService from "moleculer-db";
import MongoDbAdapter from "../../src";

/** The adapter wired into a real moleculer-db service, the way the fleet's services use it. */
describe("MongoDbAdapter inside moleculer-db", () => {
	const broker = new ServiceBroker({ logger: false });
	const collection = `mdb_spec_${Date.now()}`;

	broker.createService({
		name: "items",
		mixins: [DbService],
		adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
		collection,
		settings: { fields: ["_id", "name", "n"] },
	});

	broker.createService({
		name: "renamed",
		mixins: [DbService],
		adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
		collection,
		settings: { idField: "id", fields: ["id", "name", "n"] },
	});

	beforeAll(() => broker.start());
	const clear = () => broker.getLocalService("items").adapter.clear();
	afterAll(async () => {
		await clear();
		await broker.stop();
	});
	beforeEach(clear);

	it("creates, gets, lists, counts, updates and removes through the actions", async () => {
		const a: any = await broker.call("items.create", { name: "a", n: 1 });
		expect(typeof a._id).toBe("string");
		expect(await broker.call("items.get", { id: a._id })).toMatchObject({ name: "a" });

		await broker.call("items.insert", { entities: [{ name: "b", n: 2 }, { name: "c", n: 3 }] });
		expect(await broker.call("items.count")).toBe(3);

		const page: any = await broker.call("items.list", { page: 1, pageSize: 2, sort: "-n" });
		expect(page.total).toBe(3);
		expect(page.rows.map((r: any) => r.name)).toEqual(["c", "b"]);

		expect(await broker.call("items.update", { id: a._id, n: 10 })).toMatchObject({ n: 10 });
		expect(await broker.call("items.remove", { id: a._id })).toMatchObject({ _id: a._id });
		expect(await broker.call("items.count")).toBe(2);
	});

	it("rejects a get for a missing entity with a 404", async () => {
		await expect(broker.call("items.get", { id: "5f1b1b1b1b1b1b1b1b1b1b1b" })).rejects.toMatchObject({ code: 404 });
	});

	it("maps a custom idField", async () => {
		const created: any = await broker.call("renamed.create", { name: "z", n: 9 });
		expect(created.id).toMatch(/^[0-9a-f]{24}$/);
		expect(created._id).toBeUndefined();
		expect(await broker.call("renamed.get", { id: created.id })).toMatchObject({ name: "z" });
	});
});

/**
 * `get` with `mapping: true` keys the result by `encodeID(<raw document>._id)` and fills the values from the
 * transformed documents (whose `_id` went through `entityToObject`, so it is a string). The raw `_id` is an
 * ObjectId: with a service `encodeID` that expects the string id, the mapped `get` threw (and with a lenient one
 * the key differed from the document's own id).
 */
describe("get with mapping on an ObjectId _id", () => {
	const broker = new ServiceBroker({ logger: false });
	const collection = `mapping_spec_${Date.now()}`;
	const methods = {
		encodeID: (id: string) => Buffer.from(id, "hex").toString("base64url"),
		decodeID: (id: string) => Buffer.from(id, "base64url").toString("hex"),
	};

	broker.createService({
		name: "enc",
		mixins: [DbService],
		adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
		collection,
		settings: { fields: ["_id", "name"] },
		methods,
	});
	broker.createService({
		name: "encRenamed",
		mixins: [DbService],
		adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
		collection,
		settings: { idField: "id", fields: ["id", "name"] },
		methods,
	});

	beforeAll(() => broker.start());
	afterAll(async () => {
		await broker.getLocalService("enc").adapter.clear();
		await broker.stop();
	});

	it("keys one and many entities by the id shown in the document", async () => {
		const a: any = await broker.call("enc.create", { name: "a" });
		const b: any = await broker.call("enc.create", { name: "b" });
		expect(await broker.call("enc.get", { id: a._id, mapping: true })).toEqual({ [a._id]: a });
		expect(await broker.call("enc.get", { id: [b._id, a._id], mapping: true })).toEqual({ [a._id]: a, [b._id]: b });
		const r: any = await broker.call("encRenamed.get", { id: [a._id, b._id], mapping: true });
		expect(r[a._id]).toMatchObject({ id: a._id, name: "a" });
		expect(Object.keys(r).sort()).toEqual([a._id, b._id].sort());
	});

	it("maps with the default (identity) encodeID too", async () => {
		const plain = new ServiceBroker({ logger: false });
		plain.createService({
			name: "plain",
			mixins: [DbService],
			adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
			collection,
			settings: { fields: ["_id", "name"] },
		});
		await plain.start();
		try {
			const a: any = await plain.call("plain.create", { name: "p" });
			expect(await plain.call("plain.get", { id: [a._id], mapping: true })).toEqual({ [a._id]: a });
		} finally {
			await plain.stop();
		}
	});
});
