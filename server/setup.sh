#!/bin/bash

# Update package list and install python3 and pip
apt-get update
apt-get install -y python3 python3-pip

# Install Demucs
pip3 install demucs
