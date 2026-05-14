/*
 SmartGuard Firmware v1.0
 * ESP32 Edge AI Appliance Health Monitor
 *
 * Hardware (Wokwi Simulation):
 *  GPIO 34: Potentiometer (simulates ACS712 current sensor, 0-4095 ADC)
 *   - GPIO 26: Button 1 (acoustic anomaly event trigger)
 *   - GPIO 27: Button 2 (tamper detection trigger)
 *   - GPIO 2:  Onboard LED (alarm indicator)
 *
 * Flow: Read sensors → Run TinyML classifier → Push to Firebase → Trigger alerts
 *
 * Research basis:
 *   Hoang et al. (2026): ML-based failure classification in smart plugs
 *   MDPI (2025): Energy-aware AIoT frameworks using Mixture-of-Experts
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ─────────────────────────────────────────────
// CONFIGURATION — Replace with your values
// ─────────────────────────────────────────────
const char* WIFI_SSID     = "Wokwi-GUEST";   // Wokwi built-in WiFi
const char* WIFI_PASS     = "";               // No password needed on Wokwi
const char* FIREBASE_HOST = "smartguard-7301e.firebaseio.com";
const char* FIREBASE_AUTH = "YOUR_DATABASE_SECRET";  // Firebase legacy secret or empty for open rules

// ─────────────────────────────────────────────
// PIN DEFINITIONS
// ─────────────────────────────────────────────
#define PIN_CURRENT_SENSOR  34   // ADC1 channel (potentiometer)
#define PIN_BTN_ACOUSTIC    26   // Acoustic anomaly button (active LOW)
#define PIN_BTN_TAMPER      27   // Tamper detection button (active LOW)
#define PIN_LED_ALARM       2    // Onboard LED

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
#define SAMPLE_INTERVAL_MS    2000   // Read sensors every 2 seconds
#define ADC_MAX               4095.0
#define CURRENT_MAX_AMPS      5.0    // ACS712 5A range
#define HEARTBEAT_COUNT       5      // Blink count for heartbeat

// ─────────────────────────────────────────────
// TinyML Classifier Thresholds (Edge Impulse mock)
// Based on domain knowledge from Hoang et al. (2026)
// ─────────────────────────────────────────────
#define THRESHOLD_WARN_AMPS   3.2    // Current above this = Warning
#define THRESHOLD_CRIT_AMPS   4.2    // Current above this = Critical
#define CONFIDENCE_BASE       0.85   // Base confidence when threshold not exceeded
#define CONFIDENCE_ANOMALY    0.93   // Confidence when anomaly detected

// ─────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────
bool isTamperActive   = false;
bool isLockedOut      = false;
int  readingCounter   = 0;
unsigned long lastSampleTime = 0;

// Classification result struct
struct ClassificationResult {
  String  label;       // "Healthy", "Warning", "Critical", "TAMPER"
  float   confidence;  // 0.0 – 1.0
  float   currentAmps;
  bool    acousticEvent;
  bool    tamperEvent;
};

// ─────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n╔══════════════════════════════════╗");
  Serial.println("║  SmartGuard v1.0 — Booting...    ║");
  Serial.println("╚══════════════════════════════════╝");

  // Pin modes
  pinMode(PIN_BTN_ACOUSTIC, INPUT_PULLUP);
  pinMode(PIN_BTN_TAMPER,   INPUT_PULLUP);
  pinMode(PIN_LED_ALARM,    OUTPUT);
  digitalWrite(PIN_LED_ALARM, LOW);

  // Configure ADC — per-pin attenuation for GPIO 34 (ADC1_CH6)
  analogReadResolution(12);                                   // 12-bit: 0–4095
  analogSetPinAttenuation(PIN_CURRENT_SENSOR, ADC_11db);     // Full 0–3.3V range on sensor pin only

  // Connect WiFi
  connectWiFi();
}

// ─────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    readingCounter++;

    // 1. Read sensors
    ClassificationResult result = readAndClassify();

    // 2. Print to Serial Monitor
    printResult(result, readingCounter);

    // 3. Handle LED alarm
    handleAlarmLED(result);

    // 4. Push to Firebase
    pushToFirebase(result, readingCounter);
  }

  // Small delay to prevent watchdog reset
  delay(10);
}

// ─────────────────────────────────────────────
// SENSOR READING + TinyML CLASSIFIER
// ─────────────────────────────────────────────
ClassificationResult readAndClassify() {
  ClassificationResult result;

  // --- Read Current Sensor (Potentiometer → ADC) ---
  int adcRaw = analogRead(PIN_CURRENT_SENSOR);
  result.currentAmps = (adcRaw / ADC_MAX) * CURRENT_MAX_AMPS;

  // --- Read Acoustic Button (active LOW = pressed) ---
  result.acousticEvent = (digitalRead(PIN_BTN_ACOUSTIC) == LOW);

  // --- Read Tamper Button (active LOW = pressed) ---
  result.tamperEvent = (digitalRead(PIN_BTN_TAMPER) == LOW);
  if (result.tamperEvent) {
    isTamperActive = true;
    isLockedOut    = true;
  }

  // ── TinyML Mock Classifier ────────────────────────
  // Implements a lightweight rules-based model that mirrors
  // Edge Impulse classification output format.
  // Feature vector: [currentAmps, acousticEvent, tamperEvent]
  // Labels: Healthy | Warning | Critical | TAMPER

  if (result.tamperEvent || isLockedOut) {
    result.label      = "TAMPER";
    result.confidence = 0.99;
  }
  else if (result.acousticEvent && result.currentAmps >= THRESHOLD_WARN_AMPS) {
    // High current + acoustic = Critical failure signature
    result.label      = "Critical";
    result.confidence = CONFIDENCE_ANOMALY;
  }
  else if (result.currentAmps >= THRESHOLD_CRIT_AMPS) {
    result.label      = "Critical";
    result.confidence = 0.91;
  }
  else if (result.acousticEvent) {
    // Acoustic alone = Warning (possible bearing wear)
    result.label      = "Warning";
    result.confidence = 0.88;
  }
  else if (result.currentAmps >= THRESHOLD_WARN_AMPS) {
    result.label      = "Warning";
    result.confidence = 0.87;
  }
  else {
    // Normal operating envelope
    result.label      = "Healthy";
    result.confidence = CONFIDENCE_BASE + (random(0, 10) / 100.0);
  }

  return result;
}

// ─────────────────────────────────────────────
// FIREBASE PUSH (REST API)
// ─────────────────────────────────────────────
void pushToFirebase(ClassificationResult& result, int counter) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected — attempting reconnect...");
    connectWiFi();
    return;
  }

  HTTPClient http;
  String timestamp = String(millis());

  // ── Push sensor reading ───────────────────────
  String readingsURL = "https://" + String(FIREBASE_HOST) +
                       "/readings/" + timestamp + ".json?auth=" + FIREBASE_AUTH;

  JsonDocument doc;   // ArduinoJson v7: no size argument needed
  doc["timestamp"]    = timestamp;
  doc["counter"]      = counter;
  doc["currentAmps"]  = (float)(int)(result.currentAmps * 100.0f + 0.5f) / 100.0f;
  doc["label"]        = result.label;
  doc["confidence"]   = (float)(int)(result.confidence * 1000.0f + 0.5f) / 1000.0f;
  doc["acoustic"]     = result.acousticEvent;
  doc["tamper"]       = result.tamperEvent;

  String payload;
  serializeJson(doc, payload);

  http.begin(readingsURL);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.PUT(payload);

  if (httpCode > 0) {
    Serial.printf("[Firebase] Reading pushed — HTTP %d\n", httpCode);
  } else {
    Serial.printf("[Firebase] Error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();

  // ── Push alert if anomaly ─────────────────────
  if (result.label != "Healthy") {
    String alertsURL = "https://" + String(FIREBASE_HOST) +
                       "/alerts/" + timestamp + ".json?auth=" + FIREBASE_AUTH;

    JsonDocument alertDoc;   // ArduinoJson v7
    alertDoc["type"]       = result.label;
    alertDoc["confidence"] = result.confidence;
    alertDoc["current"]    = result.currentAmps;
    alertDoc["acoustic"]   = result.acousticEvent;
    alertDoc["tamper"]     = result.tamperEvent;
    alertDoc["timestamp"]  = timestamp;

    String alertPayload;
    serializeJson(alertDoc, alertPayload);

    http.begin(alertsURL);
    http.addHeader("Content-Type", "application/json");
    http.PUT(alertPayload);
    http.end();
  }

  // ── Update device status ──────────────────────
  String statusURL = "https://" + String(FIREBASE_HOST) +
                     "/device/status.json?auth=" + FIREBASE_AUTH;

  JsonDocument statusDoc;   // ArduinoJson v7
  statusDoc["lastSeen"]   = timestamp;
  statusDoc["lockedOut"]  = isLockedOut;
  statusDoc["tamper"]     = isTamperActive;
  statusDoc["uptime"]     = millis() / 1000;

  String statusPayload;
  serializeJson(statusDoc, statusPayload);

  http.begin(statusURL);
  http.addHeader("Content-Type", "application/json");
  http.PUT(statusPayload);
  http.end();
}

// ─────────────────────────────────────────────
// LED ALARM HANDLER
// ─────────────────────────────────────────────
void handleAlarmLED(ClassificationResult& result) {
  if (result.label == "TAMPER") {
    // Rapid blink for tamper
    for (int i = 0; i < 6; i++) {
      digitalWrite(PIN_LED_ALARM, HIGH); delay(100);
      digitalWrite(PIN_LED_ALARM, LOW);  delay(100);
    }
  } else if (result.label == "Critical") {
    // Double blink for critical
    for (int i = 0; i < 2; i++) {
      digitalWrite(PIN_LED_ALARM, HIGH); delay(200);
      digitalWrite(PIN_LED_ALARM, LOW);  delay(100);
    }
  } else if (result.label == "Warning") {
    // Single blink for warning
    digitalWrite(PIN_LED_ALARM, HIGH); delay(300);
    digitalWrite(PIN_LED_ALARM, LOW);
  } else {
    // Heartbeat: brief pulse for healthy
    digitalWrite(PIN_LED_ALARM, HIGH); delay(50);
    digitalWrite(PIN_LED_ALARM, LOW);
  }
}

// ─────────────────────────────────────────────
// SERIAL OUTPUT
// ─────────────────────────────────────────────
void printResult(ClassificationResult& result, int counter) {
  Serial.printf("\n[#%04d] ──────────────────────────────\n", counter);
  Serial.printf("  Current:    %.2f A\n",  result.currentAmps);
  Serial.printf("  Acoustic:   %s\n",       result.acousticEvent ? "YES" : "no");
  Serial.printf("  Tamper:     %s\n",       result.tamperEvent   ? "⚠ ALERT!" : "no");
  Serial.printf("  Label:      %s\n",       result.label.c_str());
  Serial.printf("  Confidence: %.1f%%\n",   result.confidence * 100.0);
  Serial.printf("  Locked Out: %s\n",       isLockedOut ? "YES" : "no");
}

// ─────────────────────────────────────────────
// WIFI CONNECT
// ─────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed — running in offline mode");
  }
}
