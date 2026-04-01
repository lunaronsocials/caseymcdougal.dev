#!/usr/bin/env python3
"""
AI Audit Scraper - Find ugly contractor websites in Middle Tennessee
Outputs: business name, current URL, obvious issues (mobile broken, no SSL, 90s design)
"""

import re
import json
from urllib.parse import urljoin, urlparse

# Target niches and cities
NICHES = [
    "roofing", "hvac", "plumber", "electrician", "contractor", 
    "landscaping", "fence", "painting", "remodeling", "concrete",
    "handyman", "pressure washing", "tree service", "moving company"
]

CITIES = [
    "Nashville", "Hendersonville", "Gallatin", "Murfreesboro", 
    "Franklin", "Brentwood", "Antioch", "Madison", "Hermitage",
    "Lebanon", "Mount Juliet", "Smyrna", "Springfield", "Clarksville"
]

# Red flags for ugly sites (we'll check these manually or with basic heuristics)
RED_FLAGS = [
    "No SSL (http://)",
    "Non-responsive/mobile broken",
    "1990s/2000s aesthetics",
    "Wix/Weebly subdomain",
    "No contact form",
    "Flash elements",
    "Broken images"
]

def generate_search_queries():
    """Generate Google search queries for each niche + city combo"""
    queries = []
    for niche in NICHES:
        for city in CITIES:
            queries.append(f"{niche} {city} TN")
    return queries

def generate_fb_group_searches():
    """Generate Facebook group search URLs"""
    fb_searches = [
        "Nashville contractors",
        "Middle Tennessee roofing",
        "Tennessee HVAC",
        "Nashville small business",
        "Hendersonville business networking"
    ]
    return fb_searches

if __name__ == "__main__":
    print("=== AI Audit Scraper - Target List Generator ===")
    print(f"\nGenerated {len(NICHES) * len(CITIES)} search queries")
    print("\nSample queries (run these in Google, check results for ugly sites):")
    
    queries = generate_search_queries()
    for q in queries[:20]:  # Show first 20
        print(f"  • {q}")
    
    print(f"\n... and {len(queries) - 20} more")
    print("\n=== What to look for ===")
    for flag in RED_FLAGS:
        print(f"  ✗ {flag}")
    
    print("\n=== Output format ===")
    print(json.dumps({
        "business": "ABC Roofing",
        "url": "http://abcroofing.com",
        "issues": ["No SSL", "Mobile broken", "Wix subdomain"],
        "pitch_angle": "Mobile traffic bounces"
    }, indent=2))
    
    print("\n=== Manual workflow ===")
    print("1. Search: site:yelp.com roofing Nashville TN -> find businesses")
    print("2. Check their actual website (not Yelp page)")
    print("3. Screenshot + note red flags")
    print("4. Use AI to generate 'after' mockup")
    print("5. DM: 'Your site loses mobile customers. Here's the fix. $150 to deploy.'")