#!/usr/bin/env bash
set -e

echo "Starting setup..."

# Install Node.js dependencies
npm install

# Install Python dependencies including demucs
python3 -m pip install -r requirements.txt

# Ensure directories exist
mkdir -p /opt/render/project/src/server/output

# Check for input file
if [ ! -f /opt/render/project/src/server/input.mp3 ]; then
  echo "Input file not found: /opt/render/project/src/server/input.mp3"
  exit 1
fi

echo "Running demucs..."
# Run demucs command and capture output and errors
demucs -o /opt/render/project/src/server/output /opt/render/project/src/server/input.mp3 > /opt/render/project/src/server/demucs_output.log 2> /opt/render/project/src/server/demucs_error.log

# Check if demucs command was successful
if [ $? -ne 0 ]; then
  echo "Demucs command failed. Check logs for details."
  cat /opt/render/project/src/server/demucs_error.log
  exit 1
fi

echo "Demucs command completed successfully."

# Start your Node.js server
npm start