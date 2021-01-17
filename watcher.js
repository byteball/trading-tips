/*jslint node: true */
"use strict";

const conf = require('./advisor_conf.js');
const mutex = require('ocore/mutex.js');
const network = require('ocore/network.js');
const eventBus = require('ocore/event_bus.js');
const aa_state = require('aabot/aa_state.js');
const dag = require('aabot/dag.js');
const CurveAA = require('./curve.js');

let bWatching = false;

async function startWatching() {
	const unlock = await mutex.lock('startWatching');
	if (bWatching)
		return unlock();
	
	// watch all curve AAs
	const curve_rows = await dag.getAAsByBaseAAs(conf.curve_base_aas);
	for (let row of curve_rows) {
		console.log(`will watch curve AA ${row.address}`);
		await CurveAA.create(row.address);
	}

	// watch all governance, deposit, T1 arb, and buffer AAs
	let base_aas = conf.governance_base_aas.concat([conf.deposit_base_aa, conf.buffer_base_aa]).concat(conf.arb_base_aas);
	const rows = await dag.getAAsByBaseAAs(base_aas);
	for (let row of rows) {
		console.log(`will watch AA ${row.address}`);
		await aa_state.followAA(row.address);
	}
	base_aas = base_aas.concat(conf.curve_base_aas);

	// watch for new AAs created based on base AAs
	for (let base_aa of base_aas) {
		await dag.loadAA(base_aa);
		network.addLightWatchedAa(base_aa); // to learn when new AAs are defined based on it
	}
	eventBus.on("aa_definition_applied", async (address, definition) => {
		let base_aa = definition[1].base_aa;
		if (base_aas.includes(base_aa)) {
			if (conf.curve_base_aas.includes(base_aa)) {
				console.log(`will watch new curve AA ${address}`);
				await CurveAA.create(address);
			}
			else {
				console.log(`will watch new non-curve AA ${address}`);
				await aa_state.followAA(address);
			}
		}
	});

	bWatching = true;
	unlock();
}

exports.startWatching = startWatching;

