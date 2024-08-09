import u from 'ak-tools';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const { GEMINI_API_KEY: API_KEY, NODE_ENV = "unknown" } = process.env;
if (!API_KEY) throw new Error("Please provide a Gemini API key");


async function askGemini(options = {}) {
	const { userInput = "ONLY answer in valid json...\n\ntell me a joke...", template = "" } = options;
	if (!userInput) throw new Error("user input is required!");
	const gemini = new GoogleGenerativeAI(API_KEY);
	const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
	const templateFile = `./data/prompt-${template}.txt`;
	let longFormPrompt = await u.load(templateFile, false, 'utf8', false, false);
	if (!longFormPrompt) longFormPrompt = "";

	const prompt = `
${longFormPrompt}

${userInput}
`.trim();

	let answer;
	let validator;
	let resultIsValid = false;
	let attempts = 0;

	switch (template) {
		case "dungeon-schema":
			validator = validateDungeonSchema;
			break;
		default:
			validator = () => true;
			break;
	}


	do {
		attempts++;
		const result = await model.generateContent(prompt);
		const response = await result.response;
		const text = response.text();
		answer = processResponse(text);
		resultIsValid = validator(answer);
	} while (!resultIsValid);

	return answer;
}

function processResponse(text) {
	let json;
	try {
		// check for ```json
		const start = text.indexOf("```json");
		const end = text.indexOf("```", start + 1);

		if (start === -1 || end === -1) {
			const start = text.indexOf("{");
			const end = text.lastIndexOf("}");
			json = text.slice(start, end + 1).trim();
		}

		json = text.slice(start + 7, end).trim();
	}
	catch (e) {
		return null;
	}

	try {
		return JSON.parse(json);
	}
	catch (e) {
		return null;
	}


}

function validateDungeonSchema(schema) {
	let valid = true;

	//null schema are always invalid
	if (!schema) valid = false;

	//must have 3 or more events
	if (schema.events.length < 3) valid = false;

	//must have 2 or more superProps
	if (Object.keys(schema.superProps).length < 2) valid = false;

	//must have 2 or more userProps
	if (Object.keys(schema.userProps).length < 2) valid = false;

	return valid;
}


if (import.meta.url === `file://${process.argv[1]}`) {

	askGemini(`aktunes.com a music producer...`)
		.then((result) => {
			if (NODE_ENV === "dev") debugger;
		})
		.catch((error) => {
			if (NODE_ENV === "dev") debugger;
		});
}


export default askGemini;