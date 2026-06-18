// ----------------------
// SOCKET 
// ----------------------
const socket = io();

// ----------------------
// Distance Function
// ----------------------
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = x => x * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ----------------------
// Map Setup (Satellite Mode)
// ----------------------
let map = L.map('map', {
    zoomControl: false,
    minZoom: 16,
    maxZoom: 20,
    minZoom: 14,
    maxZoom: 17,
    maxBounds: [
        [-85, -180],
        [85, 180]
    ],
    maxBoundsViscosity: 1.0
}).setView([0, 0], 18);

map.scrollWheelZoom.enable();
map.touchZoom.enable();
map.doubleClickZoom.enable();
map.boxZoom.enable();
map.keyboard.enable();

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}",
  {
    maxZoom: 20,
    attribution: "Tiles © Esri"
  }
).addTo(map);

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 20,
    opacity: 0.35
  }
).addTo(map);

let roadMask = L.tileLayer('https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png', {
    opacity: 0
}).addTo(map);

// ----------------------
// Icons
// ----------------------
const icons = {
    blue: L.divIcon({ className: 'blue-dot', iconSize: [16, 16] }),
    red: L.divIcon({ className: 'red-dot', iconSize: [16, 16] })
};

// ----------------------
// User Identity
// ----------------------
let myId = localStorage.getItem("user_id");
if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem("user_id", myId);
}

let myColor = localStorage.getItem("user_color");
if (!myColor) {
    myColor = Math.random() < 0.2 ? "red" : "blue";
    localStorage.setItem("user_color", myColor);
}

// ----------------------
// Markers
// ----------------------
let myMarker = null;
let accuracyCircle = null;
let otherMarkers = {};
let roadTimer = 0;

// Keep positions of others for local red-nearby flashing
let otherUsers = {};

// ----------------------
// Flashing System
// ----------------------
let flashing = false;
let flashState = false;
let flashInterval = null;

function startFlashing() {
    if (flashing || !accuracyCircle) return;
    flashing = true;

    flashInterval = setInterval(() => {
        flashState = !flashState;

        accuracyCircle.setStyle({
            color: flashState ? "red" : (myColor === "red" ? "red" : "#007bff"),
            fillColor: flashState ? "red" : (myColor === "red" ? "red" : "#007bff"),
            fillOpacity: flashState ? 0.3 : 0.15
        });
    }, 500);
}

function stopFlashing() {
    if (!flashing || !accuracyCircle) return;
    flashing = false;
    clearInterval(flashInterval);

    accuracyCircle.setStyle({
        color: myColor === "red" ? "red" : "#007bff",
        fillColor: myColor === "red" ? "red" : "#007bff",
        fillOpacity: 0.75
    });
}

// ----------------------
// GPS Tracking
// ----------------------
navigator.geolocation.watchPosition(
    async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (!myMarker) {
            myMarker = L.marker([lat, lng], { icon: icons[myColor] }).addTo(map);

            accuracyCircle = L.circle([lat, lng], {
                radius: 30,
                color: myColor === "red" ? "red" : "#007bff",
                fillColor: myColor === "red" ? "red" : "#007bff",
                fillOpacity: 0.15
            }).addTo(map);
        } else {
            myMarker.setLatLng([lat, lng]);
            accuracyCircle.setLatLng([lat, lng]);
        }

        map.setView([lat, lng]);

        socket.emit("update_location", {
            user_id: myId,
            lat: lat,
            lng: lng,
            color: myColor
        });
    },
    (err) => console.error(err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);

// ----------------------
// Initial fetch of all users
// ----------------------
socket.emit("request_all_users");

socket.on("all_users", (users) => {
    users.forEach(user => {
        if (user.user_id === myId) return;

        otherUsers[user.user_id] = {
            lat: user.lat,
            lng: user.lng,
            color: user.color
        };

        if (!otherMarkers[user.user_id]) {
            otherMarkers[user.user_id] = L.marker(
                [user.lat, user.lng],
                { icon: icons[user.color] }
            ).addTo(map);
        } else {
            otherMarkers[user.user_id].setLatLng([user.lat, user.lng]);
        }
    });
});

// ----------------------
// Real-time updates from server
// ----------------------
socket.on("user_update", (user) => {
    if (user.user_id === myId) return;

    otherUsers[user.user_id] = {
        lat: user.lat,
        lng: user.lng,
        color: user.color
    };

    if (!otherMarkers[user.user_id]) {
        otherMarkers[user.user_id] = L.marker(
            [user.lat, user.lng],
            { icon: icons[user.color] }
        ).addTo(map);
    } else {
        otherMarkers[user.user_id].setLatLng([user.lat, user.lng]);
        otherMarkers[user.user_id].setIcon(icons[user.color]);
    }
});

// ----------------------
// Server-side infection result
// ----------------------
socket.on("force_red", (data) => {
    if (data.user_id === myId) {
        myColor = "red";
        localStorage.setItem("user_color", "red");
        if (myMarker) myMarker.setIcon(icons.red);
        if (accuracyCircle) {
            accuracyCircle.setStyle({
                color: "red",
                fillColor: "red",
                fillOpacity: 0.15
            });
        }
    }
});

// ----------------------
// Reset event from server
// ----------------------
socket.on("reset_status", (data) => {
    if (data.status === "reset") {
        if (data.new_red === myId) {
            myColor = "red";
            localStorage.setItem("user_color", "red");
            if (myMarker) myMarker.setIcon(icons.red);
        } else {
            myColor = "blue";
            localStorage.setItem("user_color", "blue");
            if (myMarker) myMarker.setIcon(icons.blue);
        }

        roadTimer = 0;
        stopFlashing();
    }
});

// ----------------------
// Local red-nearby flashing (cosmetic)
// ----------------------
setInterval(() => {
    if (!myMarker) return;

    let redNearby = false;
    const myPos = myMarker.getLatLng();

    for (const [id, u] of Object.entries(otherUsers)) {
        if (u.color !== "red") continue;
        const dist = distanceMeters(myPos.lat, myPos.lng, u.lat, u.lng);
        if (dist < 30) {
            redNearby = true;
            break;
        }
    }

    if (redNearby) startFlashing();
    else if (roadTimer === 0) stopFlashing();
}, 2000);
