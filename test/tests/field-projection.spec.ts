import { ServiceBroker } from "moleculer";
import DbService from "moleculer-db";
import MongoDbAdapter from "../../src";

describe("field projection", () => {
	const broker = new ServiceBroker({ logger: false });
	const collection = `proj_spec_${Date.now()}`;
	const settings = { fields: ["_id", "name", "n", "meta", "meta.a", "meta.b", "meta.c.d"] };

	const svc = (name: string, extra: Record<string, any> = {}) =>
		broker.createService({
			name,
			mixins: [DbService],
			adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
			collection,
			settings: { ...settings, ...extra },
		});
	svc("items");
	svc("renamed", { idField: "id", fields: ["id", "name", "n"] });

	const adapter = () => broker.getLocalService("items").adapter;
	let ids: string[];
	beforeAll(async () => {
		await broker.start();
		await adapter().clear();
		const docs = await adapter().insertMany([
			{ name: "alpha", n: 1, secret: "x", meta: { a: 1, b: 2, c: { d: 3, e: 4 } } },
			{ name: "beta", n: 2, secret: "y", meta: { a: 5, b: 6, c: { d: 7, e: 8 } } },
		]);
		ids = docs.map((d: any) => d._id.toHexString());
	});
	afterAll(async () => {
		await adapter().clear();
		await broker.stop();
	});

	it("builds a projection from plain dotted names only, dropping paths under a requested parent", () => {
		const a = adapter();
		expect(a.transformProjection(undefined)).toBeUndefined();
		expect(a.transformProjection([])).toBeUndefined();
		expect(a.transformProjection(["name", "meta.a", "meta", "meta.c.d", "x.y"])).toEqual({ name: 1, meta: 1, "x.y": 1 });
		expect(a.transformProjection("name, n")).toEqual({ n: 1, name: 1 });
		expect(a.transformProjection(["$bad", "a..b", "", "ok"])).toEqual({ ok: 1 });
	});

	it("find and findById read only the requested fields, _id always comes back", async () => {
		const a = adapter();
		const rows = await a.find({ fields: ["name", "meta.c.d"], sort: "name" });
		expect(rows.map((r: any) => Object.keys(r).sort())).toEqual([["_id", "meta", "name"], ["_id", "meta", "name"]]);
		expect(rows[0].meta).toEqual({ c: { d: 3 } });
		expect(await a.findById(ids[0], ["n"])).toEqual({ _id: expect.anything(), n: 1 });
		expect(await a.findByIds(ids, ["n"])).toHaveLength(2);
		expect(Object.keys((await a.findByIds(ids, ["n"]))[0]).sort()).toEqual(["_id", "n"]);
		expect(Object.keys(await a.findById(ids[0]))).toContain("secret");
	});

	it("keeps the text score next to a projection", async () => {
		const a = adapter();
		await a.collection.createIndex({ name: "text" });
		const rows = await a.find({ search: "alpha", fields: ["n"] });
		expect(Object.keys(rows[0]).sort()).toEqual(["_id", "_score", "n"]);
	});

	it("gives the same find output as without projection", async () => {
		const full = await adapter().find({ sort: "name" });
		const projected = await adapter().find({ sort: "name", fields: ["n", "meta.c.d"] });
		expect(projected.map((d: any) => d.n)).toEqual(full.map((d: any) => d.n));
		expect(projected.map((d: any) => d.meta.c.d)).toEqual(full.map((d: any) => d.meta.c.d));
		expect(await adapter().find({ sort: "name", fields: [] })).toEqual(full);
		const meta: any[] = await broker.call("items.find", { fields: ["name", "meta.a", "meta"], sort: "name" });
		expect(meta.map((r) => r.meta.c.e)).toEqual([4, 8]);
		expect(await broker.call("items.find", { fields: ["meta.c.d"], sort: "name" })).toEqual([{ meta: { c: { d: 3 } } }, { meta: { c: { d: 7 } } }]);
	});

	it("works with a custom idField", async () => {
		expect(await broker.call("renamed.find", { fields: ["id", "n"], sort: "n" })).toEqual([
			{ id: ids[0], n: 1 },
			{ id: ids[1], n: 2 },
		]);
	});
});
