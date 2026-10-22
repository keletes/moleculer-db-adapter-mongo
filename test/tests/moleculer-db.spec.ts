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
