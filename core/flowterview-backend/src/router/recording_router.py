"""
Recording router for handling interview recording uploads and storage.
"""

import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from loguru import logger
import boto3
from botocore.exceptions import ClientError

from src.core.config import Config
from storage.db_manager import DatabaseManager

router = APIRouter(
    prefix="/api/v1/recordings",
    tags=["recordings"],
    responses={404: {"description": "Not found"}},
)

class CloudStorageManager:
    """Manages uploads to cloud storage providers (S3, GCS)."""
    
    def __init__(self):
        self.provider = os.getenv("CLOUD_STORAGE_PROVIDER", "s3").lower()
        self.bucket_name = os.getenv("CLOUD_STORAGE_BUCKET")
        
        if not self.bucket_name:
            logger.warning("CLOUD_STORAGE_BUCKET not configured. Files will be stored locally only.")
        else:
            logger.info(f"Cloud storage configured: {self.provider} bucket '{self.bucket_name}'")
        
        # Validate AWS credentials if using S3
        if self.provider == "s3" and self.bucket_name:
            self._validate_aws_credentials()
    
    def _validate_aws_credentials(self):
        """Validate AWS credentials and S3 access."""
        aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
        aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        aws_region = os.getenv("AWS_REGION", "us-east-1")
        
        if not aws_access_key:
            logger.error("AWS_ACCESS_KEY_ID not configured")
            return False
        if not aws_secret_key:
            logger.error("AWS_SECRET_ACCESS_KEY not configured")
            return False
            
        logger.info(f"AWS credentials configured for region: {aws_region}")
        logger.info(f"Access key ID: {aws_access_key[:8]}...")
        
        # Test boto3 import
        try:
            import boto3
            logger.info("boto3 library available")
        except ImportError:
            logger.error("boto3 not installed. Run: pip install boto3")
            return False
            
        # Test S3 connection
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                region_name=aws_region
            )
            
            # Try to list bucket contents instead of head_bucket (requires fewer permissions)
            try:
                s3_client.list_objects_v2(Bucket=self.bucket_name, MaxKeys=1)
                logger.info(f"✅ S3 bucket '{self.bucket_name}' is accessible")
                return True
            except s3_client.exceptions.NoSuchBucket:
                logger.error(f"❌ S3 bucket '{self.bucket_name}' does not exist")
                return False
            except Exception as list_error:
                logger.warning(f"⚠️ Cannot list bucket contents: {list_error}")
                
                # Try a simple put operation to test upload permissions
                try:
                    test_key = "test-connection/test.txt"
                    s3_client.put_object(
                        Bucket=self.bucket_name,
                        Key=test_key,
                        Body=b"Connection test",
                        ServerSideEncryption='AES256'
                    )
                    # Clean up test object
                    s3_client.delete_object(Bucket=self.bucket_name, Key=test_key)
                    logger.info(f"✅ S3 bucket '{self.bucket_name}' upload test successful")
                    return True
                except Exception as upload_error:
                    logger.error(f"❌ S3 upload test failed: {upload_error}")
                    logger.warning(f"🔐 Check AWS permissions for bucket '{self.bucket_name}'")
                    # Return True anyway - we'll handle upload errors gracefully
                    return True
                    
        except Exception as e:
            logger.error(f"❌ S3 credentials/bucket validation failed: {e}")
            logger.warning("🔐 Required S3 permissions: s3:ListBucket, s3:PutObject, s3:PutObjectAcl")
            return False
    
    async def upload_recording(
        self, 
        file_path: str, 
        object_key: str, 
        metadata: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Upload recording to cloud storage."""
        if not self.bucket_name:
            logger.info("Cloud storage not configured, keeping file local")
            return {
                "success": True,
                "storage_type": "local",
                "local_path": file_path,
                "message": "File stored locally (cloud storage not configured)"
            }
        
        try:
            if self.provider == "s3":
                return await self._upload_to_s3(file_path, object_key, metadata)
            elif self.provider == "gcs":
                return await self._upload_to_gcs(file_path, object_key, metadata)
            else:
                raise Exception(f"Unsupported storage provider: {self.provider}")
        except Exception as e:
            logger.error(f"Cloud storage upload failed: {e}")
            return {
                "success": False,
                "storage_type": "local",
                "local_path": file_path,
                "error": str(e),
                "message": "File stored locally (cloud upload failed)"
            }
    
    async def _upload_to_s3(self, file_path: str, object_key: str, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """Upload to AWS S3."""
        try:
            import boto3
            from botocore.exceptions import ClientError, NoCredentialsError, BotoCoreError
        except ImportError:
            raise Exception("boto3 not installed. Run: pip install boto3")
        
        # Get AWS credentials
        aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
        aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        aws_region = os.getenv("AWS_REGION", "us-east-1")
        
        if not aws_access_key or not aws_secret_key:
            raise Exception("AWS credentials not configured. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY")
        
        logger.info(f"📤 Starting S3 upload: {object_key}")
        logger.info(f"🗂️ File size: {os.path.getsize(file_path)} bytes")
        
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                region_name=aws_region
            )
            
            # Determine content type from file extension
            file_extension = object_key.split('.')[-1].lower()
            content_type = {
                'webm': 'video/webm',
                'mp4': 'video/mp4',
                'mov': 'video/quicktime'
            }.get(file_extension, 'video/webm')
            
            # Prepare ExtraArgs for upload_fileobj with streaming optimization
            extra_args = {
                'ContentType': content_type,
                'ServerSideEncryption': 'AES256',  # Enable server-side encryption
                'CacheControl': 'public, max-age=31536000',  # 1 year cache for videos
                'ContentDisposition': f'inline; filename="{object_key.split("/")[-1]}"'
            }
            
            if metadata:
                # S3 metadata keys must be lowercase and contain only alphanumeric characters and hyphens
                clean_metadata = {}
                for k, v in metadata.items():
                    clean_key = k.lower().replace('_', '-')
                    clean_metadata[clean_key] = str(v)
                extra_args['Metadata'] = clean_metadata
                logger.info(f"📋 Metadata: {clean_metadata}")
            
            def upload_sync():
                with open(file_path, 'rb') as file:
                    s3_client.upload_fileobj(
                        file, 
                        self.bucket_name, 
                        object_key, 
                        ExtraArgs=extra_args
                    )
            
            # Upload to S3 asynchronously
            logger.info("⬆️ Uploading to S3...")
            await asyncio.get_event_loop().run_in_executor(None, upload_sync)
            
            # Verify upload by checking object size
            try:
                response = s3_client.head_object(Bucket=self.bucket_name, Key=object_key)
                s3_file_size = response['ContentLength']
                local_file_size = os.path.getsize(file_path)
                
                if s3_file_size != local_file_size:
                    logger.error(f"❌ S3 upload size mismatch: local={local_file_size}, s3={s3_file_size}")
                    raise Exception(f"Upload verification failed: size mismatch (local: {local_file_size}, S3: {s3_file_size})")
                
                logger.info(f"✅ Upload verified: {s3_file_size} bytes match local file")
            except Exception as verify_error:
                logger.error(f"❌ Upload verification failed: {verify_error}")
                # Don't raise here - upload might still be valid
            
            # Store only the S3 key for CDN usage (not the full URL)
            logger.info(f"✅ Successfully uploaded to S3: {object_key}")
            
            return {
                "success": True,
                "storage_type": "s3",
                "bucket": self.bucket_name,
                "object_key": object_key,
                "url": object_key,  # Store S3 key instead of full URL for CDN
                "local_path": file_path,
                "region": aws_region,
                "content_type": content_type,
                "message": "File uploaded to S3 successfully"
            }
            
        except NoCredentialsError as e:
            error_msg = f"AWS credentials not found: {e}"
            logger.error(f"❌ {error_msg}")
            raise Exception(error_msg)
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            error_msg = e.response.get('Error', {}).get('Message', str(e))
            
            # Provide specific guidance for common permission errors
            if error_code == 'AccessDenied':
                full_error = f"S3 Access Denied - Check bucket permissions. Required: s3:PutObject, s3:PutObjectAcl on bucket '{self.bucket_name}'"
            elif error_code == 'NoSuchBucket':
                full_error = f"S3 bucket '{self.bucket_name}' does not exist or is not accessible"
            elif error_code == 'InvalidAccessKeyId':
                full_error = f"Invalid AWS Access Key ID. Check AWS_ACCESS_KEY_ID environment variable"
            elif error_code == 'SignatureDoesNotMatch':
                full_error = f"Invalid AWS Secret Key. Check AWS_SECRET_ACCESS_KEY environment variable"
            else:
                full_error = f"S3 upload failed - {error_code}: {error_msg}"
            
            logger.error(f"❌ {full_error}")
            raise Exception(full_error)
        except BotoCoreError as e:
            error_msg = f"Boto3 error: {e}"
            logger.error(f"❌ {error_msg}")
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Unexpected S3 upload error: {e}"
            logger.error(f"❌ {error_msg}")
            raise Exception(error_msg)
    
    async def _upload_to_gcs(self, file_path: str, object_key: str, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """Upload to Google Cloud Storage."""
        try:
            from google.cloud import storage
            from google.cloud.exceptions import GoogleCloudError
        except ImportError:
            raise Exception("google-cloud-storage not installed. Run: pip install google-cloud-storage")
        
        try:
            credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            if credentials_path and os.path.exists(credentials_path):
                client = storage.Client.from_service_account_json(credentials_path)
            else:
                client = storage.Client()
            
            bucket = client.bucket(self.bucket_name)
            blob = bucket.blob(object_key)
            
            if metadata:
                blob.metadata = {k: str(v) for k, v in metadata.items()}
            
            def upload_sync():
                with open(file_path, 'rb') as file:
                    blob.upload_from_file(file, content_type='video/webm')
            
            await asyncio.get_event_loop().run_in_executor(None, upload_sync)
            
            object_url = f"https://storage.googleapis.com/{self.bucket_name}/{object_key}"
            logger.info(f"Successfully uploaded to GCS: {object_url}")
            
            return {
                "success": True,
                "storage_type": "gcs",
                "bucket": self.bucket_name,
                "object_key": object_key,
                "url": object_url,
                "local_path": file_path,
                "message": "File uploaded to GCS successfully"
            }
        except GoogleCloudError as e:
            raise Exception(f"GCS upload failed: {str(e)}")
    
    def generate_object_key(self, job_id: str, candidate_id: str, timestamp: str, extension: str = "webm") -> str:
        """Generate structured object key for cloud storage."""
        now = datetime.utcnow()
        year = now.strftime("%Y")
        month = now.strftime("%m")
        return f"recordings/{year}/{month}/{job_id}/{candidate_id}/interview-{timestamp}.{extension}"


# Global storage manager instance
storage_manager = CloudStorageManager()



@router.options("/upload")
async def upload_recording_options():
    """Handle CORS preflight request for upload endpoint."""
    return JSONResponse(
        status_code=200,
        content={"message": "CORS preflight successful"},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.options("/presigned-url")
async def presigned_url_options():
    """Handle CORS preflight request for presigned URL endpoint."""
    return JSONResponse(
        status_code=200,
        content={"message": "CORS preflight successful"},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.post("/presigned-url")
async def get_presigned_upload_url(
    request: Request,
    job_id: str = Form(...),
    candidate_id: str = Form(...),
    timestamp: str = Form(...),
    file_size: int = Form(...),
    interview_type: str = Form("ai_interview"),
    round_number: int = Form(None),
    interview_id: str = Form(None),
    round_token: str = Form(None),
    content_type: str = Form("video/webm")
):
    """
    Generate pre-signed URL for direct S3 upload from client.
    For files > 100MB, uses multipart upload approach.
    """
    try:
        # Validate file size (max 5GB for production use)
        max_size = 5 * 1024 * 1024 * 1024  # 5GB - increased for longer recordings
        if file_size > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB."
            )
        
        # Use multipart upload for files larger than 100MB
        multipart_threshold = 100 * 1024 * 1024  # 100MB
        use_multipart = file_size > multipart_threshold

        # Check if S3 is configured
        if not storage_manager.bucket_name:
            raise HTTPException(
                status_code=503,
                detail="S3 storage not configured"
            )

        # Generate object key
        file_extension = "webm"  # Default to webm
        if content_type == "video/mp4":
            file_extension = "mp4"
        
        object_key = storage_manager.generate_object_key(job_id, candidate_id, timestamp, file_extension)
        
        # Generate presigned URL
        try:
            import boto3
            from botocore.exceptions import ClientError, NoCredentialsError
        except ImportError:
            raise HTTPException(status_code=500, detail="boto3 not installed")
        
        # Get AWS credentials
        aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
        aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        aws_region = os.getenv("AWS_REGION", "us-east-1")
        
        if not aws_access_key or not aws_secret_key:
            raise HTTPException(status_code=500, detail="AWS credentials not configured")
        
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                region_name=aws_region
            )
            
            # For large files, initiate multipart upload
            if use_multipart:
                logger.info(f"📦 Initiating multipart upload for large file ({file_size / (1024*1024):.1f}MB)")
                
                # Initiate multipart upload
                multipart_response = s3_client.create_multipart_upload(
                    Bucket=storage_manager.bucket_name,
                    Key=object_key,
                    ContentType=content_type,
                    ServerSideEncryption='AES256',
                    CacheControl='public, max-age=31536000',
                    ContentDisposition=f'inline; filename="{object_key.split("/")[-1]}"',
                    Metadata={
                        'optimized-for-streaming': 'true',
                        'upload-method': 'multipart-s3',
                        'content-encoding': 'identity'
                    }
                )
                
                upload_id = multipart_response['UploadId']
                
                # Calculate optimal part size (between 5MB and 100MB)
                min_part_size = 5 * 1024 * 1024  # 5MB minimum
                max_part_size = 100 * 1024 * 1024  # 100MB maximum
                num_parts = max(1, min(10000, file_size // min_part_size))  # AWS max is 10,000 parts
                part_size = min(max_part_size, max(min_part_size, file_size // num_parts))
                
                # Generate presigned URLs for each part
                presigned_parts = []
                for part_number in range(1, num_parts + 1):
                    part_url = s3_client.generate_presigned_url(
                        'upload_part',
                        Params={
                            'Bucket': storage_manager.bucket_name,
                            'Key': object_key,
                            'UploadId': upload_id,
                            'PartNumber': part_number
                        },
                        ExpiresIn=7200  # 2 hours per part for large files
                    )
                    presigned_parts.append({
                        'part_number': part_number,
                        'url': part_url
                    })
                
                response_data = {
                    "success": True,
                    "upload_type": "multipart",
                    "upload_id": upload_id,
                    "presigned_parts": presigned_parts,
                    "part_size": part_size,
                    "num_parts": num_parts,
                    "object_key": object_key,
                    "object_url": object_key,
                    "bucket": storage_manager.bucket_name,
                    "region": aws_region,
                    "content_type": content_type,
                    "expires_in": 3600,
                    "job_id": job_id,
                    "candidate_id": candidate_id,
                    "timestamp": timestamp
                }
            else:
                # Generate presigned URL for PUT operation (30 minutes expiry for smaller files)
                # Add streaming-optimized headers for seamless video playback
                presigned_url = s3_client.generate_presigned_url(
                    'put_object',
                    Params={
                        'Bucket': storage_manager.bucket_name,
                        'Key': object_key,
                        'ContentType': content_type,
                        'ServerSideEncryption': 'AES256',
                        'CacheControl': 'public, max-age=31536000',  # 1 year cache for videos
                        'ContentDisposition': f'inline; filename="{object_key.split("/")[-1]}"',
                        'Metadata': {
                            'optimized-for-streaming': 'true',
                            'upload-method': 'direct-s3',
                            'content-encoding': 'identity'
                        }
                    },
                    ExpiresIn=1800  # 30 minutes - increased for better reliability
                )
                
                response_data = {
                    "success": True,
                    "upload_type": "direct",
                    "presigned_url": presigned_url,
                    "object_key": object_key,
                    "object_url": object_key,
                    "bucket": storage_manager.bucket_name,
                    "region": aws_region,
                    "content_type": content_type,
                    "expires_in": 1800,
                    "job_id": job_id,
                    "candidate_id": candidate_id,
                    "timestamp": timestamp
                }
            
            # Store only the S3 key (not full URL) for CDN usage
            logger.info(f"📋 Generated presigned URL for: {object_key}")
            logger.info(f"🗂️ Expected file size: {file_size} bytes")
            logger.info(f"📦 Upload type: {'multipart' if use_multipart else 'direct'}")
            
            return JSONResponse(status_code=200, content=response_data)
            
        except NoCredentialsError:
            raise HTTPException(status_code=500, detail="AWS credentials not found")
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            logger.error(f"❌ AWS S3 error: {error_code}")
            raise HTTPException(status_code=500, detail=f"S3 error: {error_code}")
        except Exception as e:
            logger.error(f"❌ Error generating presigned URL: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to generate presigned URL: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Unexpected error in presigned URL generation: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/complete-multipart")
async def complete_multipart_upload(
    request: Request,
    object_key: str = Form(...),
    upload_id: str = Form(...),
    parts: str = Form(...),  # JSON string of parts [{PartNumber, ETag}]
    job_id: str = Form(...),
    candidate_id: str = Form(...),
    timestamp: str = Form(...),
    file_size: str = Form(...),
    interview_type: str = Form("ai_interview"),
    round_number: str = Form(None),
    interview_id: str = Form(None),
    round_token: str = Form(None),
    content_type: str = Form("video/webm")
):
    """
    Complete a multipart upload and store metadata.
    """
    try:
        import json
        import boto3
        from botocore.exceptions import ClientError
        
        # Parse parts JSON
        parts_list = json.loads(parts)
        
        # Get AWS credentials
        aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
        aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        aws_region = os.getenv("AWS_REGION", "us-east-1")
        
        if not aws_access_key or not aws_secret_key:
            raise HTTPException(status_code=500, detail="AWS credentials not configured")
        
        s3_client = boto3.client(
            's3',
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key,
            region_name=aws_region
        )
        
        # Complete the multipart upload
        try:
            response = s3_client.complete_multipart_upload(
                Bucket=storage_manager.bucket_name,
                Key=object_key,
                UploadId=upload_id,
                MultipartUpload={'Parts': parts_list}
            )
            
            logger.info(f"✅ Multipart upload completed: {object_key}")
            logger.info(f"📦 ETag: {response.get('ETag')}")
            
            # Store metadata in database (same as confirm-upload)
            file_size_int = int(file_size) if file_size else 0
            round_number_int = int(round_number) if round_number else None
            
            # Generate filename for database record
            file_extension = object_key.split('.')[-1] if '.' in object_key else 'webm'
            safe_filename = f"interview-recording-{job_id}-{candidate_id}-{timestamp}.{file_extension}"
            
            # Prepare metadata
            metadata = {
                "job_id": job_id,
                "candidate_id": candidate_id,
                "interview_id": interview_id,
                "interview_type": interview_type,
                "round_number": round_number_int,
                "round_token": round_token,
                "timestamp": timestamp,
                "upload_time": datetime.utcnow().isoformat(),
                "file_size": str(file_size_int),
                "content_type": content_type,
                "upload_method": "multipart_presigned_url"
            }
            
            # Store recording info in database
            db = DatabaseManager()
            
            recording_data = {
                "job_id": job_id,
                "candidate_id": candidate_id,
                "interview_id": interview_id,
                "interview_type": interview_type,
                "round_number": round_number_int,
                "round_token": round_token,
                "filename": safe_filename,
                "file_size": file_size_int,
                "storage_type": "s3",
                "cloud_url": object_key,
                "object_key": object_key,
                "local_path": None,
                "metadata": metadata,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            
            db_result = db.execute_query("interview_recordings", recording_data)
            recording_id = db_result.get('id')
            logger.info(f"✅ Recording metadata saved to database with ID: {recording_id}")
            
            return JSONResponse(status_code=200, content={
                "success": True,
                "message": "Multipart upload completed successfully",
                "database_id": recording_id,
                "object_key": object_key,
                "etag": response.get('ETag'),
                "file_size": file_size_int,
                "storage_type": "s3"
            })
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            logger.error(f"❌ Failed to complete multipart upload: {error_code}")
            
            # Try to abort the upload to clean up
            try:
                s3_client.abort_multipart_upload(
                    Bucket=storage_manager.bucket_name,
                    Key=object_key,
                    UploadId=upload_id
                )
                logger.info(f"🧹 Aborted incomplete multipart upload")
            except:
                pass
            
            raise HTTPException(status_code=500, detail=f"Failed to complete multipart upload: {error_code}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error completing multipart upload: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to complete multipart upload: {str(e)}")


@router.post("/confirm-upload")
async def confirm_upload(
    request: Request,
    object_key: str = Form(...),
    object_url: str = Form(...),  # This now contains the S3 key, not a full URL
    job_id: str = Form(...),
    candidate_id: str = Form(...),
    timestamp: str = Form(...),
    file_size: str = Form(...),  # Changed to str to handle form data
    interview_type: str = Form("ai_interview"),
    round_number: str = Form(None),  # Changed to str to handle form data
    interview_id: str = Form(None),
    round_token: str = Form(None),
    content_type: str = Form("video/mp4")
    ):
       
    try:
        # Convert string values to appropriate types
        file_size_int = int(file_size) if file_size else 0
        round_number_int = int(round_number) if round_number else None
        
        try:
            
            
            aws_access_key = Config.AWS_ACCESS_KEY_ID
            aws_secret_key = Config.AWS_SECRET_ACCESS_KEY
            aws_region = Config.AWS_REGION
            
            if aws_access_key and aws_secret_key:
                s3_client = boto3.client(
                    's3',
                    aws_access_key_id=aws_access_key,
                    aws_secret_access_key=aws_secret_key,
                    region_name=aws_region
                )
                
                # Verify file exists and get actual size
                try:
                    response = s3_client.head_object(Bucket=storage_manager.bucket_name, Key=object_key)
                    actual_file_size = response['ContentLength']
                    
                    logger.info(f"✅ S3 upload verified: {object_key}")
                    logger.info(f"📊 File size: {actual_file_size} bytes")
                    
                    # Update file_size with actual size from S3
                    file_size_int = actual_file_size
                    
                except ClientError as e:
                    if e.response['Error']['Code'] == 'NoSuchKey':
                        raise HTTPException(status_code=404, detail="File not found in S3")
                    else:
                        logger.error(f"❌ S3 verification error: {e}")
                        # Continue anyway - file might exist but we can't verify
                        
        except Exception as e:
            logger.warning(f"⚠️ Could not verify S3 upload: {e}")
            # Continue anyway - don't fail the entire operation
        
        # Generate filename for database record
        file_extension = object_key.split('.')[-1] if '.' in object_key else 'webm'
        safe_filename = f"interview-recording-{job_id}-{candidate_id}-{timestamp}.{file_extension}"
        
        # Prepare metadata
        metadata = {
            "job_id": job_id,
            "candidate_id": candidate_id,
            "interview_id": interview_id,
            "interview_type": interview_type,
            "round_number": round_number_int,
            "round_token": round_token,
            "timestamp": timestamp,
            "upload_time": datetime.utcnow().isoformat(),
            "file_size": str(file_size_int),
            "content_type": content_type,
            "upload_method": "presigned_url"
        }
        
        # Store recording info in database
        try:
            db = DatabaseManager()
            
            recording_data = {
                "job_id": job_id,
                "candidate_id": candidate_id,
                "interview_id": interview_id,
                "interview_type": interview_type,
                "round_number": round_number_int,
                "round_token": round_token,
                "filename": safe_filename,
                "file_size": file_size_int,
                "storage_type": "s3",
                "cloud_url": object_key,  # Store S3 key for CDN usage
                "object_key": object_key,
                "local_path": None,  # No local path for direct S3 uploads
                "metadata": metadata,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            
            logger.info(f"💾 Storing S3 upload metadata to database:")
            logger.info(f"  📊 Storage type: s3 (direct upload)")
            logger.info(f"  🔗 S3 Key: {object_key}")  # Store S3 key for CDN
            logger.info(f"  🔑 Object key: {object_key}")
            logger.info(f"  📏 File size: {file_size_int} bytes")
            
            # Insert into database
            db_result = db.execute_query("interview_recordings", recording_data)
            recording_id = db_result.get('id')
            logger.info(f"✅ Recording metadata saved to database with ID: {recording_id}")
            
            response_data = {
                "success": True,
                "message": "Upload confirmed and metadata stored",
                "database_id": recording_id,
                "object_key": object_key,
                "object_url": object_url,
                "file_size": file_size_int,
                "storage_type": "s3"
            }
            
            return JSONResponse(status_code=200, content=response_data)
            
        except Exception as db_error:
            logger.error(f"❌ Failed to save recording metadata to database: {db_error}")
            raise HTTPException(
                status_code=500, 
                detail=f"Upload successful but failed to store metadata: {str(db_error)}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error confirming upload: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to confirm upload: {str(e)}")


@router.options("/confirm-upload")
async def confirm_upload_options():
    """Handle CORS preflight request for confirm upload endpoint."""
    return JSONResponse(
        status_code=200,
        content={"message": "CORS preflight successful"},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.post("/upload")
async def upload_recording(
    request: Request,
    recording: UploadFile = File(...),
    job_id: str = Form(...),
    candidate_id: str = Form(...),
    timestamp: str = Form(...),
    interview_type: str = Form("ai_interview"),
    round_number: int = Form(None),
    interview_id: str = Form(None),
    round_token: str = Form(None)
):
    """
    Upload interview recording and store it in cloud storage.
    Optimized for 30-45 minute recordings with compressed quality.
    """
    try:
        # Validate file type
        if not recording.content_type or not recording.content_type.startswith(('video/webm', 'video/mp4')):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Only WebM and MP4 video files are supported."
            )
        
        # Validate file size (max 2GB for 45min recording)
        max_size = 2 * 1024 * 1024 * 1024  # 2GB
        if recording.size and recording.size > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB."
            )
        
        # Create recordings directory
        recordings_dir = "recordings"
        os.makedirs(recordings_dir, exist_ok=True)
        
        # Generate filename
        file_extension = recording.filename.split('.')[-1] if recording.filename and '.' in recording.filename else 'webm'
        safe_filename = f"interview-recording-{job_id}-{candidate_id}-{timestamp}.{file_extension}"
        local_file_path = os.path.join(recordings_dir, safe_filename)
        
        # Save file locally first
        logger.info(f"Saving recording to: {local_file_path}")
        content = await recording.read()
        
        with open(local_file_path, "wb") as buffer:
            buffer.write(content)
        
        file_size = len(content)
        logger.info(f"Recording saved locally: {safe_filename} ({file_size} bytes)")
        
        # Prepare metadata
        metadata = {
            "job_id": job_id,
            "candidate_id": candidate_id,
            "interview_id": interview_id,
            "interview_type": interview_type,
            "round_number": round_number,
            "round_token": round_token,
            "timestamp": timestamp,
            "upload_time": datetime.utcnow().isoformat(),
            "file_size": str(file_size),
            "original_filename": recording.filename or safe_filename
        }
        
        # Generate cloud storage object key
        object_key = storage_manager.generate_object_key(job_id, candidate_id, timestamp, file_extension)
        
        # Upload to cloud storage
        upload_result = await storage_manager.upload_recording(local_file_path, object_key, metadata)
        
        # Store recording info in database using DatabaseManager
        try:
            # Create a new DatabaseManager instance for this request
            db = DatabaseManager()
            
            recording_data = {
                "job_id": job_id,
                "candidate_id": candidate_id,
                "interview_id": interview_id,
                "interview_type": interview_type,
                "round_number": round_number,
                "round_token": round_token,
                "filename": safe_filename,
                "file_size": file_size,
                "storage_type": upload_result.get("storage_type", "local"),
                "cloud_url": object_key if upload_result.get("success") else None,  # Store S3 key for CDN
                "object_key": object_key if upload_result.get("success") else None,
                "local_path": local_file_path,
                "metadata": metadata,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            
            logger.info(f"💾 Storing recording metadata to database:")
            logger.info(f"  📊 Storage type: {recording_data['storage_type']}")
            logger.info(f"  🔗 Cloud URL: {recording_data['cloud_url']}")
            logger.info(f"  🔑 Object key: {recording_data['object_key']}")
            
            # Insert into database
            db_result = db.execute_query("interview_recordings", recording_data)
            logger.info(f"✅ Recording metadata saved to database with ID: {db_result.get('id')}")
            
            # Verify the database entry was created
            if db_result and db_result.get('id'):
                verification = db.fetch_one("interview_recordings", {"id": db_result.get('id')})
                if verification:
                    logger.info(f"🔍 Database verification successful:")
                    logger.info(f"  📋 Record found with cloud_url: {verification.get('cloud_url')}")
                    logger.info(f"  📋 Storage type: {verification.get('storage_type')}")
                else:
                    logger.warning("⚠️ Database verification failed - record not found after insert")
            
        except Exception as db_error:
            logger.error(f"❌ Failed to save recording metadata to database: {db_error}")
            logger.error(f"📋 Recording data that failed to save: {recording_data}")
            # Continue anyway - file is still saved
            logger.warning("📝 Recording file uploaded but metadata not saved to database")
        
        # Prepare response
        response_data = {
            "success": True,
            "message": "Recording uploaded successfully",
            "filename": safe_filename,
            "file_size": file_size,
            "job_id": job_id,
            "candidate_id": candidate_id,
            "interview_id": interview_id,
            "interview_type": interview_type,
            "round_number": round_number,
            "round_token": round_token,
            "timestamp": timestamp,
            "local_path": local_file_path,
            **upload_result
        }
        
        # Add database information to response if available
        if 'db_result' in locals() and db_result:
            response_data["database"] = {
                "record_id": db_result.get('id'),
                "stored": True,
                "storage_type_in_db": recording_data.get('storage_type'),
                "cloud_url_in_db": recording_data.get('cloud_url')
            }
        else:
            response_data["database"] = {
                "stored": False,
                "error": "Failed to save to database"
            }
        
        return JSONResponse(status_code=200, content=response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading recording: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/list/{job_id}")
async def list_recordings(request: Request, job_id: str):
    """List all recordings for a specific job."""
    try:
        db = DatabaseManager()
        recordings = db.fetch_all("interview_recordings", {"job_id": job_id})
        
        logger.info(f"📋 Found {len(recordings)} recordings for job {job_id}")
        
        # cloud_url already contains the S3 key for CDN access
        # Add s3_key field for clarity
        for recording in recordings:
            if recording.get("cloud_url"):
                recording["s3_key"] = recording["cloud_url"]  # cloud_url now contains S3 key
        
        return JSONResponse(status_code=200, content={
            "success": True,
            "job_id": job_id,
            "count": len(recordings),
            "recordings": recordings
        })
        
    except Exception as e:
        logger.error(f"❌ Error listing recordings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list recordings: {str(e)}")


@router.get("/download/{recording_id}")
async def get_recording_download_url(request: Request, recording_id: str):
    """Get download URL for a specific recording."""
    try:
        db = DatabaseManager()
        recording = db.fetch_one("interview_recordings", {"id": recording_id})
        
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        
        logger.info(f"📥 Getting download info for recording {recording_id}")
        logger.info(f"📊 Storage type: {recording.get('storage_type')}")
        logger.info(f"🔗 Cloud URL: {recording.get('cloud_url', 'None')}")
        
        # Return cloud URL if available, otherwise local path info
        download_info = {
            "success": True,
            "recording_id": recording_id,
            "filename": recording["filename"],
            "file_size": recording["file_size"],
            "storage_type": recording["storage_type"],
            "job_id": recording.get("job_id"),
            "candidate_id": recording.get("candidate_id"),
            "interview_type": recording.get("interview_type"),
            "created_at": recording.get("created_at")
        }
        
        if recording.get("cloud_url"):
            download_info["download_url"] = recording["cloud_url"]
            download_info["access_type"] = "direct"
            download_info["message"] = "Direct S3 download URL available"
        else:
            download_info["local_path"] = recording.get("local_path")
            download_info["access_type"] = "local"
            download_info["message"] = "File stored locally, contact administrator for access"
        
        return JSONResponse(status_code=200, content=download_info)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting recording download URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get download URL: {str(e)}")


@router.get("/test-db-connection")
async def test_database_connection():
    """Test endpoint to verify database connectivity for recordings table"""
    try:
        db = DatabaseManager()
        
        # Test fetching all recordings
        recordings = db.fetch_all("interview_recordings", {})
        
        logger.info(f"🧪 Database test successful - found {len(recordings)} recordings")
        
        # Show some stats
        s3_recordings = [r for r in recordings if r.get('storage_type') == 's3']
        local_recordings = [r for r in recordings if r.get('storage_type') == 'local']
        with_cloud_urls = [r for r in recordings if r.get('cloud_url')]
        
        return JSONResponse(status_code=200, content={
            "success": True,
            "message": "Database connection successful",
            "stats": {
                "total_recordings": len(recordings),
                "s3_recordings": len(s3_recordings),
                "local_recordings": len(local_recordings),
                "recordings_with_cloud_urls": len(with_cloud_urls)
            },
            "recent_recordings": recordings[-3:] if recordings else []  # Last 3 recordings
        })
        
    except Exception as e:
        logger.error(f"❌ Database test failed: {e}")
        return JSONResponse(status_code=500, content={
            "success": False,
            "message": f"Database test failed: {str(e)}"
        })


@router.get("/health-check")
async def upload_health_check():
    """Health check endpoint for upload system status and diagnostics"""
    try:
        storage_manager = CloudStorageManager()
        db = DatabaseManager()
        
        health_status = {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "components": {}
        }
        
        # Check S3 connectivity
        if storage_manager.provider == "s3" and storage_manager.bucket_name:
            try:
                s3_client = boto3.client(
                    's3',
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                    region_name=os.getenv("AWS_REGION", "us-east-1")
                )
                
                # Test S3 access
                s3_client.head_bucket(Bucket=storage_manager.bucket_name)
                
                health_status["components"]["s3"] = {
                    "status": "healthy",
                    "bucket": storage_manager.bucket_name,
                    "region": os.getenv("AWS_REGION", "us-east-1")
                }
            except ClientError as e:
                error_code = e.response['Error']['Code']
                health_status["components"]["s3"] = {
                    "status": "unhealthy",
                    "error": error_code,
                    "message": str(e)
                }
                health_status["status"] = "degraded"
        
        # Check database connectivity
        try:
            recent_recordings = db.fetch_recent("interview_recordings", limit=10)
            
            # Calculate upload statistics
            now = datetime.now(timezone.utc)
            last_hour_recordings = []
            failed_uploads = []
            
            for recording in recent_recordings:
                created_at = recording.get("created_at")
                if created_at:
                    # Parse timestamp
                    if isinstance(created_at, str):
                        rec_time = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    else:
                        rec_time = created_at
                    
                    # Check if within last hour
                    time_diff = (now - rec_time).total_seconds()
                    if time_diff <= 3600:
                        last_hour_recordings.append(recording)
                
                # Check for failed uploads
                if not recording.get("cloud_url") and recording.get("storage_type") == "s3":
                    failed_uploads.append(recording.get("id"))
            
            health_status["components"]["database"] = {
                "status": "healthy",
                "recent_recordings": len(recent_recordings),
                "last_hour_uploads": len(last_hour_recordings),
                "failed_uploads": len(failed_uploads)
            }
            
            if failed_uploads:
                health_status["components"]["database"]["failed_upload_ids"] = failed_uploads[:5]
                
        except Exception as db_error:
            health_status["components"]["database"] = {
                "status": "unhealthy",
                "error": str(db_error)
            }
            health_status["status"] = "degraded"
        
        # Check local storage if configured
        local_storage_path = os.getenv("LOCAL_RECORDING_PATH", "./recordings")
        if os.path.exists(local_storage_path):
            try:
                # Check disk space
                import shutil
                total, used, free = shutil.disk_usage(local_storage_path)
                
                health_status["components"]["local_storage"] = {
                    "status": "healthy" if free > 1024 * 1024 * 1024 else "warning",  # Warn if less than 1GB
                    "path": local_storage_path,
                    "free_space_gb": round(free / (1024 * 1024 * 1024), 2),
                    "total_space_gb": round(total / (1024 * 1024 * 1024), 2),
                    "used_percentage": round((used / total) * 100, 1)
                }
            except Exception as storage_error:
                health_status["components"]["local_storage"] = {
                    "status": "unhealthy",
                    "error": str(storage_error)
                }
        
        # Calculate overall health score
        component_statuses = [comp["status"] for comp in health_status["components"].values()]
        if all(status == "healthy" for status in component_statuses):
            health_status["status"] = "healthy"
        elif any(status == "unhealthy" for status in component_statuses):
            health_status["status"] = "unhealthy"
        else:
            health_status["status"] = "degraded"
        
        return JSONResponse(
            status_code=200 if health_status["status"] != "unhealthy" else 503,
            content=health_status
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        )


@router.post("/telemetry/upload-diagnostic")
async def receive_upload_diagnostic(request: Request):
    """Receive diagnostic telemetry from frontend upload system"""
    try:
        diagnostic_data = await request.json()
        
        # Log diagnostic data for monitoring
        event_type = diagnostic_data.get("type", "unknown")
        details = diagnostic_data.get("details", {})
        
        if event_type in ["upload_error", "buffer_overflow"]:
            logger.error(f"📊 Upload diagnostic - {event_type}: {details}")
        else:
            logger.info(f"📊 Upload diagnostic - {event_type}: {details}")
        
        # Store critical diagnostics in database if needed
        if event_type == "upload_error":
            db = DatabaseManager()
            db.insert("upload_diagnostics", {
                "timestamp": diagnostic_data.get("timestamp"),
                "session_id": diagnostic_data.get("sessionId"),
                "event_type": event_type,
                "details": details,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return JSONResponse(status_code=200, content={"received": True})
        
    except Exception as e:
        logger.error(f"Failed to process diagnostic: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


