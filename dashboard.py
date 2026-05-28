from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
import json
import os
import uvicorn

app = FastAPI(title="NetPulse Automation Core | Admin Dashboard")

# Setup templates directory
templates = Jinja2Templates(directory="templates")

STATS_FILE = "staff_stats.json"

def load_performance_data():
    """Reads the JSON stats file populated by the Discord bot."""
    if os.path.exists(STATS_FILE):
        try:
            with open(STATS_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}

@app.get("/", response_class=HTMLResponse)
async def render_dashboard(request: Request):
    staff_data = load_performance_data()
    
    # Parsing charts data structurally for Chart.js configuration
    names = []
    ticket_counts = []
    avg_ratings = []
    
    for staff_id, data in staff_data.items():
        names.append(f"Admin ({staff_id[-4:]})") # Displays last 4 digits for sleek look
        ticket_counts.append(data.get("tickets_handled", 0))
        
        # Prevent division by zero
        total_tickets = max(1, data.get("tickets_handled", 0))
        avg_stars = round(data.get("total_stars", 0) / total_tickets, 2)
        avg_ratings.append(avg_stars)

    # Simulated Live Tickets for UI demonstration (Will connect to active memory later)
    live_tickets = [
        {"channel": "ticket-mohammed", "user": "Mohammed", "status": "Claimed", "sla": "Optimal"},
        {"channel": "ticket-shadow", "user": "ShadowMC", "status": "Waiting", "sla": "Breached (3m+)"}
    ]

    return templates.TemplateResponse("index.html", {
        "request": request,
        "names": json.dumps(names),
        "ticket_counts": json.dumps(ticket_counts),
        "avg_ratings": json.dumps(avg_ratings),
        "live_tickets": live_tickets,
        "total_staff": len(staff_data)
    })

if __name__ == "__main__":
    # Runs the web server locally on port 8000
    uvicorn.run("dashboard.py:app", host="0.0.0.0", port=8000, reload=True)
