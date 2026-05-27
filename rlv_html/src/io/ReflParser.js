import { deserialize, decode } from "@ygoe/msgpack";

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
				resolve(reader.result);
				const decoded = deserialize(new Uint8Array(reader.result));
				this.refl = decoded[2]["data"];
			};
			reader.readAsArrayBuffer(file);    
			this.filename = file.name;
		});
	};

	parseReflectionTableFromMsgpack = (msgpackData) => {
		const decoded = deserialize(new Uint8Array(msgpackData));
		this.refl = decoded[2]["data"];
		this.rawReflData = msgpackData;
	};

	parseReflectionTableFromJSONMsgpack = (msgpackData) => {
		const binaryData = Uint8Array.from(atob(msgpackData), c => c.charCodeAt(0));
		const decoded = decode(binaryData);
		this.refl = decoded[2]["data"];
		this.rawReflData = msgpackData;
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
