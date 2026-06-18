from flask import Flask, render_template
from flask_socketio import SocketIO, emit 
from datetime import datetime
import random
import math

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

users = {}  # user_id -> {user_id, lat, lng, color, timestamp}
infection_timers = {}  # target_id -> {source_id: seconds}


def distance_meters(lat1, lon1, lat2, lon2):
    R = 6371e3
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


@app.route("/")
def index():
    return render_template("index.html")


@socketio.on("update_location")
def handle_update_location(data):
    global users, infection_timers

    user_id = data["user_id"]
    lat = data["lat"]
    lng = data["lng"]
    color = data["color"]

    users[user_id] = {
        "user_id": user_id,
        "lat": lat,
        "lng": lng,
        "color": color,
        "timestamp": datetime.utcnow().timestamp()
    }

    # Broadcast this user's updated position/color to everyone else
    emit("user_update", users[user_id], broadcast=True, include_self=False)

    # -------------------------
    # SERVER-SIDE INFECTION
    # -------------------------
    if user_id not in infection_timers:
        infection_timers[user_id] = {}

    # Check if this user should become red (infected)
    if users[user_id]["color"] != "red":
        for other_id, other in users.items():
            if other_id == user_id:
                continue
            if other["color"] != "red":
                continue

            dist = distance_meters(lat, lng, other["lat"], other["lng"])
            if dist < 30:
                infection_timers[user_id][other_id] = infection_timers[user_id].get(other_id, 0) + 2
            else:
                infection_timers[user_id][other_id] = 0

        # If any timer >= 10 seconds, infect this user
        if any(t >= 10 for t in infection_timers[user_id].values()):
            users[user_id]["color"] = "red"
            emit("force_red", {"user_id": user_id}, broadcast=True)
            emit("user_update", users[user_id], broadcast=True)

    # -------------------------
    # AUTO RESET (ALL RED)
    # -------------------------
    if users:
        all_red = all(u["color"] == "red" for u in users.values())
        if all_red:
            # Reset all to blue
            for u in users.values():
                u["color"] = "blue"

            # Pick new red
            new_red = random.choice(list(users.keys()))
            users[new_red]["color"] = "red"

            emit("reset_status", {"status": "reset", "new_red": new_red}, broadcast=True)
            # Broadcast updated colors
            for u in users.values():
                emit("user_update", u, broadcast=True)


@socketio.on("request_all_users")
def handle_request_all_users():
    emit("all_users", list(users.values()))


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=10000)
