#!/bin/bash

set -euo pipefail

# Load environment variables from project root .env
set -a
source "$(dirname "$0")/../.env"
set +a

# ensure we have CODE_PHRASE and GEMINI_API_KEY
if [[ -z "${CODE_PHRASE:-}" ]]; then
  echo "CODE_PHRASE is not set. Please set it in the .env file."
  exit 1
fi
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is not set. Please set it in the .env file."
  exit 1
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
	--allow-unauthenticated \
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

# delete env.yaml
rm env.yaml
