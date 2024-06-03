import os
import subprocess
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import boto3
import shutil
import logging
from basic_pitch.inference import predict_and_save, Model
from basic_pitch import ICASSP_2022_MODEL_PATH


app = Flask(__name__)

UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'output/stems'
OUTPUTMIDI_FOLDER = 'output/midi'
STEMS_FOLDER = os.path.join(OUTPUT_FOLDER, 'htdemucs/input')
MIDI_FOLDER = os.path.join(OUTPUT_FOLDER, 'midi')
ALLOWED_EXTENSIONS = {'mp3', 'm4a', 'wav'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
basic_pitch_model = Model(ICASSP_2022_MODEL_PATH)


s3_client = boto3.client('s3', aws_access_key_id='AKIA2UC27YE52KOF5NUQ',
    aws_secret_access_key='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',
    region_name='us-east-2')
BUCKET_NAME = 'tunetweak'


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s:%(message)s',
    handlers=[
        logging.FileHandler("app.log"),
        logging.StreamHandler()
    ]
)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def ensure_directories():
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    os.makedirs(STEMS_FOLDER, exist_ok=True)
    os.makedirs(MIDI_FOLDER, exist_ok=True)

def clean_directory(directory):
    for filename in os.listdir(directory):
        file_path = os.path.join(directory, filename)
        if os.path.isfile(file_path) or os.path.islink(file_path):
            os.unlink(file_path)
        elif os.path.isdir(file_path):
            shutil.rmtree(file_path)

def upload_to_s3(file_path, bucket_name, object_name=None):
    if object_name is None:
        object_name = os.path.basename(file_path)
    try:
        s3_client.upload_file(file_path, bucket_name, object_name)
        logging.info(f"File {file_path} uploaded to {bucket_name}/{object_name}")
    except Exception as e:
        print(f"Error uploading file: {e}")
        logging.error(f"Error uploading file: {e}")
        return None
    return f"https://{bucket_name}.s3.amazonaws.com/{object_name}"

def convert_wav_to_midi(wav_file_path, midi_output_path):
    try:
        print(f"path is {wav_file_path}")
        print(f"output path is {midi_output_path}")
        predict_and_save([wav_file_path], OUTPUTMIDI_FOLDER,  save_midi=True, sonify_midi=False,  save_model_outputs=False, save_notes=False, model_or_model_path=basic_pitch_model)
        logging.info(f"Converted {wav_file_path} to MIDI {midi_output_path}")
        return True
    except Exception as e:
        logging.error(f"Error converting {wav_file_path} to MIDI: {e}")
        return False


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return "No file part", 400
    
    file = request.files['file']
    
    if file.filename == '':
        return "No selected file", 400
    
    if file and allowed_file(file.filename):
        ensure_directories()
        clean_directory(STEMS_FOLDER)
        clean_directory(MIDI_FOLDER)

        filename = secure_filename(file.filename)
        input_file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(input_file_path)

        demucs_command = f"demucs -o {OUTPUT_FOLDER} {input_file_path}"
        try:
            subprocess.run(demucs_command, check=True, shell=True)

            stem_files = [f for f in os.listdir(STEMS_FOLDER) if os.path.isfile(os.path.join(STEMS_FOLDER, f))]
            for stem in stem_files:
                stem_path = os.path.join(STEMS_FOLDER, stem)
                midi_output_path = os.path.join(MIDI_FOLDER, os.path.splitext(stem)[0] + '.mid')
                print(midi_output_path)
                print(f"quack {stem_path}")
                if not convert_wav_to_midi(stem_path, midi_output_path):
                    return "MIDI conversion failed", 500
            midi_files = [f for f in os.listdir(OUTPUTMIDI_FOLDER) if os.path.isfile(os.path.join(OUTPUTMIDI_FOLDER, f))]
            print(f"my midi files {midi_files}")

            uploaded_stem_urls = [upload_to_s3(os.path.join(STEMS_FOLDER, stem), BUCKET_NAME) for stem in stem_files]
            uploaded_midi_urls = [upload_to_s3(os.path.join(OUTPUTMIDI_FOLDER, midi), BUCKET_NAME) for midi in midi_files]
            
            for midi_file in midi_files:
                try:
                    os.remove(os.path.join(OUTPUTMIDI_FOLDER, midi_file))
                    logging.info(f"Deleted local MIDI file {midi_file}")
                except Exception as e:
                    logging.error(f"Error deleting local MIDI file {midi_file}: {e}")


            response = {
                'message': 'Stemming and upload completed',
                'stems': uploaded_stem_urls,
                'midis': uploaded_midi_urls
            }
            return jsonify(response)
        
        except subprocess.CalledProcessError as e:
            return f"Demucs processing failed: {str(e)}", 500

    return "Invalid file type", 400

@app.route('/output/<filename>', methods=['GET'])
def serve_file(filename):
    return send_from_directory(OUTPUT_FOLDER, filename)

if __name__ == '__main__':
    app.run(port=3001)