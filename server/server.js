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

app.post('/upload', upload.single('file'), async (req, res) => {
  const inputFilePath = req.file.path;

  try {
    console.log('Received file upload');

    // Define the output directory
    const outputDir = path.join(__dirname, 'output');

    // Execute demucs command
    const demucsCommand = `demucs -o ${outputDir} ${inputFilePath}`;
    exec(demucsCommand, async (error, stdout, stderr) => {
      if (error) {
        console.error(`Demucs error: ${error.message}`);
        return res.status(500).send('Stemming failed');
      }

      console.log('Stems successfully created');

      // Assuming stems are stored in output/htdemucs/<input_file_name>/ directory
      const stemsPath = path.join(outputDir, 'htdemucs', path.basename(inputFilePath, path.extname(inputFilePath)));
      if (!fs.existsSync(stemsPath)) {
        console.error(`Stems path does not exist: ${stemsPath}`);
        return res.status(500).send('Stemming directory missing');
      }

      const stems = fs.readdirSync(stemsPath).filter(file => file.endsWith('.wav'));

      const uploadPromises = stems.map(stem => {
        const filePath = path.join(stemsPath, stem);
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
              name: path.basename(filePath),
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

      const uploadedUrls = await Promise.all(uploadPromises);

      res.json({
        message: 'Stemming and S3 upload completed',
        stems: uploadedUrls
      });
    });

  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).send('Internal Server Error');
  } finally {
    // Clean up the local file
    if (fs.existsSync(inputFilePath)) {
      fs.unlinkSync(inputFilePath);
    }
  }
});

app.listen(3001, () => {
  console.log('Server started on port 3001');
});
