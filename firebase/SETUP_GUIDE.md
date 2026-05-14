# Firebase Setup Guide — SmartGuard

## Step 1: Create a Firebase Project (Free Spark Plan)

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"**
3. Enter project name: `smartguard` (or any name you prefer)
4. Disable Google Analytics (optional) → **Create project**

---

## Step 2: Enable Realtime Database

1. In the left sidebar → **Build → Realtime Database**
2. Click **"Create database"**
3. Choose your region (e.g., `us-central1`)
4. Select **"Start in test mode"** (we'll apply proper rules next)
5. Click **"Enable"**

---

## Step 3: Get Your Project ID

- Your Project ID is shown in the **Project Settings** (gear icon → Project settings)
- It looks like: `smartguard-12345`
- Enter this into the dashboard's **Firebase Project ID** field

---

## Step 4: Apply Security Rules

1. In Realtime Database → **Rules** tab
2. Replace existing rules with the contents of `../firebase/database.rules.json`
3. Click **"Publish"**

```json
{
  "rules": {
    ".read": true,
    ".write": true,
    "readings": {
      "$readingId": {
        ".validate": "newData.hasChildren(['timestamp', 'currentAmps', 'label', 'confidence'])"
      }
    }
  }
}
```

> ⚠️ **Note**: These rules allow open read/write for simulation. For production, require authentication.

---

## Step 5: Get Database Secret (for firmware)

1. Project Settings → **Service accounts** tab
2. Scroll to **Database secrets** → **Show** → Copy the secret
3. Paste this into:
   - `firmware/smartguard_firmware.ino` → `FIREBASE_AUTH` constant
   - Dashboard "Database Secret" field (optional for dashboard)

---

## Step 6: Update Firmware

Open `firmware/smartguard_firmware.ino` and update:

```cpp
const char* FIREBASE_HOST = "smartguard-12345.firebaseio.com";  // Your project ID
const char* FIREBASE_AUTH = "your-database-secret-here";
```

---

## Step 7: Run in Wokwi

1. Open [https://wokwi.com](https://wokwi.com) → **New Project → ESP32**
2. Replace `diagram.json` with contents of `wokwi/diagram.json`
3. Create `smartguard_firmware.ino` and paste firmware contents
4. Add libraries in `libraries.txt`:
   ```
   ArduinoJson
   ```
5. Click **▶ Play** to start simulation

---

## Step 8: Open Dashboard

1. Open `dashboard/index.html` in your browser (double-click the file)
2. Enter your Firebase Project ID → Click **Connect Live →**
3. The dashboard will switch from Demo Mode to Live Mode

---

## Database Structure

```
smartguard-12345/
├── readings/
│   └── {timestamp}/
│       ├── timestamp:    "1715000000000"
│       ├── counter:      42
│       ├── currentAmps:  2.37
│       ├── label:        "Healthy"
│       ├── confidence:   0.91
│       ├── acoustic:     false
│       └── tamper:       false
├── alerts/
│   └── {timestamp}/
│       ├── type:         "Warning"
│       ├── confidence:   0.88
│       ├── current:      3.45
│       └── timestamp:    "1715000010000"
└── device/
    └── status/
        ├── lastSeen:     "1715000010000"
        ├── lockedOut:    false
        ├── tamper:       false
        └── uptime:       120
```
