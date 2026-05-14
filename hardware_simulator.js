const https = require('https');

/**
 * SmartGuard Hardware Simulator
 * ----------------------------
 * This script simulates the ESP32 hardware and TinyML classifier logic.
 * It sends real-time data to Firebase when the physical hardware is unavailable.
 */

// ==========================================
// CONFIGURATION
// ==========================================
const FIREBASE_HOST = "smartguard-7301e.firebaseio.com";
const FIREBASE_AUTH = ""; // Leave empty if rules are open

const SIM_INTERVAL_MS = 2000;
const WARN_THRESHOLD = 3.2;   // Amps
const CRIT_THRESHOLD = 4.2;   // Amps

// ==========================================
// STATE
// ==========================================
let readingCounter = 0;
let isLockedOut = false;
let isTamperActive = false;
let baseLoad = 1.8;
let trend = 0;
let anomalyPhase = false;
let anomalyCounter = 0;

// ==========================================
// CORE LOGIC
// ==========================================

function generateReading() {
    // Drift base load realistically
    trend += (Math.random() - 0.5) * 0.05;
    trend = Math.max(-0.5, Math.min(0.5, trend));
    baseLoad = Math.max(0.5, Math.min(4.8, baseLoad + trend * 0.1));

    // Occasional anomaly (10% chance)
    if (!anomalyPhase && Math.random() < 0.10) {
        anomalyPhase = true;
        anomalyCounter = Math.floor(Math.random() * 4) + 2;
    }

    if (anomalyPhase) {
        anomalyCounter--;
        if (anomalyCounter <= 0) anomalyPhase = false;
    }

    const currentAmps = anomalyPhase
        ? baseLoad + 1.5 + Math.random() * 1.0
        : baseLoad + (Math.random() - 0.5) * 0.4;

    const acoustic = anomalyPhase && Math.random() < 0.5;
    const tamper = Math.random() < 0.01; // Very rare random tamper

    return {
        currentAmps: Math.max(0, Math.min(5, currentAmps)),
        acoustic,
        tamper,
        timestamp: Date.now().toString()
    };
}

function classify(reading) {
    const { currentAmps, acoustic, tamper } = reading;

    if (tamper || isLockedOut) {
        if (tamper) {
            isTamperActive = true;
            isLockedOut = true;
        }
        return { label: "TAMPER", confidence: 0.99 };
    }
    
    if (acoustic && currentAmps >= WARN_THRESHOLD) {
        return { label: "Critical", confidence: 0.93 };
    }
    
    if (currentAmps >= CRIT_THRESHOLD) {
        return { label: "Critical", confidence: 0.91 };
    }
    
    if (acoustic) {
        return { label: "Warning", confidence: 0.88 };
    }
    
    if (currentAmps >= WARN_THRESHOLD) {
        return { label: "Warning", confidence: 0.87 };
    }
    
    return { label: "Healthy", confidence: 0.85 + (Math.random() * 0.1) };
}

// ==========================================
// FIREBASE COMMUNICATION (REST API)
// ==========================================

function pushToFirebase(path, data) {
    const payload = JSON.stringify(data);
    const options = {
        hostname: FIREBASE_HOST,
        port: 443,
        path: `${path}.json${FIREBASE_AUTH ? `?auth=${FIREBASE_AUTH}` : ""}`,
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            // Success
        } else {
            console.error(`[Firebase] Error: ${res.statusCode} on ${path}`);
        }
    });

    req.on('error', (e) => {
        console.error(`[Firebase] Connection Error: ${e.message}`);
    });

    req.write(payload);
    req.end();
}

// ==========================================
// MAIN LOOP
// ==========================================

console.log("\n╔══════════════════════════════════╗");
console.log("║  SmartGuard Hardware Simulator   ║");
console.log("║  Status: Running...              ║");
console.log("╚══════════════════════════════════╝\n");

setInterval(() => {
    readingCounter++;
    const reading = generateReading();
    const result = classify(reading);

    // Prepare payload
    const data = {
        timestamp: reading.timestamp,
        counter: readingCounter,
        currentAmps: Number(reading.currentAmps.toFixed(2)),
        label: result.label,
        confidence: Number(result.confidence.toFixed(3)),
        acoustic: reading.acoustic,
        tamper: reading.tamper
    };

    // 1. Push Reading
    pushToFirebase(`/readings/${reading.timestamp}`, data);

    // 2. Push Alert if anomaly
    if (result.label !== "Healthy") {
        pushToFirebase(`/alerts/${reading.timestamp}`, {
            type: result.label,
            confidence: data.confidence,
            current: data.currentAmps,
            acoustic: data.acoustic,
            tamper: data.tamper,
            timestamp: data.timestamp
        });
    }

    // 3. Update Device Status
    pushToFirebase(`/device/status`, {
        lastSeen: reading.timestamp,
        lockedOut: isLockedOut,
        tamper: isTamperActive,
        uptime: Math.floor(readingCounter * SIM_INTERVAL_MS / 1000)
    });

    // Console output for feedback
    const icon = result.label === "Healthy" ? "✅" : (result.label === "TAMPER" ? "🔒" : "⚠️");
    console.log(`[#${readingCounter.toString().padStart(4, '0')}] ${icon} ${result.label.padEnd(8)} | ${data.currentAmps.toFixed(2)}A | Conf: ${(data.confidence * 100).toFixed(1)}%`);

}, SIM_INTERVAL_MS);