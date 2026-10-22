"use strict";
/*
 * moleculer-db adapter for MongoDB on the current `mongodb` driver.
 *
 * Port of moleculer-db-adapter-mongo@0.4.21 (MIT, (c) 2019 MoleculerJS), which pins its own copy of driver
 * 3.7 - so a service using it and importing `mongodb` ended up with two drivers. This one uses the service's
 * own `mongodb` dependency, which is the only driver in the tree.
 *
 * Differences from upstream, all forced by the driver upgrade (3.7 -> 6.x):
 *  - `insert`/`insertMany` build the returned document from the input plus the generated `_id`
 *    (the driver no longer returns the inserted documents);
 *  - `updateById`/`removeById` use `findOneAndUpdate`/`findOneAndDelete` with the driver 6 return shape
 *    (the document itself, or `null`);
 *  - `stringToObjectID` leaves 12-character strings alone (they are valid ObjectId input for the driver
 *    but never a real id here), so a 12-char custom `_id` is not mangled.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoDbAdapter = void 0;
const moleculer_1 = require("moleculer");
const mongodb_1 = require("mongodb");
class MongoDbAdapter {
    constructor(uri, opts, dbName) {
        this.uri = uri;
        this.opts = opts;
        this.dbName = dbName;
    }
    init(broker, service) {
        this.broker = broker;
        this.service = service;
        if (!this.service.schema.collection)
            throw new moleculer_1.Errors.ServiceSchemaError("Missing `collection` definition in schema of service!", {});
    }
    async connect() {
        this.client = new mongodb_1.MongoClient(this.uri, this.opts);
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection(this.service.schema.collection);
        this.client.on("close", () => this.service.logger.warn("MongoDB adapter has disconnected."));
        this.client.on("error", (err) => this.service.logger.error("MongoDB error.", err));
        this.service.logger.info("MongoDB adapter has connected successfully.");
    }
    async disconnect() {
        await this.client?.close();
    }
    find(filters) {
        return this.createCursor(filters).toArray();
    }
    findOne(query) {
        return this.collection.findOne(query);
    }
    findById(id) {
        return this.collection.findOne({ _id: this.stringToObjectID(id) });
    }
    findByIds(ids) {
        return this.collection.find({ _id: { $in: ids.map((id) => this.stringToObjectID(id)) } }).toArray();
    }
    count(filters = {}) {
        return this.createCursor(filters, true);
    }
    async insert(entity) {
        const res = await this.collection.insertOne(entity);
        // the driver no longer hands the document back: it is `entity` with the generated `_id` filled in
        return res.acknowledged ? { ...entity, _id: res.insertedId } : undefined;
    }
    async insertMany(entities) {
        const res = await this.collection.insertMany(entities);
        return entities.map((entity, i) => ({ ...entity, _id: res.insertedIds[i] }));
    }
    async updateMany(query, update) {
        return (await this.collection.updateMany(query, update)).modifiedCount;
    }
    updateById(id, update) {
        return this.collection.findOneAndUpdate({ _id: this.stringToObjectID(id) }, update, { returnDocument: "after" });
    }
    async removeMany(query) {
        return (await this.collection.deleteMany(query)).deletedCount;
    }
    removeById(id) {
        return this.collection.findOneAndDelete({ _id: this.stringToObjectID(id) });
    }
    async clear() {
        return (await this.collection.deleteMany({})).deletedCount;
    }
    entityToObject(entity) {
        const json = { ...entity };
        if (entity._id)
            json._id = this.objectIDToString(entity._id);
        return json;
    }
    /** Cursor for `find`, or the document count when `isCounting`. */
    createCursor(params, isCounting = false) {
        const fn = (query) => (isCounting ? this.collection.countDocuments(query) : this.collection.find(query));
        if (!params)
            return fn({});
        let q;
        if (typeof params.search === "string" && params.search !== "") {
            // https://docs.mongodb.com/manual/reference/operator/query/text/
            q = fn({ ...(params.query || {}), $text: { $search: params.search } });
            if (!isCounting)
                q.project({ _score: { $meta: "textScore" } }).sort({ _score: { $meta: "textScore" } });
        }
        else {
            q = fn(params.query || {});
            if (params.sort && !isCounting) {
                const sort = this.transformSort(params.sort);
                if (sort)
                    q.sort(sort);
            }
        }
        if (!isCounting) {
            if (typeof params.offset === "number" && params.offset > 0)
                q.skip(params.offset);
            if (typeof params.limit === "number" && params.limit > 0)
                q.limit(params.limit);
        }
        return q;
    }
    /** `"-votes title"` / `["-votes", "title"]` -> `{ votes: -1, title: 1 }`. */
    transformSort(paramSort) {
        let sort = paramSort;
        if (typeof sort === "string")
            sort = sort.replace(/,/, " ").split(" ");
        if (Array.isArray(sort)) {
            const sortObj = {};
            for (const s of sort) {
                if (s.startsWith("-"))
                    sortObj[s.slice(1)] = -1;
                else
                    sortObj[s] = 1;
            }
            return sortObj;
        }
        return sort;
    }
    stringToObjectID(id) {
        if (typeof id === "string" && id.length !== 12 && mongodb_1.ObjectId.isValid(id))
            return mongodb_1.ObjectId.createFromHexString(id);
        return id;
    }
    objectIDToString(id) {
        return id && id.toHexString ? id.toHexString() : id;
    }
    /** Transforms `idField` into MongoDB's `_id`. */
    beforeSaveTransformID(entity, idField) {
        const newEntity = { ...entity }; // only top-level keys change
        if (idField !== "_id" && entity[idField] !== undefined) {
            newEntity._id = this.stringToObjectID(newEntity[idField]);
            delete newEntity[idField];
        }
        return newEntity;
    }
    /** Transforms MongoDB's `_id` into the user-defined `idField`. */
    afterRetrieveTransformID(entity, idField) {
        if (idField !== "_id") {
            entity[idField] = this.objectIDToString(entity["_id"]);
            delete entity._id;
        }
        return entity;
    }
}
exports.MongoDbAdapter = MongoDbAdapter;
exports.default = MongoDbAdapter;
//# sourceMappingURL=mongo-adapter.js.map