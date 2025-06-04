import { cloudEvent, http } from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import { tmpdir } from 'os';
import { sLog, uid, timer } from 'ak-tools';
import dotenv from 'dotenv';
import ai from './components/ai.js';
dotenv.config();

/**
 * @typedef {Object} Params
 * @property {string} [input] - user input
 * @property {string} [template] - the template to use
 */

/** @typedef {'/' | '/foo'} Endpoints  */


const { NODE_ENV = "" } = process.env;
if (!NODE_ENV) throw new Error("NODE_ENV is required");

const storage = new Storage();
const bucket = storage.bucket('ak-bucky');
const tmp = NODE_ENV === 'dev' ? './tmp' : tmpdir();


// http entry point
// ? https://cloud.google.com/functions/docs/writing/write-http-functions
http('entry', async (req, res) => {
	const runId = uid();
	const reqData = { url: req.url, method: req.method, headers: req.headers, body: req.body, runId };
	let response = {};

	try {
		/** @type {Params} */
		const { body = {} } = req;
		/** @type {Endpoints} */
		const { path } = req;

		const t = timer('job');
		t.start();
		sLog(`START: ${req.path}`, reqData);

		//setup the job
		const [job] = route(path);

		// @ts-ignore
		const result = await job(body);
		t.end()
		sLog(`FINISH: ${req.path} ... ${t.report(false).human}`, result);

		//finished
		res.status(200);
		response = result;


	} catch (e) {
		console.error(`ERROR JOB: ${req.path}`, e);
		res.status(500);
		response = { error: e };
	}
	res.send(JSON.stringify(response));
});

async function main(data) {
	return Promise.resolve({ status: "ok", message: "service is alive" });
}



/*
----
ROUTER
----
*/

/**
 * determine routes based on path in request
 * @param  {Endpoints} path
 */
function route(path) {
	switch (path) {
		case "/":
			return [main];
		case "/dungeon":
			return [ai];
		case "/schema":
			return [ai];
		case "/theme":
			return [ai];
		case "/random":
			return [ai];
		default:
			throw new Error(`Invalid path: ${path}`);
	}
}

