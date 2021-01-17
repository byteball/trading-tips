"use strict";

const conf = require('./advisor_conf.js');
const dag = require('aabot/dag.js');

let symbolsByAsset = {
	base: 'GBYTE',
};

async function getSymbol(asset) {
	if (!symbolsByAsset[asset]) {
		symbolsByAsset[asset] = await dag.readAAStateVar(conf.token_registry_aa, 'a2s_' + asset);
	//	if (!symbolsByAsset[asset])
	//		throw Error(`no symbol for asser ${asset}`);
	}
	return symbolsByAsset[asset];
}

exports.getSymbol = getSymbol;
