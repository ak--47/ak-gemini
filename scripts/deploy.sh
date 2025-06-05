#!/bin/bash

set -euo pipefail

cp package.json package.deploy.json
jq '.main = "function.js"' package.deploy.json > package.json

gcloud alpha functions deploy ak-gemini \
	--gen2 \
	--no-allow-unauthenticated \
	--env-vars-file env.yaml \
	--runtime nodejs20 \
	--region us-central1 \
	--trigger-http \
	--memory 256mb \
	--entry-point entry \
	--source . \
	--timeout=3600 \
	--max-instances=100 \
	--min-instances=0

# Restore original package.json
mv package.deploy.json package.json
