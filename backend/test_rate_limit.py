import requests
import time

def test_rate_limit():
    url = "http://127.0.0.1:8000/api/auth/login"
    payload = {"email": "admin@sportsmedia.com", "password": "wrongpassword"}
    
    print("Testing Rate Limit (5 per minute)...")
    for i in range(1, 11):
        try:
            start_time = time.time()
            response = requests.post(url, json=payload)
            duration = time.time() - start_time
            print(f"Request {i}: Status {response.status_code} ({duration:.2f}s)")
            if response.status_code == 429:
                print("SUCCESS: Rate limit exceeded as expected at request", i)
                return
        except Exception as e:
            print(f"Request {i} failed: {e}")
            break
            
    print("FAILURE: Rate limit was not exceeded after 10 requests.")

if __name__ == "__main__":
    test_rate_limit()
