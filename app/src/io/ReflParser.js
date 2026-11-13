import { deserialize, decode } from "@ygoe/msgpack";
import * as hdf5 from "jsfive";

/*
 * Reads DIALS reflection tables (.refl) in either on-disk format:
 *
 *  - msgpack: the long-standing default.
 *  - HDF5: written by DIALS when DIALS_USE_H5 is set (since DIALS 3.23), and
 *    the default in newer DIALS (dials/dials PR #3255).
 *
 * The format is detected from the file's first bytes, not its name, so both
 * kinds of .refl work. HDF5 columns are converted to the same in-memory form
 * as msgpack columns ([type name, [nrows, raw little-endian bytes]]), so
 * every getter below works the same for both.
 *
 */

// First 8 bytes of every HDF5 file. The HDF5 header may also sit after a
// "user block" of 512, 1024, 2048, ... bytes.
const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

function _isHdf5(bytes) {
	for (let offset = 0; offset + 8 <= bytes.length; offset = offset ? offset * 2 : 512) {
		if (HDF5_SIGNATURE.every((b, i) => bytes[offset + i] === b)) return true;
		if (offset >= 1 << 20) break;   // a user block is never this big
	}
	return false;
}

// HDF5 dataset element type ('<i4', '<f8', ...) -> typed array type.
const H5_TYPED = {
	"<i1": Int8Array, "|i1": Int8Array, "<u1": Uint8Array, "|u1": Uint8Array, "|b1": Uint8Array,
	"<i2": Int16Array, "<u2": Uint16Array,
	"<i4": Int32Array, "<u4": Uint32Array,
	"<i8": BigInt64Array, "<u8": BigUint64Array,
	"<f4": Float32Array, "<f8": Float64Array,
};

/** msgpack type name for a numeric HDF5 column, as DIALS writes it in
 *  msgpack files (from the column's shape), or null if not numeric. */
function _h5TypeName(dataset) {
	const dt = String(dataset.dtype);
	const isFloat = /f\d$/.test(dt);
	const isInt = /[iu]\d$/.test(dt);
	if (!isFloat && !isInt) return null;
	const size = Number(dt.slice(-1));
	const signed = /i\d$/.test(dt);
	const shape = dataset.shape ?? [];
	if (shape.length === 1) {
		if (isFloat) return size === 8 ? "double" : "float";
		if (size === 8) return signed ? "int64_t" : "std::size_t";
		return signed ? "int" : "unsigned int";
	}
	if (shape.length === 2) {
		if (isInt && shape[1] === 6) return "int6";
		if (isInt && shape[1] === 3) return "cctbx::miller::index<>";
		if (isFloat && shape[1] === 3) return "vec3<double>";
		if (isFloat && shape[1] === 2) return "vec2<double>";
	}
	if (shape.length === 3 && isFloat && shape[1] === 3 && shape[2] === 3) {
		return "mat3<double>";
	}
	return "unknown";
}

/** Values of one HDF5 dataset as a little-endian typed array, or null if
 *  the element type isn't a plain number (strings, compounds, ...). */
function _h5Column(dataset) {
	const T = H5_TYPED[dataset.dtype];
	if (!T) return null;
	const values = dataset.value;
	if (T === BigInt64Array || T === BigUint64Array) {
		// 64-bit integers (e.g. flags, panel) come back as JS numbers
		const out = new T(values.length);
		for (let i = 0; i < values.length; i++) out[i] = BigInt(Math.trunc(Number(values[i])));
		return out;
	}
	return T.from(values);
}

function _concat(a, b) {
	const out = new a.constructor(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
}

/**
 * Columns of a DIALS HDF5 reflection table, in the msgpack layout:
 * { name: [type, [nrows, Uint8Array of the column's bytes]] }.
 *
 * Layout: /dials/<process name>/<group>/<column>. The process name is
 * "processing" today; as upstream, any name is accepted and the last one is
 * used. A table split over several groups (group_0, group_1, ...) is joined
 * in order, keeping only columns present in every group (otherwise rows
 * would no longer line up). Subgroups such as shoebox/ are skipped.
 */
function _reflFromHdf5(arrayBuffer, filename) {
	const file = new hdf5.File(arrayBuffer, filename ?? "");
	if (file.attrs?.file_type !== "dials_processed_data") {
		throw new Error("This HDF5 file is not a DIALS reflection table.");
	}
	const version = Number(file.attrs?.file_version);
	if (version !== 1) {
		throw new Error(`Unsupported DIALS reflection table file_version ${version} (RLV reads version 1).`);
	}
	const dials = file.get("dials");
	const processes = dials instanceof hdf5.Group ? dials.keys : [];
	if (!processes.length) {
		throw new Error("No reflection data found under /dials in this HDF5 file.");
	}
	const process = dials.get(processes[processes.length - 1]);
	const groupNames = (process instanceof hdf5.Group ? process.keys : [])
		.filter(k => process.get(k) instanceof hdf5.Group)
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	if (!groupNames.length) {
		throw new Error("No reflection table found in this HDF5 file.");
	}

	const columns = {};
	for (const g of groupNames) {
		const group = process.get(g);
		for (const name of group.keys) {
			const ds = group.get(name);
			if (!(ds instanceof hdf5.Dataset)) continue;
			const type = _h5TypeName(ds);
			const col = type ? _h5Column(ds) : null;
			if (!col) continue;
			const c = columns[name] ??= { type, nrows: 0, count: 0, data: null };
			c.nrows += ds.shape?.[0] ?? col.length;
			c.count++;
			c.data = c.data ? _concat(c.data, col) : col;
		}
	}

	const refl = {};
	for (const [name, c] of Object.entries(columns)) {
		if (c.count !== groupNames.length) continue;   // rows wouldn't align
		refl[name] = [c.type, [c.nrows,
			new Uint8Array(c.data.buffer, c.data.byteOffset, c.data.byteLength)]];
	}
	return refl;
}

/** Columns of a msgpack reflection table: decoded[2].data. */
function _reflFromMsgpack(bytes) {
	const decoded = deserialize(bytes);
	const data = Array.isArray(decoded) ? decoded[2]?.data : null;
	if (!data) {
		throw new Error("Not a DIALS reflection table (neither msgpack nor HDF5).");
	}
	return data;
}

export class ReflParser{

	constructor(){
		this.refl = null;
		this.indexedMap = {};
		this.unindexedMap = {};
		this.filename = null;
		this.rawReflData = null;
	}

	hasReflTable(){
		return (this.refl != null);
	}

	clearReflectionTable(){
		this.refl = null;
		this.rawReflData = null;
		this.indexedMap = {};
		this.unindexedMap = {};
		this.filename = null;
	}

	parseReflectionTableFromMsgpackFile = (file) => {
		const reader = new FileReader();

		return new Promise((resolve, reject) => {
			reader.onerror = () => {
				reader.abort();
				reject(new DOMException("Problem parsing input file."));
			};

			reader.onloadend = () => {
				// Decode first, so a bad file rejects the promise (shown to
				// the user) instead of failing later with an unclear error.
				try {
					this._setFromBytes(reader.result, file.name);
					resolve(reader.result);
				} catch (err) {
					reject(err);
				}
			};
			reader.readAsArrayBuffer(file);    
			this.filename = file.name;
		});
	};

	// The names below say "Msgpack" for history; all of them also read HDF5.

	parseReflectionTableFromMsgpack = (msgpackData) => {
		this._setFromBytes(msgpackData, this.filename);
		this.rawReflData = msgpackData;
	};

	parseReflectionTableFromJSONMsgpack = (msgpackData) => {
		const binaryData = Uint8Array.from(atob(msgpackData), c => c.charCodeAt(0));
		if (_isHdf5(binaryData)) {
			this.refl = _reflFromHdf5(binaryData.buffer, this.filename);
		} else {
			const decoded = decode(binaryData);
			this.refl = decoded[2]["data"];
		}
		this.rawReflData = msgpackData;
	}

	/** Set this.refl from the bytes of a .refl file (msgpack or HDF5). */
	_setFromBytes(data, filename) {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		if (_isHdf5(bytes)) {
			const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
				? bytes.buffer
				: bytes.slice().buffer;
			this.refl = _reflFromHdf5(buffer, filename);
		} else {
			this.refl = _reflFromMsgpack(bytes);
		}
	}

	containsColumn(column_name){
		return (column_name in this.refl);
	}

	getColumnBuffer(column_name){
		return this.refl[column_name][1][1];
	}

	getUint32Array(column_name) {
		if (!this.containsColumn(column_name)){
			return null;
		}
		const buffer = this.getColumnBuffer(column_name);
		const dataView = new DataView(buffer.buffer);
		const arr = new Uint32Array(buffer.byteLength / 8);
		let count = 0;
		
		for (let i = 0; i < buffer.byteLength; i += 8) {
			arr[count] = dataView.getUint32(buffer.byteOffset + i, true); 
			count++;
		}
		return arr;
	}

	getInt32Array(column_name) {
		if (!this.containsColumn(column_name)){
			return null;
		}
		const buffer = this.getColumnBuffer(column_name);
		const dataView = new DataView(buffer.buffer);
		const arr = new Int32Array(buffer.byteLength / 4);
		let count = 0;
		
		for (let i = 0; i < buffer.byteLength; i += 4) {
			arr[count] = dataView.getInt32(buffer.byteOffset + i, true); 
			count++;
		}
		return arr;
	}

	getDoubleArray(column_name){
		if (!this.containsColumn(column_name)){
			return null;
		}
		const buffer = this.getColumnBuffer(column_name);
		const dataView = new DataView(buffer.buffer);
		const arr = new Float64Array(buffer.length/8);
		let count = 0;
		for (let i = 0; i < buffer.byteLength; i+=8) {
		arr[count] = dataView.getFloat64(buffer.byteOffset + i, true);
		count++;
		}
		return arr;
	};

	getVec3DoubleArray(column_name){
		if (!this.containsColumn(column_name)){
			return null;
		}
		const buffer = this.getColumnBuffer(column_name);
		const dataView = new DataView(buffer.buffer);
		const arr = new Array(buffer.length/(8*3));
		let count = 0;
		for (let i = 0; i < buffer.byteLength; i+=24){
			const vec = new Float64Array(3);
			vec[0] = dataView.getFloat64(buffer.byteOffset + i, true);
			vec[1] = dataView.getFloat64(buffer.byteOffset + i+8, true);
			vec[2] = dataView.getFloat64(buffer.byteOffset + i+16, true);
			arr[count] = vec;
			count++;
		}
		return arr;
	}

	getVec6Int32Array(column_name){
		if (!this.containsColumn(column_name)){
			return null;
		}
		const buffer = this.getColumnBuffer(column_name);
		const arr = new Array(buffer.length/(6*4));
		const dataView = new DataView(buffer.buffer);
		let count = 0;
		for (let i = 0; i < buffer.length; i+=24){
			const vec = new Int32Array(6);
			vec[0] = dataView.getInt32(buffer.byteOffset + i, true);
			vec[1] = dataView.getInt32(buffer.byteOffset + i+4, true);
			vec[2] = dataView.getInt32(buffer.byteOffset + i+8, true);
			vec[3] = dataView.getInt32(buffer.byteOffset + i+12, true);
			vec[4] = dataView.getInt32(buffer.byteOffset + i+16, true);
			vec[5] = dataView.getInt32(buffer.byteOffset + i+20, true);
			arr[count] = vec;
			count++;
		}
		return arr;
	}

	getVec3Int32Array(column_name){
		if (!this.containsColumn(column_name)){
			return null;
		}
		const buffer = this.getColumnBuffer(column_name);
		const arr = new Array(buffer.length/(3*4));
		const dataView = new DataView(buffer.buffer);
		let count = 0;
		for (let i = 0; i < buffer.length; i+=12){
			const vec = new Int32Array(3);
			vec[0] = dataView.getInt32(buffer.byteOffset + i, true);
			vec[1] = dataView.getInt32(buffer.byteOffset + i+4, true);
			vec[2] = dataView.getInt32(buffer.byteOffset + i+8, true);
			arr[count] = vec;
			count++;
		}
		return arr;
	}

	getPanelNumbers(){
		return this.getUint32Array("panel");
	}

	getFlags(){
		return this.getUint32Array("flags")
	}

	isSummationIntegrated(flag){
		return (flag & (1 << 8)) === (1 << 8)
	}

	isPrfIntegrated(flag){
		return (flag & (1 << 9)) === (1 << 9)
	}

	isIndexed(flag){
		return (flag & (1 << 2)) === (1 << 2)
	}

	isObserved(flag){
		return (flag & (1 << 1)) === (1 << 1)
	}

	isPredicted(flag){
		return (flag & (1 << 0)) === (1 << 0)
	}


	getXYZObs(){
		return this.getVec3DoubleArray("xyzobs.px.value");
	}

	containsXYZObs(){
		return this.containsColumn("xyzobs.px.value");
	}

	getXYZObsMm(){
		return this.getVec3DoubleArray("xyzobs.mm.value");
	}

	containsXYZObsMm(){
		return this.containsColumn("xyzobs.mm.value");
	}

	getCrystalIDs(){
		return this.getInt32Array("crystal_id");
	}

	getWavelengths(){
		return this.getDoubleArray("wavelength");
	}

	containsWavelengths(){
		return this.containsColumn("wavelength");
	}

	getCalculatedWavelengths(){
		return this.getDoubleArray("wavelength_cal");
	}

	containsCalculatedWavelengths(){
		return this.containsColumn("wavelength_cal");
	}

	getXYZCal(){
		return this.getVec3DoubleArray("xyzcal.px");
	}

	containsXYZCal(){
		return this.containsColumn("xyzcal.px");
	}

	getXYZCalMm(){
		return this.getVec3DoubleArray("xyzcal.mm");
	}

	containsXYZCalMm(){
		return this.containsColumn("xyzcal.mm");
	}

	containsSummationIntensities(){
		return this.containsColumn("intensity.sum.value");
	}

	containsProfileIntensities(){
		return this.containsColumn("intensity.prf.value");
	}

	containsBoundingBoxes(){
		return this.containsColumn("bbox");
	}

	getBoundingBoxes(){
		return this.getVec6Int32Array("bbox");
	}

	containsMillerIndices(){
		return this.containsColumn("miller_index");
	}

	getMillerIndices(){
		return this.getVec3Int32Array("miller_index");
	}

	isValidMillerIndex(idx){
		return Math.abs(idx[0]) + Math.abs(idx[1]) + Math.abs(idx[2]) > 0
	}

	containsExperimentIDs(){
		return this.containsColumn("id");
	}

	getExperimentIDs(){
		return this.getInt32Array("id");
	}

	getImagesetIDs(){
		return this.getInt32Array("imageset_id");
	}

	getMillerIndexById(id){
		return this.indexedMap[id];
	}
}
