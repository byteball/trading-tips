"use strict";

const eventBus = require('ocore/event_bus.js');
const db = require('ocore/db.js');
const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex.js');
const formulaEvaluation = require("ocore/formula/evaluation.js");
const dag = require('aabot/dag.js');
const aa_state = require('aabot/aa_state.js');
const light_data_feeds = conf.bLight ? require('aabot/light_data_feeds.js') : null;
const tokenRegistry = require('./token_registry.js');

const ORACLE_UPDATE_INTERVAL = 2 * 60 * 1000;

let curves = {};

class CurveAA {
	#curve_aa;
	#params;
	#oracles;
	
	constructor(curve_aa, params, oracles) {
		this.#curve_aa = curve_aa;
		this.#params = params;
		this.#oracles = oracles;
		setInterval(() => this.updateDataFeeds(), ORACLE_UPDATE_INTERVAL);
	}

	static async create(curve_aa) {
		const unlock = await mutex.lock('create_' + curve_aa);
		if (curves[curve_aa]) {
			unlock();
			return curves[curve_aa];
		}
		const params = await dag.readAAParams(curve_aa);
		const oracles = await dag.executeGetter(curve_aa, 'get_oracles');

		if (conf.bLight)
			for (let oracle of oracles)
				await light_data_feeds.updateDataFeed(oracle.oracle, oracle.feed_name);

		await aa_state.followAA(curve_aa);

		const curveAA = new CurveAA(curve_aa, params, oracles);
		curves[curve_aa] = curveAA;
		unlock();
		return curveAA;
	}

	static get(curve_aa) {
		return curves[curve_aa];
	}

	static getAll() {
		return curves;
	}

	async updateDataFeeds(bForce, bQuiet) {
		if (!conf.bLight)
			return;
		let bUpdated = false;
		for (let oracle of this.#oracles)
			if (await light_data_feeds.updateDataFeed(oracle.oracle, oracle.feed_name, bForce))
				bUpdated = true;
		if (bUpdated && !bQuiet)
			eventBus.emit('data_feeds_updated');
	}

	async get_target_p2() {
		return await formulaEvaluation.executeGetterInState(db, this.#curve_aa, 'get_target_p2', [], aa_state.getUpcomingStateVars(), aa_state.getUpcomingBalances());
	}

	get_p2() {
		const p = this.#params;
		const v = aa_state.getUpcomingAAStateVars(this.#curve_aa);
		const s1 = v.supply1 / 10 ** p.decimals1;
		const s2 = v.supply2 / 10 ** p.decimals2;
		return v.dilution_factor * s1**p.m * p.n * s2**(p.n-1);
	}

	async getTips() {
		await this.updateDataFeeds(false, true);
		const target_p2 = await this.get_target_p2();
		const p2 = this.get_p2();
		const delta_p2 = p2 - target_p2;
		if (Math.abs(delta_p2) < 0.001 * target_p2) // on-peg
			return [];
		const p = this.#params;
		const m = p.m;
		const n = p.n;
		const mul1 = 10 ** p.decimals1;
		const mul2 = 10 ** p.decimals2;
		const mulr = 10 ** p.reserve_asset_decimals;
		const v = aa_state.getUpcomingAAStateVars(this.#curve_aa);
		if (!v.supply1 || !v.supply2) // not issued yet
			return [];
		const s1 = v.supply1 / mul1;
		const s2 = v.supply2 / mul2;

		const get_t1_tip = async () => {
			console.log(`looking for T1 tip in ${this.#curve_aa}`);
			const target_s1 = (target_p2 / n) ** (1 / m) * s2 ** ((1 - n) / m);
			const target_p1 = m * target_s1 ** (m - 1) * s2 ** n;

			// how many tokens need to be bought/sold to get back on peg
			const delta1 = Math.round(target_s1 * mul1) - v.supply1;

			// estimate p1 for a small transaction
			const tokens1 = Math.round(delta1 / 10);
			if (tokens1 === 0) // too small
				return null;
			try {
				var res = await formulaEvaluation.executeGetterInState(db, this.#curve_aa, 'get_exchange_result', [tokens1, 0], aa_state.getUpcomingStateVars(), aa_state.getUpcomingBalances());
			}
			catch (e) {
				console.log(`getter failed in T1 ${this.#curve_aa}`, e);
				return null;
			}
			const current_p1 = res.reserve_needed / mulr / (tokens1 / mul1);
			if (current_p1 < 0 && tokens1 < 0)
				throw Error(`negative current p1 ${current_p1}, tokens1=${tokens1}, reserve_needed=${res.reserve_needed}, aa=${this.#curve_aa}`);
			// negative p1 is possible when buying while the capacitor is very large
			const price_difference_percentage = current_p1 > 0 ? Math.abs(current_p1 - target_p1) / current_p1 * 100 : Infinity;
			const bProfitable = sign(delta1) == sign(target_p1 - current_p1);
			if (!bProfitable) {
				console.log(`T1 transaction is not profitable ${this.#curve_aa}`);
				return null;
			}
			return {
				aa: this.#curve_aa,
				action: delta1 > 0 ? 'buy' : 'sell',
				token_role: 'T1',
				token: await tokenRegistry.getSymbol(v.asset1),
				reserve_token: await tokenRegistry.getSymbol(p.reserve_asset || 'base'),
				current_price: current_p1,
				target_price: target_p1,
				price_difference_percentage,
				max_amount: Math.abs(delta1) / mul1,
			};
		};
		
		const get_t2_tip = async () => {
			console.log(`looking for T2 tip in ${this.#curve_aa}`);
			const target_s2 = (target_p2 / n) ** (1 / (n - 1)) * s1 ** (-m / (n - 1));

			// how many tokens need to be bought/sold to get back on peg
			const delta2 = Math.round(target_s2 * mul2) - v.supply2;

			// estimate p1 for a small transaction
			const tokens2 = Math.round(delta2 / 10);
			if (tokens2 === 0) // too small
				return null;
			try {
				var res = await formulaEvaluation.executeGetterInState(db, this.#curve_aa, 'get_exchange_result', [0, tokens2], aa_state.getUpcomingStateVars(), aa_state.getUpcomingBalances());
			}
			catch (e) {
				console.log(`getter failed in T2 ${this.#curve_aa}`, e);
				return null;
			}
			const current_p2 = res.reserve_needed / mulr / (tokens2 / mul2);
			if (current_p2 < 0 && tokens2 < 0)
				throw Error(`negative current p2 ${current_p2}, tokens2=${tokens2}, reserve_needed=${res.reserve_needed}, aa=${this.#curve_aa}`);
			// negative p1 is possible when buying while the capacitor is very large
			const price_difference_percentage = current_p2 > 0 ? Math.abs(current_p2 - target_p2) / current_p2 * 100 : Infinity;
			const bProfitable = sign(delta2) == sign(target_p2 - current_p2);
			if (!bProfitable) {
				console.log(`T2 transaction is not profitable ${this.#curve_aa}`);
				return null;
			}
			return {
				aa: this.#curve_aa,
				action: delta2 > 0 ? 'buy' : 'sell',
				token_role: 'T2',
				token: await tokenRegistry.getSymbol(v.asset2),
				reserve_token: await tokenRegistry.getSymbol(p.reserve_asset || 'base'),
				current_price: current_p2,
				target_price: target_p2,
				price_difference_percentage,
				max_amount: Math.abs(delta2) / mul2,
			};
		};
		
		let tips = [];
		const tip1 = await get_t1_tip();
		const tip2 = await get_t2_tip();
		if (tip1)
			tips.push(tip1);
		if (tip2)
			tips.push(tip2);

		return tips;
	}



}

const sign = x => x > 0 ? 1 : -1;

module.exports = CurveAA;
