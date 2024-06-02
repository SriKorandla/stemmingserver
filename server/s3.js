var axios = require('axios');
var ROOT_URL = 'https://project-api-tune-forge.onrender.com/api';

function getSignedRequest(fileName, fileType) {
  return axios.get(`${ROOT_URL}/sign-s3?file-name=${encodeURIComponent(fileName)}&file-type=${encodeURIComponent(fileType)}`);
}

function uploadFileToS3(signedRequest, file) {
  return axios.put(signedRequest, file, {
    headers: {
      'Content-Type': file.type,
    }
  });
}

async function uploadSong(file) {
  try {
    const response = await getSignedRequest(file.name, file.type);
    await uploadFileToS3(response.data.signedRequest, file.content);
    return response.data.url;
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    throw error;
  }
}

module.exports = { uploadSong };
