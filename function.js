import { http } from '@google-cloud/functions-framework';
import dotenv from 'dotenv';
dotenv.config();

import AITransformer from './index.js';
import { sLog, uid, timer } from 'ak-tools';

const { NODE_ENV = "" } = process.env;
if (!NODE_ENV) throw new Error("NODE_ENV is required");

const transformers = {}; // { [id]: AITransformer }

/**
 * Returns or creates a transformer instance for a given ID.
 * @param {string} id
 * @param {object} [options]
 * @returns {Promise<AITransformer>}
 */
async function getTransformer(id = 'default', options = {}) {
	if (!transformers[id]) {
		transformers[id] = new AITransformer(options);
		await transformers[id].init();
	}
	return transformers[id];
}

function sendJson(res, status, obj) {
	res.status(status).set('content-type', 'application/json').send(JSON.stringify(obj));
}

http('entry', async (req, res) => {
	const runId = uid();
	const t = timer('job');
	t.start();

	// ID may come from query, body, or headers
	const id =
		req.query?.id ||
		req.body?.id ||
		req.headers['x-transformer-id'] ||
		'default';

	const path = req.path || req.url || '/';
	sLog(`START: ${path} (ID=${id})`, { runId, method: req.method, body: req.body });

	try {
		let result;

		switch (path) {
			case '/':
				result = { status: 'ok', message: 'Service is alive', runId };
				break;			
			case '/init':
				// Allows per-ID config
				transformers[id] = new AITransformer(req.body?.options || {});
				await transformers[id].init();
				result = { status: 'initialized', model: transformers[id].modelName, id };
				break;

			case '/seed':
				{
					const transformer = await getTransformer(id);
					if (!req.body?.examples) throw new Error("Missing 'examples' in POST body.");
					await transformer.seed(req.body.examples);
					result = { status: 'seeded', count: req.body.examples.length, id };
				}
				break;

			case '/transform':
				{
					const transformer = await getTransformer(id);
					if (!req.body?.payload) throw new Error("Missing 'payload' in POST body.");
					result = await transformer.message(req.body.payload);
				}
				break;

			case '/validate':
				{
					const transformer = await getTransformer(id);
					if (!req.body?.payload || !req.body?.validator) throw new Error("POST body must have 'payload' and 'validator' keys.");
					const validator = eval(req.body.validator); // See previous security note!
					result = await transformer.transformWithValidation(req.body.payload, validator, req.body.options || {});
				}
				break;

			case '/reset':
				{
					const transformer = await getTransformer(id);
					await transformer.reset();
					result = { status: 'reset', id };
				}
				break;

			default:
				sendJson(res, 404, { error: `Invalid path: ${path}` });
				return;
		}

		sLog(`FINISH: ${path} (ID=${id}) ... ${t.report(false).human}`, result);
		sendJson(res, 200, result);

	} catch (e) {
		console.error(`ERROR JOB: ${path} (ID=${id})`, e);
		sendJson(res, 500, { error: (e && e.message) || String(e) });
	}
});
