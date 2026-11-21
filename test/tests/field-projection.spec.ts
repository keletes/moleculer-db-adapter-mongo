import { ServiceBroker } from "moleculer";
import DbService from "moleculer-db";
import MongoDbAdapter from "../../src";

describe("field projection", () => {
	const broker = new ServiceBroker({ logger: false });
	const collection = `proj_spec_${Date.now()}`;
	const settings = { fields: ["_id", "name", "n", "meta", "meta.a", "meta.b", "meta.c.d"] };

	const svc = (name: string, mixins: any[], extra: Record<string, any> = {}, methods: Record<string, any> = {}) =>
		broker.createService({
			name,
			mixins,
			adapter: new MongoDbAdapter(`${process.env.MONGO_SERVER}`),
			collection,
			methods,
			settings: { ...settings, ...extra },
		});
	// a custom `_get` is left alone: this one is the unprojected baseline
	const baseline = function (this: any, ctx: any, params: any) {
		return (DbService as any).methods._get.call(this, ctx, params);
	};
	svc("plain", [DbService], {}, { _get: baseline });
	svc("proj", [DbService]);
	svc("renamed", [DbService], { idField: "id", fields: ["id", "name", "n"] });

	const adapter = () => broker.getLocalService("plain").adapter;
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

	it("gives the same actions output with and without projection", async () => {
		for (const params of [{ fields: ["name", "meta.a", "meta"] }, { fields: ["n", "meta.c.d"] }, {}, { fields: ["name"], excludeFields: ["name"] }]) {
			expect(await broker.call("proj.find", { ...params, sort: "name" })).toEqual(await broker.call("plain.find", { ...params, sort: "name" }));
			expect(await broker.call("proj.get", { id: ids[1], ...params })).toEqual(await broker.call("plain.get", { id: ids[1], ...params }));
			expect(await broker.call("proj.get", { id: ids, ...params })).toEqual(await broker.call("plain.get", { id: ids, ...params }));
			expect(await broker.call("proj.get", { id: ids, mapping: true, ...params })).toEqual(
				await broker.call("plain.get", { id: ids, mapping: true, ...params }),
			);
		}
		expect(await broker.call("proj.get", { id: ids[0], fields: ["meta.c.d"] })).toEqual({ meta: { c: { d: 3 } } });
	});

	it("projects in get unless the service has its own _get", async () => {
		const spy = jest.spyOn(broker.getLocalService("proj").adapter, "findById");
		await broker.call("proj.get", { id: ids[0], fields: ["n"] });
		expect(spy).toHaveBeenCalledWith(ids[0], ["n"]);
		const plainSpy = jest.spyOn(broker.getLocalService("plain").adapter, "findById");
		await broker.call("plain.get", { id: ids[0], fields: ["n"] });
		expect(plainSpy).toHaveBeenCalledWith(ids[0]);
	});

	it("works with a custom idField and maps through get", async () => {
		const got: any = await broker.call("renamed.get", { id: ids[0], fields: ["id", "n"] });
		expect(got).toEqual({ id: ids[0], n: 1 });
		expect(await broker.call("renamed.get", { id: [ids[0]], mapping: true, fields: ["n"] })).toEqual({ [ids[0]]: { n: 1 } });
	});
});
