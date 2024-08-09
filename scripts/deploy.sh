#!/bin/bash

# http deploy
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
	--min-instances=0 \
	--concurrency=10