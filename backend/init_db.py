import os
import sys

# Ensure backend directory is in path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from auth import SessionLocal, User, get_password_hash

def init_admin():
    db = SessionLocal()
    try:
        email = "admin@sportsmedia.com"
        password = "password123"
        existing = db.query(User).filter(User.email == email).first()
        if not existing:
            print(f"Creating user {email}...")
            hashed_pwd = get_password_hash(password)
            user = User(email=email, hashed_password=hashed_pwd)
            db.add(user)
            db.commit()
            print("Admin user created successfully.")
        else:
            print(f"User {email} already exists.")
    except Exception as e:
        print(f"Error initializing admin user: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    init_admin()
