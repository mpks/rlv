import * as THREE from 'three';
import LZ4 from 'lz4js';


export class Experiment{
	/*
	 * Class for holding DIALS experiment info
	 */
	
	constructor(imageFilenames, crystalSummary, goniometer, crystal, scan, detectorPanelData, imageFilename){
		this.imageFilenames = imageFilenames;
		this.crystalSummary = crystalSummary;
		this.goniometer = goniometer;
		this.crystal = crystal;
		this.scan = scan;
		this.detectorPanelData = detectorPanelData;
		this.imageFilename = imageFilename;
		this.imageData = {};
	}

	parseImageData(imageData, panelIdx){
		const decompressedImageData = ExptParser.decompressImageData(imageData)
		this.imageData[panelIdx] = decompressedImageData;
	}

	parseExptImageData(imageData){
		for (let panelIdx = 0; panelIdx < imageData.length; panelIdx++){
			const panelImage = ExptParser.decompressImageData(
				imageData[panelIdx]);
			this.imageData[panelIdx] = panelImage;
		}
	}

	clearExperiment(){
		this.imageFilenames = null
		this.crystalSummary = null;
		this.goniometer = null;
		this.crystal = null;
		this.scan = null;
		this.detectorPanelData = null;
		this.imageFilename = null;
		this.imageData = {}
	}
}

export class ExptParser{

	/*
	 * Class for reading DIALS Experiment list files (.expt)
	 * https://dials.github.io/documentation/data_files.html
	 */

	constructor(){
		this.exptJSON = null;
		this.filename = null;
		this.experiments = {};
		this.crystals = {};
	}


	hasExptJSON(){
		return this.exptJSON != null;
	}


	static isDIALSExpt(file, content){
		const fileExt = file.name.split(".").pop() ;
		if (fileExt === "expt" && content[0] === "{"){
			return true;
		}
		return false;
	}

	static isExptJSON(data){
		try{
			return data["__id__"] == "ExperimentList";

		}catch(ex){
			return false;
		}
	}

	static decompressImageData(msg) {

		const { data: compressedData, shape, dtype } = msg;

		const decompressed = LZ4.decompress(new Uint8Array(compressedData));

		let dataArray;
		if (dtype === "float16") {
			const uint16 = new Uint16Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength / 2);
			dataArray = new Float32Array(uint16.length);
			for (let i = 0; i < uint16.length; i++) {
				const h = uint16[i];
				const exp = (h >> 10) & 0x1f;
				const frac = h & 0x3ff;
				const sign = h >> 15 ? -1 : 1;
				if (exp === 0) dataArray[i] = sign * 5.9604644775390625e-8 * frac;
				else if (exp === 31) dataArray[i] = frac ? NaN : sign * Infinity;
				else dataArray[i] = sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
			}
		} else {
			let TypedArray;
			switch (dtype) {
				case "float32": TypedArray = Float32Array; break;
				case "float64": TypedArray = Float64Array; break;
				case "int32":   TypedArray = Int32Array;   break;
				default: throw new Error(`Unsupported data type: ${dtype}`);
			}
			dataArray = new TypedArray(
				decompressed.buffer,
				decompressed.byteOffset,
				decompressed.byteLength / TypedArray.BYTES_PER_ELEMENT
			);
		}

		// Reshape
		if (shape.length === 2) {
			const [height, width] = shape;
			if (dataArray.length !== height * width) {
				throw new Error("Data length mismatch for 2D reshape");
			}
			const result = Array.from({ length: height }, (_, y) =>
				dataArray.slice(y * width, (y + 1) * width)
			);
			return result;
		} else if (shape.length === 3) {
			const [depth, height, width] = shape;
			if (dataArray.length !== depth * height * width) {
				throw new Error("Data length mismatch for 3D reshape");
			}
			const result = Array.from({ length: depth }, (_, d) =>
				Array.from({ length: height }, (_, h) =>
					dataArray.slice(
						(d * height * width) + (h * width),
						(d * height * width) + ((h + 1) * width)
					)
				)
			);
			return result;
		} else {
			throw new Error("Only 2D and 3D arrays are supported");
		}
	}

	clearExperiment(){
		this.exptJSON = null;
		this.filename = null;
		Object.values(this.experiments).forEach(experiment => experiment.clearExperiment());
		this.experiments = {};
		this.crystals = {};
	}

	parseExperiment = (file) => {
		const reader = new FileReader();

		return new Promise((resolve, reject) => {
			reader.onerror = () => {
				reader.abort();
				reject(new DOMException("Problem parsing .expt file."));
			};

			reader.onloadend = () => {
				resolve(reader.result);
				if (ExptParser.isDIALSExpt(file, reader.result)){
					this.exptJSON = JSON.parse(reader.result);
					for (var i = 0; i < this.numExperiments(); i++){
						this.experiments[i] = 
							new Experiment(
								this.getImageFilenames(i),
								this.getCrystalSummary(i),
								this.getGoniometer(i),
								this.getCrystal(i),
								this.getScan(i),
								this.getDetectorData(i),
								this.getImageFilenames(i)
						);
					}
					this.filename = file.name;
				}
			};
			reader.readAsText(file);    
		});
	};

	numExperiments(){
		if (this.exptJSON == null){
			return 0;
		}
		return this.exptJSON["imageset"].length;
	}

	parseExperimentJSON(jsonString){
		this.exptJSON = jsonString 
		this.imageFilenames = [];
		for (var i = 0; i < this.numExperiments(); i++){
			this.experiments[i] = 
				new Experiment(
					this.getImageFilenames(i),
					this.getCrystalSummary(i),
					this.getGoniometer(i),
					this.getCrystal(i),
					this.getScan(i),
					this.getDetectorData(i),
					this.getImageFilenames(i)
				);
			
			this.imageFilenames.push(this.getImageFilenames(i));
			this.crystals = this.getAllCrystals();
		}
	}

	parseImageData(imageData, panelIdx, exptID){
		this.experiments[exptID].parseImageData(imageData, panelIdx);
	}

	parseExptImageData(imageData, exptID){
		this.experiments[exptID].parseExptImageData(imageData);
	}

	getImageFilenames(idx){
		const fileIdx = this.exptJSON["experiment"][idx]["imageset"]
		return this.exptJSON["imageset"][fileIdx]["template"];
	}

	getDetectorData(idx){

		const rawDetectorPanelData = this.getRawDetectorPanelData(idx);
		var detectorData = this.getDetectorOrientationData(idx);
		var detectorPanelData = [];

		for (var i = 0; i < rawDetectorPanelData.length; i++){

			const panelData = rawDetectorPanelData[i];

			var pxSize = new THREE.Vector2(panelData["pixel_size"][0], panelData["pixel_size"][1]);
			var pxs = new THREE.Vector2(panelData["image_size"][0], panelData["image_size"][1]);
			var panelSize = new THREE.Vector2(pxSize.x*pxs.x, pxSize.y*pxs.y);
			var fa = new THREE.Vector3(panelData["fast_axis"][0], panelData["fast_axis"][1], panelData["fast_axis"][2]);
			var sa = new THREE.Vector3(panelData["slow_axis"][0], panelData["slow_axis"][1], panelData["slow_axis"][2]);
			var o = new THREE.Vector3(panelData["origin"][0], panelData["origin"][1], panelData["origin"][2]);

			var localDMatrix = new THREE.Matrix3(
				fa.x, sa.x, o.x,
				fa.y, sa.y, o.y,
				fa.z, sa.z, o.z
			);

			var detectorFa = new THREE.Vector3(
				detectorData["fast_axis"][0],
				detectorData["fast_axis"][1],
				detectorData["fast_axis"][2],
			);
			var detectorSa = new THREE.Vector3(
				detectorData["slow_axis"][0],
				detectorData["slow_axis"][1],
				detectorData["slow_axis"][2],
			);
			var detectorNormal = detectorFa.clone().cross(detectorSa);

			var parentOrientation = new THREE.Matrix3(
				detectorFa.x, detectorSa.x, detectorNormal.x,
				detectorFa.y, detectorSa.y, detectorNormal.y,
				detectorFa.z, detectorSa.z, detectorNormal.z
			);

			var parentOrigin = new THREE.Vector3(
				detectorData["origin"][0],
				detectorData["origin"][1],
				detectorData["origin"][2],
			)


			var dMatrixOffset = parentOrientation.clone().multiply(localDMatrix);
			var elems = dMatrixOffset.elements;
			elems[6] += parentOrigin.x;
			elems[7] += parentOrigin.y;
			elems[8] += parentOrigin.z;
			var dMatrix = new THREE.Matrix3().fromArray(
				elems
			)

			var scaledFa = fa.clone().multiplyScalar(panelSize.x);
			var scaledSa = sa.clone().multiplyScalar(panelSize.y);

			let centroid = o.clone();
			centroid.add(scaledFa.clone().multiplyScalar(.5));
			centroid.add(scaledSa.clone().multiplyScalar(.5));

			detectorPanelData.push({
				"panelSize" : panelSize,
				"pxSize" : pxSize,
				"pxs" : pxs,
				"fastAxis" : fa,
				"slowAxis" : sa,
				"scaledFastAxis" : scaledFa,
				"scaledSlowAxis" : scaledSa,
				"origin" : o,
				"dMatrix" : dMatrix,
				"centroid": centroid,
				"name" : panelData["name"]
			});
			
		}
		return detectorPanelData;
	}

	getRawDetectorPanelData(idx){
		const fileIdx = this.exptJSON["experiment"][idx]["detector"]
		return this.exptJSON["detector"][fileIdx]["panels"];
	}

	getBeamData(idx){
		const fileIdx = this.exptJSON["experiment"][idx]["beam"]
		return this.exptJSON["beam"][fileIdx];
	}

	getBeamSummary(idx){
		const beamData = this.getBeamData(idx);
		var direction = beamData["direction"];
		direction = [direction[0].toFixed(3), direction[1].toFixed(3), direction[2].toFixed(3)];
		const wavelength = beamData["wavelength"];
		var text = "direction: (" + direction + "), ";
		if (wavelength){
			text += " wavelength: " + wavelength.toFixed(3);
		}
		return text;
	}

	getGoniometer(idx){

		function isMultiAxesGoniometer(goniometerData){
			const requiredFields = ["axes", "angles", "scan_axis"];
			for (var i = 0; i < requiredFields.length; i++){
				if (!(requiredFields[i] in goniometerData)){
					return false;
				}
			}
			return true;
		}

		function basicGoniometer(goniometerData){
			const fr = goniometerData["fixed_rotation"];
			const sr = goniometerData["setting_rotation"];
			const ra = goniometerData["rotation_axis"];
			return  {
				"fixedRotation" : new THREE.Matrix3(
					fr[0], fr[1], fr[2],
					fr[3], fr[4], fr[5],
					fr[6], fr[7], fr[8]
				),
				"settingRotation": new THREE.Matrix3(
					sr[0], sr[1], sr[2],
					sr[3], sr[4], sr[5],
					sr[6], sr[7], sr[8]
				),
				"rotationAxis" : new THREE.Vector3(
					ra[0], ra[1], ra[2]
				)
			}
		}

		function multiAxesGoniometer(goniometerData){

			function axisAngleToMatrix(axis, angle) {

				const axisNormalized = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();

				const c = Math.cos(angle * Math.PI/180.);
				const s = Math.sin(angle * Math.PI/180.);

				const [x, y, z] = axisNormalized.toArray();

				const m11 = c + (1 - c) * x * x;
				const m12 = ((1 - c) * x * y) - (s * z);
				const m13 = ((1 - c) * x * z) + (s * y);

				const m21 = ((1 - c) * x * y) + (s * z);
				const m22 = c + ((1 - c) * y * y);
				const m23 = ((1 - c) * y * z) - (s * x);

				const m31 = ((1 - c) * x * z) - (s * y);
				const m32 = ((1 - c) * y * z) + (s * x);
				const m33 = c + (1 - c) * z * z;

				return new THREE.Matrix3().set(
					m11, m12, m13,
					m21, m22, m23,
					m31, m32, m33
				).transpose();
			}

			const axes = goniometerData["axes"];
			const angles = goniometerData["angles"];
			const scanAxis = goniometerData["scan_axis"];

			const rotationAxisRaw = axes[scanAxis];
			const rotationAxis = new THREE.Vector3(
				rotationAxisRaw[0],
				rotationAxisRaw[1],
				rotationAxisRaw[2]
			);

			var fixedRotation = new THREE.Matrix3(
				1.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 1.0
			);

			const settingRotation = new THREE.Matrix3(
				1.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 1.0
			);

			for (var i = 0; i < scanAxis; i++){
				const R = axisAngleToMatrix(axes[i], angles[i]);
				fixedRotation = fixedRotation.clone().multiply(R);
			}
			for (var i = scanAxis + 1; i < axes.length; i++){
				const R = axisAngleToMatrix(axes[i], angles[i]);
				settingRotation.multiply(R);
			}

			return {
				"fixedRotation" : fixedRotation,
				"settingRotation" : settingRotation,
				"rotationAxis" : rotationAxis
			};

		}

		const goniometerList = this.exptJSON["goniometer"];
		if (!goniometerList || goniometerList.length === 0){
			this.goniometer = null;
			return;
		}
		const fileIdx = this.exptJSON["experiment"][idx]["goniometer"];
		const goniometerData = goniometerList[fileIdx];
		if (isMultiAxesGoniometer(goniometerData)){
			return multiAxesGoniometer(goniometerData);
		}
		return basicGoniometer(goniometerData);
	}

	getCrystalData(idx){
		if (this.exptJSON["crystal"].length === 0){
			return null;
		}
		if(idx === undefined){return null;}
		var fileIdx = this.exptJSON["experiment"][idx]["crystal"];
		return this.exptJSON["crystal"][fileIdx];
	}

	getAllCrystalData(){
		return this.exptJSON["crystal"];

	}

	hasCrystal(idx){
		if (this.exptJSON === null){
			return false;
		}
		if (this.experiments === undefined){
			return false;
		}

		return this.experiments[idx].crystal !== null && this.experiments[idx].crystal !== undefined;
	}

	latticeParameters(a, b, c) {
		const aLength = a.length();
		const bLength = b.length();
		const cLength = c.length();
		const alpha = Math.acos(b.dot(c) / (bLength * cLength));
		const beta = Math.acos(a.dot(c) / (aLength * cLength));
		const gamma = Math.acos(a.dot(b) / (aLength * bLength));
		return [aLength, bLength, cLength, alpha, beta, gamma];
	}

	unitCellVolume(a, b, c, alpha, beta, gamma) {

		const cosAlphaSq = Math.cos(alpha) ** 2;
		const cosBetaSq = Math.cos(beta) ** 2;
		const cosGammaSq = Math.cos(gamma) ** 2;
		const cosAlpha = Math.cos(alpha);
		const cosBeta = Math.cos(beta);
		const cosGamma = Math.cos(gamma);

		const volume =
			a * b * c *
			Math.sqrt(
			1 -
				cosAlphaSq -
				cosBetaSq -
				cosGammaSq +
				2 * cosAlpha * cosBeta * cosGamma
			);

		return volume;
	}

	reciprocalLatticeConstants(a, b, c, alpha, beta, gamma, V){
		const rlcs = new Array(6);
		rlcs[0] = b * c * Math.sin(alpha) / V;
		rlcs[1] = c * a * Math.sin(beta) / V;
		rlcs[2] = a * b * Math.sin(gamma) / V;

		rlcs[3] = Math.cos(beta) * Math.cos(gamma) - Math.cos(alpha);
		rlcs[3] /= Math.sin(beta) * Math.sin(gamma);

		rlcs[4] = Math.cos(gamma) * Math.cos(alpha) - Math.cos(beta);
		rlcs[4] /= Math.sin(gamma) * Math.sin(alpha);

		rlcs[5] = Math.cos(alpha) * Math.cos(beta) - Math.cos(gamma);
		rlcs[5] /= Math.sin(alpha) * Math.sin(beta);

		return rlcs;
	}

	getBMatrix(aVec, bVec, cVec){
		const [a, b, c, alpha, beta, gamma] = this.latticeParameters(aVec, bVec, cVec);
		const V = this.unitCellVolume(a, b, c, alpha, beta, gamma);
		const rlcs = this.reciprocalLatticeConstants(a, b, c, alpha, beta, gamma, V);
		const rAlpha = Math.sqrt(1 - rlcs[3] * rlcs[3]);

		const fcs = new Array(9);

		fcs[0] = 1./a;
		fcs[1] = -Math.cos(gamma) / (Math.sin(gamma) * a);

		fcs[2] = -(
			Math.cos(gamma) * Math.sin(beta) * rlcs[3] + Math.cos(beta) * Math.sin(gamma)
			);
		fcs[2] /= Math.sin(beta) * rAlpha * Math.sin(gamma) * a;

		fcs[3] = 0.;
		fcs[4] = 1. / (Math.sin(gamma) * b);
		fcs[5] = rlcs[3] / (rAlpha * Math.sin(gamma) * b);
		fcs[6] = 0.;
		fcs[7] = 0.;
		fcs[8] = 1. / (Math.sin(beta) * rAlpha * c);

		return new THREE.Matrix3(
			fcs[0], fcs[1], fcs[2],
			fcs[3], fcs[4], fcs[5],
			fcs[6], fcs[7], fcs[8],
		);
	}

	getAllCrystals(){
		const allCrystalData = this.getAllCrystalData();
		if (!allCrystalData){
			this.crystalSummary = null;
			return;
		}
		const crystals = [];
		for (let i = 0; i < allCrystalData.length; i++){

			const crystalData = allCrystalData[i];
			var a = crystalData["real_space_a"];
			a = new THREE.Vector3(a[0], a[1], a[2]);
			var b = crystalData["real_space_b"];
			b = new THREE.Vector3(b[0], b[1], b[2]);
			var c = crystalData["real_space_c"];
			c = new THREE.Vector3(c[0], c[1], c[2]);

			const B = this.getBMatrix(a.clone(), b.clone(), c.clone());

			const UB = new THREE.Matrix3(
				a.x, a.y, a.z,
				b.x, b.y, b.z,
				c.x, c.y, c.z,
			).invert();


			const UBArr = UB.elements;
			UB.transpose();
			const U = new THREE.Matrix3();
			U.multiplyMatrices(B.clone().invert(), UB.clone());

			const reciprocalCell =  [
				new THREE.Vector3(UBArr[0], UBArr[3], UBArr[6]),
				new THREE.Vector3(UBArr[1], UBArr[4], UBArr[7]),
				new THREE.Vector3(UBArr[2], UBArr[5], UBArr[8]),
			]

			crystals.push({
				"U" : U,
				"B" : B,
				"UB": UB,
				"reciprocalCell": reciprocalCell});

		}

		return crystals;
	}


	getCrystal(exptID){
		const crystalData = this.getCrystalData(exptID);
		if (!crystalData){
			this.crystalSummary = null;
			return;
		}
		var a = crystalData["real_space_a"];
		a = new THREE.Vector3(a[0], a[1], a[2]);
		var b = crystalData["real_space_b"];
		b = new THREE.Vector3(b[0], b[1], b[2]);
		var c = crystalData["real_space_c"];
		c = new THREE.Vector3(c[0], c[1], c[2]);

		const B = this.getBMatrix(a.clone(), b.clone(), c.clone());

		const UB = new THREE.Matrix3(
			a.x, a.y, a.z,
			b.x, b.y, b.z,
			c.x, c.y, c.z,
		).invert();


		const UBArr = UB.elements;
		UB.transpose();
		const U = new THREE.Matrix3();
		U.multiplyMatrices(B.clone().invert(), UB.clone());

		const reciprocalCell =  [
			new THREE.Vector3(UBArr[0], UBArr[3], UBArr[6]),
			new THREE.Vector3(UBArr[1], UBArr[4], UBArr[7]),
			new THREE.Vector3(UBArr[2], UBArr[5], UBArr[8]),
		]

		return {
			"U" : U,
			"B" : B,
			"UB": UB,
			"reciprocalCell": reciprocalCell,
			"exptID": exptID
		};
	}

	getCrystalRLV(idx){
		return this.experiments[idx].crystal["reciprocalCell"];
	}

	getAllCrystalRLVs(){
		if (!this.crystals){return null;}
		const crystalRLVs = [];
		for (let i = 0; i < this.crystals.length; i++){
			crystalRLVs.push([
				this.crystals[i]["reciprocalCell"][0].clone(),
				this.crystals[i]["reciprocalCell"][1].clone(),
				this.crystals[i]["reciprocalCell"][2].clone()
			]);
		}
		return crystalRLVs;
	}

	getAllCrystalRCVs(){
		if (!this.crystals){return null;}
		const crystalRCVs = [];
		for (let i = 0; i < this.crystals.length; i++){
			const B = this.crystals[i]["B"].clone().elements;
			crystalRCVs.push([
				new THREE.Vector3(B[0], B[3], B[6]),
				new THREE.Vector3(B[1], B[4], B[7]),
				new THREE.Vector3(B[2], B[5], B[8]),
			]);
		}
		return crystalRCVs;
	}



	getCrystalU(idx){
		return this.crystals[idx]["U"].clone();
	}


	getCrystalSummary(idx){
		if (this.experiments !== undefined){
			if (this.experiments[idx] !== undefined){
				if (this.experiments[idx].crystalSummary !== undefined){
					return this.experiments[idx].crystalSummary;
				}
				return null
			}
		}
		const crystalData = this.getCrystalData(idx);
		if (!crystalData){
			return null;
		}
		const aRaw = crystalData["real_space_a"];
		const aVec = new THREE.Vector3(aRaw[0], aRaw[1], aRaw[2]);
		const bRaw = crystalData["real_space_b"];
		const bVec = new THREE.Vector3(bRaw[0], bRaw[1], bRaw[2]);
		const cRaw = crystalData["real_space_c"];
		const cVec = new THREE.Vector3(cRaw[0], cRaw[1], cRaw[2]);

		const a = aVec.length().toFixed(3);
		const b = bVec.length().toFixed(3);
		const c = cVec.length().toFixed(3);

		const alpha = (bVec.angleTo(cVec) * (180./Math.PI)).toFixed(3);
		const beta = (aVec.angleTo(cVec) * (180./Math.PI)).toFixed(3);
		const gamma = (aVec.angleTo(bVec) * (180./Math.PI)).toFixed(3);

		var text = "a: " + a + " b: " + b + " c: " + c;
		text += " alpha: " + alpha + " beta: " + beta + " gamma: " + gamma;
		text += " (" + crystalData["space_group_hall_symbol"] + ")";
		return text;
	}

	getDetectorOrientationData(idx){
		const fileIdx = this.exptJSON["experiment"][idx]["detector"];

		return this.exptJSON["detector"][fileIdx]["hierarchy"];
	}

	getDetectorPanelDataByIdx(exptIdx, idx){
		return this.experiments[exptIdx].detectorPanelData[idx];
	}

	getDetectorPanelName(exptIdx, idx){
		return this.getDetectorPanelDataByIdx(exptIdx, idx)["name"];
	}

	getDetectorPanelCorners(exptIdx, idx){

		const vecs = this.getDetectorPanelDataByIdx(exptIdx, idx);

		// Corners
		var c1 = vecs["origin"].clone();
		var c2 = vecs["origin"].clone().add(vecs["scaledFastAxis"]);
		var c3 = vecs["origin"].clone().add(vecs["scaledFastAxis"]).add(vecs["scaledSlowAxis"]);
		var c4 = vecs["origin"].clone().add(vecs["scaledSlowAxis"]);
		return [c1, c2, c3, c4];
	}

	getDetectorPanelNormal(exptIdx, idx){
		const vecs = this.getDetectorPanelDataByIdx(exptIdx, idx);
		return vecs["scaledFastAxis"].clone().cross(vecs["scaledSlowAxis"].clone()).normalize();

	}

	getDetectorPanelIdxByName(exptIdx, name){
		const detectorData = this.experiments[exptIdx].detectorPanelData;
		for (let i = 0; i < detectorData.length; i++){
			if (detectorData[i].name === name){
				return i;
			} 
		}
		return null;

	}

	getDetectorPanelDataByName(exptIdx, name){
		const detectorData = this.experiments[exptIdx].detectorPanelData;
		for (let i = 0; i < detectorData.length; i++){
			if (detectorData[i].name === name){
				return detectorData[i];
			} 
		}
		return null;
	}

	getDetectorPanelCentroidByName(exptIdx, name){
		const panelData = this.getDetectorPanelDataByName(exptIdx, name);
		if (panelData !== null){
			return panelData["centroid"];
		}
		return null;
	}

	getDetectorPanelSize(exptIdx, idx){
		return this.experiments[exptIdx].detectorPanelData[idx]["pxs"]
	}

	getBeamDirection(idx){
		const beamData = this.getBeamData(idx);
		return new THREE.Vector3(
			beamData["direction"][0], 
			beamData["direction"][1], 
			beamData["direction"][2]
		);
	}

	getNumDetectorPanels(idx){
		return this.experiments[idx].detectorPanelData.length;
	}

	getScanData(idx){
		if (!("scan" in this.exptJSON)){
			return null;
		}
		var fileIdx = this.exptJSON["experiment"][idx]["scan"];
		return this.exptJSON["scan"][fileIdx];
	}

	getScan(idx){
		const scanData = this.getScanData(idx);
		if (!scanData){
			return null
		}
		if (!("oscillation" in scanData["properties"])){
			return null
		}

		const osc = new THREE.Vector2(
			scanData["properties"]["oscillation"][0] * Math.PI/180.,
			scanData["properties"]["oscillation"][1] * Math.PI/180.
		);

		const ir = new THREE.Vector2(
			scanData["image_range"][0] - 1,
			scanData["image_range"][1] - 1
		);


		return {
			"oscillation" : osc,
			"imageRange" : ir
		};
	}

	getAngleFromFrame(scan, frame){
		if (scan === null){
			return null;
		}
		const osc = scan["oscillation"];
		const ir = scan["imageRange"];
		return osc.x + ((frame - ir.x) * osc.y)
	}

	addAnglesToReflections(reflections){
		for (var i = 0; i < reflections.length; i++){
			var scan = this.experiments[reflections[i]["exptID"]].scan;
			if ("xyzObs" in reflections[i]){
				var angleObs;
				if (scan === null || scan === undefined){
					angleObs = 0.0;
				}
				else{
					angleObs = this.getAngleFromFrame(
						scan,
						reflections[i]["xyzObs"][2]
					);
				}
				reflections[i]["angleObs"] = angleObs;

			}
			if ("xyzCal" in reflections[i]){
				var angleCal;
				if (scan === null){
					angleCal = 0.0;
				}
				else{
					angleCal = this.getAngleFromFrame(
						scan,
						reflections[i]["xyzCal"][2]
					);
				}
				reflections[i]["angleCal"] = angleCal;
			}
		}
		return reflections;
	}

	getExptIDs(){
		let exptIDs = [];
		this.exptJSON.experiment.forEach((expt, idx) => {
			exptIDs.push(idx);
		});
		return exptIDs;
	}

	getImagesetIDs(){
		return Object.keys(this.experiments);
	}

	getExptLabels() {
		// Check if oscpu is available; if not, use a fallback like navigator.platform
		var isWindows = window.navigator.oscpu ? window.navigator.oscpu.indexOf("Windows") > -1 
											: window.navigator.platform.indexOf("Win") > -1;

		var exptLabels = [];
		for (let i in this.experiments) {
			var label = this.experiments[i].imageFilename;
			if (isWindows) {
				exptLabels.push(label.split("\\").pop());
			} else {
				exptLabels.push(label.split("/").pop());
			}
		}
		return exptLabels;
	}

	getCrystalIDsMap(){
        // Returns {expt_id : crystal_id}
		const crystal_ids = { "-1": "-1" };
	
		this.exptJSON.experiment.forEach((expt, idx) => {
		if ("crystal" in expt) {
			crystal_ids[idx.toString()] = expt.crystal.toString();
		} else {
			crystal_ids[idx.toString()] = "-1";
		}
		});
		
		return crystal_ids;
  }

}
