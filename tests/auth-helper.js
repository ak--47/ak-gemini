/**
 * Shared auth helper for tests. Vertex AI only.
 *
 * Requires GOOGLE_CLOUD_PROJECT in .env and Application Default Credentials
 * (run `gcloud auth application-default login`).
 *
 * Captures env at module load, then deletes from process.env so library code
 * can't fall back to implicit env lookup — tests must pass auth explicitly
 * via BASE_OPTIONS.
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const capturedProject = process.env.GOOGLE_CLOUD_PROJECT;
const capturedLocation = process.env.GOOGLE_CLOUD_LOCATION;

if (!capturedProject) {
	throw new Error(
		"Tests require GOOGLE_CLOUD_PROJECT in .env (Vertex AI mode). " +
		"Also requires Application Default Credentials: `gcloud auth application-default login`."
	);
}

// Force tests to pass auth explicitly via BASE_OPTIONS
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_LOCATION;

export const GOOGLE_CLOUD_PROJECT = capturedProject;
export const GOOGLE_CLOUD_LOCATION = capturedLocation || 'us-central1';

export const BASE_OPTIONS = {
	vertexai: true,
	project: capturedProject,
	location: GOOGLE_CLOUD_LOCATION,
	logLevel: 'warn'
};

if (!global.__AK_GEMINI_AUTH_LOGGED) {
	console.log(`\n[auth-helper] Vertex AI mode — project=${capturedProject} location=${GOOGLE_CLOUD_LOCATION}\n`);
	global.__AK_GEMINI_AUTH_LOGGED = true;
}
