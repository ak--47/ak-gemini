#!/bin/bash
curl -X POST localhost:8080/random -H "Content-Type: application/json" -d '{
  "template": "dungeon-schema",
  "input": "dazn.com"
}' > schema.json