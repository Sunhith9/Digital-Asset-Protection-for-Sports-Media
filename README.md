# Digital-Asset-Protection-for-Sports-Media

A full-stack application built with FastAPI and vanilla HTML/JS/CSS to securely upload and verify digital assets for sports media, preventing unauthorized usage using perceptual hashes.

## Getting Started

1. Set up a Python environment and install dependencies:
   ```bash
   cd backend
   pip install fastapi uvicorn imagehash opencv-python pillow httpx python-dotenv beautifulsoup4 requests python-multipart
   ```
2. Run the application:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
3. Access the dashboard from a web browser at `http://127.0.0.1:8000`.

## Features
- **Upload Assets**: Upload official media content securely for monitoring.
- **Scanner**: Automatically scans images and videos to compute a perceptual hash and verifies its authenticity against the database.
- **Batch Processing**: Upload multiple digital assets at the same time.
- **Background Scheduled Web Scraping**: Periodically scans URLs in the background and reports matches into the Scan History logs.
- **CSV Reports**: Generates downloadable `.csv` reports of any reported violations.
