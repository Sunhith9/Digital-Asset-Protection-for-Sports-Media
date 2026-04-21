import os
import io
import uuid
import imagehash
import cv2
import csv
import json
from datetime import datetime
from PIL import Image
from typing import List
from bs4 import BeautifulSoup
import urllib.parse
import requests
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(title="Digital Asset Protection API")

# Allow CORS for local frontend testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Removed Supabase for local mock mode
ASSETS_FILE = os.path.join(os.path.dirname(__file__), "assets.json")
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "history.json")

def load_assets():
    if os.path.exists(ASSETS_FILE):
        with open(ASSETS_FILE, "r") as f:
            return json.load(f)
    return []

def save_assets(assets):
    with open(ASSETS_FILE, "w") as f:
        json.dump(assets, f, indent=2)

def load_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    return []

def save_history(history):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

def get_supabase_headers(authorization: str = Header(None)):
    return {"Authorization": authorization}

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def get_image_hash(image_bytes: bytes) -> str:
    """Calculates the perceptual hash of an image."""
    img = Image.open(io.BytesIO(image_bytes))
    return str(imagehash.phash(img))

def process_video(video_path: str, fps_extract=1):
    """
    Extracts frames from a video and calculates their perceptual hashes.
    fps_extract: target frames per second to extract.
    """
    hashes = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise Exception("Failed to open video file")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0 or fps != fps: # Handle 0 or NaN
        fps = 30
        
    frame_interval = int(fps / fps_extract)
    if frame_interval <= 0:
        frame_interval = 1

    frame_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        if frame_count % frame_interval == 0:
            # OpenCV uses BGR, Pillow uses RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(frame_rgb)
            hashes.append(str(imagehash.phash(img)))
            
        frame_count += 1

    cap.release()
    return hashes

def calculate_hamming_distance(hash1: str, hash2: str) -> int:
    """Calculates the Hamming distance between two hex hashes (as strings)."""
    h1 = imagehash.hex_to_hash(hash1)
    h2 = imagehash.hex_to_hash(hash2)
    return int(h1 - h2)

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "supabase_configured": False}

@app.post("/api/upload")
async def upload_asset(files: List[UploadFile] = File(...)):
    """Uploads authentic assets to the database."""
    uploaded_assets = []
    assets = load_assets()
    
    for file in files:
        file_ext = os.path.splitext(file.filename)[1].lower()
        is_video = file_ext in ['.mp4', '.avi', '.mov', '.mkv']
        media_type = 'video' if is_video else 'image'
        
        file_id = str(uuid.uuid4())
        save_filename = f"{file_id}{file_ext}"
        file_path = os.path.join(UPLOAD_DIR, save_filename)
        
        # Save file locally
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
            
        try:
            # Create thumbnail
            thumbnail_url = None
            if not is_video:
                thumb_filename = f"{file_id}_thumb.jpg"
                thumb_path = os.path.join(UPLOAD_DIR, thumb_filename)
                img = Image.open(io.BytesIO(contents))
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                img.thumbnail((300, 300))
                img.save(thumb_path, format="JPEG")
                thumbnail_url = f"/api/uploads/{thumb_filename}"
                
            # Calculate hashes
            if is_video:
                hashes = process_video(file_path)
            else:
                hashes = [get_image_hash(contents)]
                
            # Create record
            asset_record = {
                "id": file_id,
                "filename": file.filename,
                "media_type": media_type,
                "hashes": hashes,
                "file_path": file_path,
                "thumbnail_url": thumbnail_url,
                "created_at": datetime.now().isoformat()
            }
            
            assets.append(asset_record)
            uploaded_assets.append(asset_record)
            
        except Exception as e:
            # Cleanup file if hash generation fails
            if os.path.exists(file_path):
                os.remove(file_path)
            print(f"Error processing {file.filename}: {e}")

    save_assets(assets)
    return {"status": "success", "assets": uploaded_assets}

@app.post("/api/scan")
async def scan_asset(file: UploadFile = File(...), threshold: int = 5):
    """Scans a suspect asset against the database to find violations."""
    file_ext = os.path.splitext(file.filename)[1].lower()
    is_video = file_ext in ['.mp4', '.avi', '.mov', '.mkv']
    
    # Save suspect file temporarily
    temp_path = os.path.join(UPLOAD_DIR, f"scan_{uuid.uuid4()}{file_ext}")
    
    contents = await file.read()
    with open(temp_path, "wb") as f:
        f.write(contents)
        
    try:
        if is_video:
            suspect_hashes = process_video(temp_path)
        else:
            suspect_hashes = [get_image_hash(contents)]
            
        # Clean up temp file
        os.remove(temp_path)
        
        registered_assets = load_assets()
        
        matches = []
        for asset in registered_assets:
            asset_hashes = asset.get('hashes', [])
            
            # Simple matching logic: 
            # If any hash in the suspect matches any hash in the registered asset 
            # within the threshold, we flag it.
            best_distance = 999
            
            for shash in suspect_hashes:
                for ahash in asset_hashes:
                    dist = calculate_hamming_distance(shash, ahash)
                    if dist < best_distance:
                        best_distance = dist
                        
            if best_distance <= threshold:
                confidence = max(0, 100 - (best_distance * 10)) # Simple confidence calc
                matches.append({
                    "asset": asset,
                    "distance": best_distance,
                    "confidence": f"{confidence}%",
                    "violation": True
                })
                
        # Sort matches by distance (ascending)
        matches.sort(key=lambda x: x['distance'])
        
        # Save to history
        scan_record = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(),
            "suspect_filename": file.filename,
            "matches_found": len(matches),
            "top_match_distance": matches[0]['distance'] if matches else None,
            "source": "Manual Upload"
        }
        history = load_history()
        history.append(scan_record)
        save_history(history)
        
        return {
            "status": "success",
            "suspect_filename": file.filename,
            "matches_found": len(matches),
            "matches": matches
        }
            
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/assets")
async def get_assets():
    """Returns all registered assets."""
    try:
        assets = load_assets()
        assets.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        return {"data": assets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history")
async def get_history():
    """Returns all scan history."""
    try:
        history = load_history()
        history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return {"data": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/export/csv")
async def export_history_csv():
    try:
        history = load_history()
        history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Timestamp", "Suspect Filename", "Matches Found", "Top Match Distance", "Source"])
        
        for row in history:
            writer.writerow([
                row.get("id", ""),
                row.get("timestamp", ""),
                row.get("suspect_filename", ""),
                row.get("matches_found", 0),
                row.get("top_match_distance", ""),
                row.get("source", "")
            ])
            
        output.seek(0)
        return StreamingResponse(
            output, 
            media_type="text/csv", 
            headers={"Content-Disposition": "attachment; filename=scan_history.csv"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: str):
    """Deletes an asset by ID."""
    try:
        assets = load_assets()
        asset_to_delete = None
        for asset in assets:
            if asset["id"] == asset_id:
                asset_to_delete = asset
                break
        
        if not asset_to_delete:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        # Delete the uploaded file
        file_path = asset_to_delete.get("file_path", "")
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
            
        # Delete the thumbnail if it exists
        thumb_url = asset_to_delete.get("thumbnail_url", "")
        if thumb_url:
            thumb_filename = thumb_url.split("/")[-1]
            thumb_path = os.path.join(UPLOAD_DIR, thumb_filename)
            if os.path.exists(thumb_path):
                os.remove(thumb_path)
        
        # Remove from assets list and save
        assets = [a for a in assets if a["id"] != asset_id]
        save_assets(assets)
        
        return {"status": "success", "message": "Asset deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def run_scrape_job(url: str, threshold: int = 5):
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
    except Exception as e:
        print(f"Scraper failed to fetch {url}: {e}")
        return

    soup = BeautifulSoup(response.text, 'html.parser')
    img_tags = soup.find_all('img')

    registered_assets = load_assets()
    if not registered_assets:
        return

    history = load_history()
    
    for img in img_tags:
        src = img.get('src')
        if not src:
            continue
            
        img_url = urllib.parse.urljoin(url, src)
        
        try:
            img_resp = requests.get(img_url, stream=True, timeout=5)
            if img_resp.status_code != 200:
                continue
                
            img_bytes = img_resp.content
            shash = get_image_hash(img_bytes)
            if not shash:
                continue
                
            best_distance = 999
            
            for asset in registered_assets:
                for ahash in asset.get('hashes', []):
                    dist = calculate_hamming_distance(shash, ahash)
                    if dist < best_distance:
                        best_distance = dist
                        
            if best_distance <= threshold:
                scan_record = {
                    "id": str(uuid.uuid4()),
                    "timestamp": datetime.now().isoformat(),
                    "suspect_filename": img_url,
                    "matches_found": 1,
                    "top_match_distance": best_distance,
                    "source": "Web Scraper"
                }
                history.append(scan_record)
                
        except Exception:
            pass
            
    # Save any new history records
    save_history(history)

class ScraperJob(BaseModel):
    url: str

@app.post("/api/scraper/jobs")
async def add_scraper_job(job: ScraperJob, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_scrape_job, job.url)
    return {"status": "success", "message": f"Scraping job started for {job.url}"}

# Mount uploads dir to serve thumbnails
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Serve frontend static files (must be last - catches all non-API routes)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
