const express = require('express');
const multer = require('multer');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const { uploadSong } = require('./s3');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/output', express.static(path.join(__dirname, 'output')));

app.post('/upload', upload.single('file'), async (req, res) => {
  const uploadsDir = path.join(__dirname, 'uploads');
  const outputDir = path.join(__dirname, 'output');
  const stemsDir = path.join(outputDir, 'stems');
  const midiDir = path.join(outputDir, 'midi');
  const inputFilePath = path.join(__dirname, 'input' + path.extname(req.file.originalname));

  try {
    console.log('Received file upload');

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(stemsDir)) {
      fs.mkdirSync(stemsDir, { recursive: true });
    }
    if (!fs.existsSync(midiDir)) {
      fs.mkdirSync(midiDir, { recursive: true });
    }

    fs.readdirSync(stemsDir).forEach((file) => {
      fs.unlinkSync(path.join(stemsDir, file));
    });
    fs.readdirSync(midiDir).forEach((file) => {
      fs.unlinkSync(path.join(midiDir, file));
    });

    const tempFilePath = req.file.path;
    fs.rename(tempFilePath, inputFilePath, (err) => {
      if (err) {
        console.error(`Rename error: ${err.message}`);
        return res.status(500).send('File processing failed');
      }

      console.log('File successfully renamed to input');

      const demucsCommand = `demucs -o ${outputDir} ${inputFilePath}`;
      exec(demucsCommand, async (error, stdout, stderr) => {
        if (error) {
          console.error(`Demucs error: ${error.message}`);
          return res.status(500).send('Stemming failed');
        }

        console.log('Stems successfully created');

        const stemsPath = path.join(outputDir, 'htdemucs', 'input');
        const stems = fs.readdirSync(stemsPath).filter(file => file.endsWith('.wav'));

        stems.forEach(stem => {
          fs.renameSync(path.join(stemsPath, stem), path.join(stemsDir, stem));
        });

        console.log('Stems successfully moved to stems directory');

        const midiPromises = stems.map(stem => {
          const stemFilePath = path.join(stemsDir, stem);
          const midiFileName = stem.replace('.wav', '_basic_pitch.mid');
          const midiFilePath = path.join(midiDir, midiFileName);
          const basicPitchCommand = `basic-pitch ${midiDir} ${stemFilePath}`;

          return new Promise((resolve, reject) => {
            exec(basicPitchCommand, (error, stdout, stderr) => {
              if (error) {
                console.error(`Basic Pitch error: ${error.message}`);
                reject(error);
              } else {
                console.log(`MIDI file successfully created: ${midiFileName}`);
                resolve(midiFileName);
              }
            });
          });
        });

        Promise.all(midiPromises).then(async (midiFiles) => {
          console.log('All MIDI files successfully created');

          const stemUrls = stems.map(stem => `output/stems/${stem}`);
          const midiUrls = midiFiles.map(midi => `output/midi/${midi}`);

          // Upload each stem to S3
          const uploadPromises = stems.map(stem => {
            const filePath = path.join(stemsDir, stem);
            return new Promise((resolve, reject) => {
              const getFileType = (filePath) => {
                const extension = path.extname(filePath).toLowerCase();
                switch (extension) {
                  case '.wav':
                    return 'audio/wav';
                  case '.mp3':
                    return 'audio/mpeg';
                  default:
                    return 'application/octet-stream';
                }
              };

              fs.readFile(filePath, async (err, fileContent) => {
                if (err) {
                  console.error('Error reading the file:', err);
                  reject(err);
                  return;
                }
                const file = {
                  name: path.basename(filePath), // Use the actual file name
                  type: getFileType(filePath),
                  content: fileContent,
                };
                try {
                  const uploadedUrl = await uploadSong(file);
                  console.log('File uploaded successfully:', uploadedUrl);
                  resolve(uploadedUrl);
                } catch (error) {
                  console.error('Error uploading the file:', error);
                  reject(error);
                }
              });
            });
          });

          // Wait for all uploads to finish
          const uploadedUrls = await Promise.all(uploadPromises);

          res.json({
            message: 'Stemming, MIDI conversion, and S3 upload completed',
            stems: stemUrls,
            midis: midiUrls,
            uploaded_stems: uploadedUrls.map((url, index) => ({
              name: stems[index],
              url: url
            }))
          });
        }).catch(error => {
          console.error(`MIDI conversion error: ${error.message}`);
          res.status(500).send('MIDI conversion failed');
        });

      });

    });

  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(3001, () => {
  console.log('Server started on port 3001');
});