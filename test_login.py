from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    # Listen to console
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Page Error: {err}"))
    
    page.goto("http://localhost:8080/")

    page.fill("#auth-email", "admin@sportsmedia.com")
    page.fill("#auth-password", "password123")
    
    print("Clicking login button...")
    page.click("#auth-submit-btn")
    
    time.sleep(2)
    
    browser.close()
