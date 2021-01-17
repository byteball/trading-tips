/*jslint node: true */
"use strict";
const advisor = require('./advisor.js');


async function start() {

	const all_tips = await advisor.getAllTips();
	console.error(all_tips);

}

start();

process.on('unhandledRejection', up => { throw up; });
