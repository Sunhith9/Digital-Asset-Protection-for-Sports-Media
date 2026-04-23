import os
import io
import uuid
import imagehash
import cv2
import csv
import json
from datetime import datetime
from PIL import Image
from typing import List, Optional
from bs4 import BeautifulSoup
import urllib.parse
import requests
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Depends, BackgroundTasks, Request
import google.generativeai as genai
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, JSONResponse
from auth import get_current_user, User, get_db, create_access_token, verify_password, get_password_hash, ACCESS_TOKEN_EXPIRE_MINUTES
from sqlalchemy.orm import Session
from datetime import timedelta
import httpx
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables
load_dotenv()

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="Digital Asset Protection API")

# Allow CORS for local frontend testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate Limiter setup
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    response = JSONResponse(
        {"detail": "Too many requests. Please try again later."},
        status_code=429
    )
    # Explicitly set CORS headers for error responses
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

async def global_exception_handler(request: Request, exc: Exception):
    print(f"CRITICAL ERROR: {str(exc)}")
    response = JSONResponse(
        {"detail": "An internal server error occurred."},
        status_code=500
    )
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

app.add_exception_handler(RateLimitExceeded, custom_rate_limit_handler)
app.add_exception_handler(Exception, global_exception_handler)

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

def get_image_hash(image_bytes: bytes):
    """Calculates perceptual hashes of an image."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode != 'RGB':
            img = img.convert('RGB')
        return {
            "phash": str(imagehash.phash(img)),
            "dhash": str(imagehash.dhash(img)),
            "ahash": str(imagehash.average_hash(img)),
            "whash": str(imagehash.whash(img))
        }
    except Exception as e:
        print(f"Failed to generate hashes: {e}")
        return None

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
            hashes.append({
                "phash": str(imagehash.phash(img)),
                "dhash": str(imagehash.dhash(img)),
                "ahash": str(imagehash.average_hash(img)),
                "whash": str(imagehash.whash(img))
            })
            
        frame_count += 1

    cap.release()
    return hashes

def compare_hashes(shash, ahash) -> int:
    """Calculates the minimum Hamming distance across available algorithms."""
    try:
        # Legacy support (string only)
        if isinstance(shash, str) and isinstance(ahash, str):
            return int(imagehash.hex_to_hash(shash) - imagehash.hex_to_hash(ahash))
            
        # Extract phash and dhash
        sh_p = shash.get('phash') if isinstance(shash, dict) else shash
        ah_p = ahash.get('phash') if isinstance(ahash, dict) else ahash
        
        dist_p = int(imagehash.hex_to_hash(sh_p) - imagehash.hex_to_hash(ah_p))
        
        if isinstance(shash, dict) and isinstance(ahash, dict):
            dist_d = int(imagehash.hex_to_hash(shash.get('dhash', sh_p)) - imagehash.hex_to_hash(ahash.get('dhash', ah_p)))
            dist_a = int(imagehash.hex_to_hash(shash.get('ahash', sh_p)) - imagehash.hex_to_hash(ahash.get('ahash', ah_p)))
            # Return the best match across algorithms
            return min(dist_p, dist_d, dist_a)
            
        return dist_p
    except Exception:
        return 999

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "supabase_configured": False}

class UserCreate(BaseModel):
    email: str
    password: str
    
class UserLogin(BaseModel):
    email: str
    password: str

@app.post("/api/auth/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pwd = get_password_hash(user.password)
    new_user = User(email=user.email, hashed_password=hashed_pwd)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"status": "success", "message": "User registered successfully"}

@app.post("/api/auth/login")
@limiter.limit("50/minute")
def login_user(request: Request, user: UserLogin, db: Session = Depends(get_db)):
    print(f"DEBUG: Login attempt for {user.email}")
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": db_user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user": {"email": db_user.email}}

@app.get("/api/auth/me")
def read_users_me(current_user: dict = Depends(get_current_user)):
    return current_user

@app.post("/api/upload")
@limiter.limit("10/minute")
async def upload_asset(request: Request, files: List[UploadFile] = File(...), current_user: dict = Depends(get_current_user)):
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
                h = get_image_hash(contents)
                if not h:
                    raise Exception("Failed to process image features")
                hashes = [h]
                
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
            raise HTTPException(status_code=400, detail=f"Failed to process {file.filename}: {str(e)}")

    save_assets(assets)
    return {"status": "success", "assets": uploaded_assets}

@app.post("/api/scan")
async def scan_asset(file: UploadFile = File(...), threshold: int = 5, current_user: dict = Depends(get_current_user)):
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
            h = get_image_hash(contents)
            if not h:
                raise Exception("Failed to process suspect image features")
            suspect_hashes = [h]
            
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
                    dist = compare_hashes(shash, ahash)
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

@app.post("/api/ai/analyze")
async def ai_analyze(
    file: Optional[UploadFile] = File(None),
    matches_json: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    """Generates a plain-English explanation of forensic scan results using Gemini."""
    if not GEMINI_API_KEY:
        return {"status": "success", "summary": "AI Analysis is currently disabled. Please add your GEMINI_API_KEY to the .env file to enable this feature."}
        
    try:
        matches = json.loads(matches_json)
        
        # Prepare prompt
        prompt = f"""You are an expert copyright forensics AI. 
The user has scanned a suspect media file against a database of protected assets.
Here are the match results: {json.dumps(matches, indent=2)}

Please write a brief, professional, and clear 2-3 sentence summary explaining these results to the user.
If there are violations, mention the match percentage and confirm the infringement.
If there are no violations, confirm the asset appears authentic."""

        # Handle image if provided
        model = genai.GenerativeModel('gemini-pro-latest')
        
        if file:
            contents = await file.read()
            img = Image.open(io.BytesIO(contents))
            # Convert to RGB if needed to avoid issues with transparency
            if img.mode != 'RGB':
                img = img.convert('RGB')
            response = model.generate_content([prompt, img])
        else:
            response = model.generate_content(prompt)
            
        return {"status": "success", "summary": response.text}
    except Exception as e:
        print(f"Gemini AI Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")

class DMCARequest(BaseModel):
    suspect_filename: str
    asset_filename: str
    match_percentage: int

@app.post("/api/ai/dmca")
async def generate_dmca(
    request: DMCARequest,
    current_user: dict = Depends(get_current_user)
):
    """Generates a formal DMCA takedown notice using Gemini."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=400, detail="AI Analysis is currently disabled. Please add your GEMINI_API_KEY to the .env file.")
        
    try:
        prompt = f"""You are an expert intellectual property lawyer. 
Write a formal, complete DMCA (Digital Millennium Copyright Act) takedown notice for the following copyright infringement.
Details:
- Original Copyrighted Work: "{request.asset_filename}"
- Infringing Material: "{request.suspect_filename}"
- Forensic Match Confidence: {request.match_percentage}%

The notice MUST include all standard legal boilerplate required by the DMCA (17 U.S.C. § 512). 
Use placeholders like [Your Name/Company], [Your Address], [ISP/Host Name], [Date] for missing information.
Do not include conversational text before or after the notice, just output the legal document."""

        model = genai.GenerativeModel('gemini-pro-latest')
        response = model.generate_content(prompt)
            
        return {"status": "success", "dmca_text": response.text}
    except Exception as e:
        print(f"Gemini DMCA Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"DMCA generation failed: {str(e)}")

@app.get("/api/assets")
async def get_assets(page: int = 1, limit: int = 20, current_user: dict = Depends(get_current_user)):
    """Returns paginated registered assets."""
    try:
        if page < 1:
            page = 1
        if limit < 1:
            limit = 20
            
        assets = load_assets()
        assets.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        total = len(assets)
        total_pages = (total + limit - 1) // limit
        
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_assets = assets[start_idx:end_idx]
        
        return {
            "data": paginated_assets,
            "pagination": {
                "page": page,
                "limit": limit,
                "total_items": total,
                "total_pages": total_pages
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to load assets from database")

@app.get("/api/history")
async def get_history(current_user: dict = Depends(get_current_user)):
    """Returns all scan history."""
    try:
        history = load_history()
        history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return {"data": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/export/csv")
async def export_history_csv(current_user: dict = Depends(get_current_user)):
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
async def delete_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
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
                    dist = compare_hashes(shash, ahash)
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
@limiter.limit("5/minute")
async def add_scraper_job(request: Request, job: ScraperJob, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    background_tasks.add_task(run_scrape_job, job.url)
    return {"status": "success", "message": f"Scraping job started for {job.url}"}

# Mount uploads dir to serve thumbnails
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Serve frontend static files (must be last - catches all non-API routes)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
