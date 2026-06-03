"""
AWS S3 configuration for FinReportAI
UAE bucket  : finreportaiuaeprivate   (eu-central-1 Frankfurt)
India bucket: finreportai-india-private (ap-south-2 Hyderabad)
"""
from __future__ import annotations

import os

import boto3
from botocore.exceptions import ClientError


# ── helpers ────────────────────────────────────────────────────────────────

def get_s3_client(country: str = "UAE"):
    region = "eu-central-1" if country.upper() == "UAE" else "ap-south-2"
    return boto3.client(
        "s3",
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=region,
    )


def get_bucket_name(country: str = "UAE") -> str:
    if country.upper() == "UAE":
        return os.getenv("AWS_S3_BUCKET_UAE", "finreportaiuaeprivate")
    return os.getenv("AWS_S3_BUCKET_INDIA", "finreportai-india-private")


# ── core operations ─────────────────────────────────────────────────────────

def upload_to_s3(
    file_bytes: bytes,
    filename: str,
    folder: str = "uploads",
    country: str = "UAE",
) -> str:
    """Upload bytes to S3 with AES-256 encryption. Returns the S3 key."""
    s3 = get_s3_client(country)
    bucket = get_bucket_name(country)
    key = f"{folder}/{filename}"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=file_bytes,
        ServerSideEncryption="AES256",
    )
    return key


def get_from_s3(key: str, country: str = "UAE") -> bytes:
    """Download object bytes from S3."""
    s3 = get_s3_client(country)
    bucket = get_bucket_name(country)
    response = s3.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def get_presigned_url(key: str, country: str = "UAE", expires: int = 3600) -> str:
    """Generate a time-limited pre-signed GET URL."""
    s3 = get_s3_client(country)
    bucket = get_bucket_name(country)
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


# ── bucket setup ────────────────────────────────────────────────────────────

_FOLDERS = [
    "uploads/",
    "reports/",
    "invoices/",
    "bank-statements/",
    "trial-balance/",
    "journal-entries/",
]


def create_bucket_folders() -> dict:
    """Create standard folder structure in both buckets (idempotent)."""
    results: dict = {}
    for country in ["UAE", "India"]:
        s3 = get_s3_client(country)
        bucket = get_bucket_name(country)
        created = []
        for folder in _FOLDERS:
            try:
                s3.put_object(
                    Bucket=bucket,
                    Key=folder,
                    Body=b"",
                    ServerSideEncryption="AES256",
                )
                created.append(folder)
            except Exception as exc:
                created.append(f"{folder} ERROR: {exc}")
        results[country] = {"bucket": bucket, "folders_created": created}
    return results


# ── connectivity test ───────────────────────────────────────────────────────

def test_aws_connection() -> dict:
    results: dict = {}
    for country in ["UAE", "India"]:
        try:
            s3 = get_s3_client(country)
            bucket = get_bucket_name(country)
            s3.head_bucket(Bucket=bucket)
            results[country] = {
                "status": "connected",
                "bucket": bucket,
                "region": "eu-central-1" if country == "UAE" else "ap-south-2",
            }
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            results[country] = {"status": "failed", "error": f"ClientError {code}: {exc}"}
        except Exception as exc:
            results[country] = {"status": "failed", "error": str(exc)}
    return results
