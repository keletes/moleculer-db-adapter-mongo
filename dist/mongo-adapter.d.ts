import type { Service, ServiceBroker } from "moleculer";
import { Collection, Db, MongoClient } from "mongodb";
import type { Document, MongoClientOptions, Sort } from "mongodb";
export interface Filters {
    query?: Record<string, any>;
    search?: string;
    sort?: string | string[] | Record<string, 1 | -1>;
    offset?: number;
    limit?: number;
}
export declare class MongoDbAdapter {
    private uri;
    private opts?;
    private dbName?;
    broker: ServiceBroker;
    service: Service;
    client: MongoClient;
    db: Db;
    collection: Collection<Document>;
    constructor(uri: string, opts?: MongoClientOptions | undefined, dbName?: string | undefined);
    init(broker: ServiceBroker, service: Service): void;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    find(filters?: Filters): any;
    findOne(query: Document): Promise<import("mongodb").WithId<Document> | null>;
    findById(id: string): Promise<import("mongodb").WithId<Document> | null>;
    findByIds(ids: string[]): Promise<import("mongodb").WithId<Document>[]>;
    count(filters?: Filters): any;
    insert(entity: Document): Promise<Document | undefined>;
    insertMany(entities: Document[]): Promise<Document[]>;
    updateMany(query: Document, update: Document): Promise<number>;
    updateById(id: string, update: Document): Promise<import("mongodb").WithId<Document> | null>;
    removeMany(query: Document): Promise<number>;
    removeById(id: string): Promise<import("mongodb").WithId<Document> | null>;
    clear(): Promise<number>;
    entityToObject(entity: Document): {
        [key: string]: any;
    };
    /** Cursor for `find`, or the document count when `isCounting`. */
    createCursor(params?: Filters, isCounting?: boolean): any;
    /** `"-votes title"` / `["-votes", "title"]` -> `{ votes: -1, title: 1 }`. */
    transformSort(paramSort: Filters["sort"]): Sort | undefined;
    stringToObjectID(id: any): any;
    objectIDToString(id: any): any;
    /** Transforms `idField` into MongoDB's `_id`. */
    beforeSaveTransformID(entity: Document, idField: string): {
        [key: string]: any;
    };
    /** Transforms MongoDB's `_id` into the user-defined `idField`. */
    afterRetrieveTransformID(entity: Document, idField: string): Document;
}
export default MongoDbAdapter;
