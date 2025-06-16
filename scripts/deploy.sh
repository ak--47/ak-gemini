#!/bin/bash

set -euo pipefail

# Load environment variables from .env
if [ -f .env ]; then
    export "$(grep -v '^#' .env | xargs)"
fi

# Generate env.yaml from environment variables
cat > env.yaml << EOF
# Generated from .env - DO NOT CHECK IN THIS FILE
NODE_ENV: "production"
GEMINI_API_KEY: "${GEMINI_API_KEY}"
LOG_LEVEL: "info"
CODE_PHRASE: "${CODE_PHRASE}"
EOF

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
