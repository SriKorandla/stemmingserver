import boto3
import os

s3_client = boto3.client('s3')
BUCKET_NAME = 'your-s3-bucket-name'

def upload_to_s3(file_path, bucket_name, object_name=None):
    """
    Upload a file to an S3 bucket

    :param file_path: Path to file to upload
    :param bucket_name: Bucket to upload to
    :param object_name: S3 object name. If not specified, file_name is used
    :return: URL of the uploaded file
    """
    if object_name is None:
        object_name = os.path.basename(file_path)

    try:
        response = s3_client.upload_file(file_path, bucket_name, object_name)
    except Exception as e:
        print(f"Error uploading file: {e}")
        return None

    return f"https://{bucket_name}.s3.amazonaws.com/{object_name}"