/*jslint node: true */
"use strict";
const _ = require('lodash');
const eventBus = require('ocore/event_bus.js');
const network = require('ocore/network.js');
const watcher = require('./watcher.js');
const CurveAA = require('./curve.js');

let bStarted = false;

async function getTipsByAA(aa) {
	if (!bStarted)
		await start();
	const curve = CurveAA.get(aa);
	if (!curve)
		throw Error('no curve ' + aa);
	
	const tips = await curve.getTips();
	return tips;
}


async function getAllTips() {
	if (!bStarted)
		await start();
	let all_tips = [];
	const curves = CurveAA.getAll();
	for (let curve_aa in curves) {
		const curve = curves[curve_aa];
		const tips = await curve.getTips();
		if (tips.length > 0) {
			all_tips = all_tips.concat(tips);
		}
	}
	return all_tips;
}

// this would result in very frequent updates on all curves
function subscribeToOracleUpdates(handleTips, delay = 1000) {
	if (!bStarted)
		start();
	const pushTips = async () => handleTips(await getAllTips());
	eventBus.on('data_feeds_updated', _.debounce(pushTips, delay));
}

// callback is called only when a request moves the price off-peg and the arb AA doesn't fix it within `delay` ms
function subscribeToRequests(handleTips, delay = 1000) {
	if (!bStarted)
		start();
	let handlers = {};
	const curves = CurveAA.getAll();
	for (let curve_aa in curves)
		handlers[curve_aa] = _.debounce(async () => {
			const tips = await getTipsByAA(curve_aa);
			if (tips.length > 0)
				handleTips(tips);
		}, delay);
	eventBus.on('aa_request_applied', (objAARequest) => {
		if (handlers[objAARequest.aa_address])
			handlers[objAARequest.aa_address]();
	});
}

function subscribe(handleTips, delay = 1000) {
	subscribeToRequests(handleTips, delay);
	subscribeToOracleUpdates(handleTips, delay);
}

async function start() {
	if (bStarted)
		return;
	network.start();
	await watcher.startWatching();
	bStarted = true;
}

exports.start = start;
exports.getTipsByAA = getTipsByAA;
exports.getAllTips = getAllTips;
exports.subscribeToOracleUpdates = subscribeToOracleUpdates;
exports.subscribeToRequests = subscribeToRequests;
exports.subscribe = subscribe;
