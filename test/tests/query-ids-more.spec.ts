import { ObjectId } from "mongodb";
import MongoDbAdapter from "../../src";

const URI = `${process.env.MONGO_SERVER}`;
const TWELVE = "abcdefghijkl";

const deepFreeze = <T>(o: T): T => {
	if (o && typeof o === "object" && !(o instanceof ObjectId)) {
		Object.values(o as any).forEach(deepFreeze);
		Object.freeze(o);
	}
	return o;
};

describe("string ids in queries: operators and write paths", () => {
	const collection = `query_ids_more_${Date.now()}`;
	const settings: Record<string, any> = {};
	const adapter = new MongoDbAdapter(URI);
	let a: ObjectId, b: ObjectId, c: ObjectId;
	const hex = (id: ObjectId) => id.toHexString();
	const names = async (query: any) => ((await adapter.find({ query, sort: "name" })) as any[]).map((d) => d.name);

	beforeAll(async () => {
		adapter.init({} as any, { schema: { collection }, settings, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } } as any);
		await adapter.connect();
	});
	afterAll(async () => {
		await adapter.collection.drop().catch(() => undefined);
		await adapter.disconnect();
	});
	beforeEach(async () => {
		delete settings.idField;
		await adapter.clear();
		[a, b, c] = [new ObjectId(), new ObjectId(), new ObjectId()];
		await adapter.collection.insertMany([
			{ _id: a, name: "a", tags: [1], sub: { _id: hex(a) } },
			{ _id: b, name: "b", tags: [2] },
			{ _id: c, name: "c", tags: [3] },
			{ _id: TWELVE as any, name: "twelve" },
		]);
	});

	it("converts $not and $all", async () => {
		expect(await names({ _id: { $not: { $in: [hex(a), hex(b)] } } })).toEqual(["c", "twelve"]);
		expect(await names({ _id: { $not: { $eq: hex(a) } } })).toEqual(["b", "c", "twelve"]);
		expect(await names({ _id: { $all: [hex(a)] } })).toEqual(["a"]);
		expect(await adapter.count({ query: { _id: { $not: { $in: [hex(a)] } } } })).toBe(3);
	});

	it("converts $nor and keeps a 12-char string _id a string", async () => {
		expect(await names({ $nor: [{ _id: hex(a) }, { _id: hex(b) }] })).toEqual(["c", "twelve"]);
		expect(await names({ _id: TWELVE })).toEqual(["twelve"]);
		expect(await names({ _id: { $in: [TWELVE, hex(a)] } })).toEqual(["a", "twelve"]);
	});

	it("leaves $exists, $regex, $type, nested sub._id and null/undefined alone", async () => {
		expect(await names({ _id: { $exists: true } })).toEqual(["a", "b", "c", "twelve"]);
		expect(await names({ _id: { $type: "string" } })).toEqual(["twelve"]);
		expect(await names({ _id: { $regex: "^abc" } })).toEqual(["twelve"]);
		expect(await names({ "sub._id": hex(a) })).toEqual(["a"]); // stored as a string there
		expect(await names({ _id: null })).toEqual([]);
		expect(adapter.transformQueryIDs({ _id: undefined, x: null })).toEqual({ _id: undefined, x: null });
		expect(adapter.transformQueryIDs({ _id: { $in: [null, undefined] } })).toEqual({ _id: { $in: [null, undefined] } });
	});

	it("applies to date, regexp and null-prototype values without error", () => {
		const d = new Date();
		const np = Object.assign(Object.create(null), { $in: [hex(a)] });
		expect(adapter.transformQueryIDs({ _id: d })._id).toBe(d);
		expect(adapter.transformQueryIDs({ _id: /x/ })._id).toEqual(/x/);
		expect(adapter.transformQueryIDs({ _id: np })._id.$in[0]).toEqual(a);
	});

	it("does not mutate a frozen, nested original", () => {
		const q: any = deepFreeze({ $and: [{ _id: { $in: [hex(a)] } }, { $or: [{ _id: { $not: { $eq: hex(b) } } }, { n: 1 }] }], _id: ObjectId.createFromHexString(hex(c)) });
		const snapshot = JSON.stringify(q); // ObjectId-aware (toJSON); structuredClone would flatten ObjectIds
		const out = adapter.transformQueryIDs(q);
		expect(JSON.stringify(q)).toBe(snapshot);
		expect(Object.isFrozen(q.$and[0])).toBe(true);
		expect(typeof q.$and[0]._id.$in[0]).toBe("string");
		expect(out.$and[0]._id.$in[0]).toEqual(a);
		expect(out.$and[1].$or[0]._id.$not.$eq).toEqual(b);
		expect(out._id).toEqual(c);
	});

	describe("custom idField", () => {
		beforeEach(() => {
			settings.idField = "id";
		});

		it("renames it to _id", async () => {
			expect(await names({ id: hex(a) })).toEqual(["a"]);
		});

		it("applies both constraints when idField and _id are present", async () => {
			expect(await names({ id: hex(a), _id: hex(a) })).toEqual(["a"]);
			expect(await names({ id: hex(a), _id: hex(b) })).toEqual([]);
			expect(await names({ id: { $in: [hex(a), hex(b)] }, _id: { $ne: hex(a) } })).toEqual(["b"]);
			// next to an existing $and
			expect(await names({ $and: [{ name: "a" }], id: hex(a), _id: hex(a) })).toEqual(["a"]);
			expect(await names({ $and: [{ name: "b" }], id: hex(a), _id: hex(b) })).toEqual([]);
		});
	});

	describe("write and single-document paths", () => {
		it("findOne", async () => {
			expect(await adapter.findOne({ _id: hex(b) })).toMatchObject({ name: "b" });
			expect(await adapter.findOne({ _id: { $in: [hex(c)] } })).toMatchObject({ name: "c" });
		});

		it("updateMany", async () => {
			expect(await adapter.updateMany({ _id: { $in: [hex(a), hex(b)] } }, { $set: { k: 1 } })).toBe(2);
			expect(await adapter.count({ query: { k: 1 } })).toBe(2);
		});

		it("removeMany", async () => {
			expect(await adapter.removeMany({ _id: { $in: [hex(a), hex(b)] } })).toBe(2);
			expect(await names({})).toEqual(["c", "twelve"]);
		});
	});
});
