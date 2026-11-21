import DbService from "moleculer-db";

/**
 * Optional service mixin, listed BEFORE `DbService` in `mixins` (Moleculer lets the first mixin win): makes `get` read only the requested `fields` from MongoDB.
 * moleculer-db's `get` never hands `fields` to the adapter (it filters them afterwards), so this runs its own
 * `_get` with a `getById` that does. Skipped when `populate` is set (a rule may read an unrequested field).
 */
export const FieldProjectionMixin = {
	methods: {
		_get(this: any, ctx: any, params: any) {
			const fields = params.populate ? undefined : params.fields;
			const service = Object.create(this, {
				getById: {
					value: async (id: any, decoding: boolean) => {
						const decode = (i: any) => (decoding ? this.decodeID(i) : i);
						return Array.isArray(id) ? this.adapter.findByIds(id.map(decode), fields) : this.adapter.findById(decode(id), fields);
					},
				},
			});
			return (DbService as any).methods._get.call(service, ctx, params);
		},
	},
};
