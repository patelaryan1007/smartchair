/* Smart Chair — Force Sensor Only (ESP32)
   Reads an FSR every 10s.
   If value > 200 => sitting detected.
   Starts a timer at first sit.
   When sitting duration > 15s => sends alert:true.
   Sends JSON POST to backend every 10s.

   Requires: built-in WiFi + HTTPClient libraries.
*/

#include <WiFi.h>
#include <HTTPClient.h>

// ========= CONFIGURE THESE =========
const char* WIFI_SSID = "A53";
const char* WIFI_PASSWORD = "Aryan0503@";
// Example: "http://192.168.1.55:3000/update"
const char* SERVER_URL = "https://smartchair.onrender.com/update";
const char* ALERT_URL = "https://smartchair.onrender.com/alert";  // Alert endpoint URL
// ===================================

// Pins and thresholds
#define FSR_PIN 36
const int FORCE_THRESHOLD = 200;   // analog value > 200 means sitting
const unsigned long SAMPLE_INTERVAL = 10000; // 10 seconds
const unsigned long ALERT_THRESHOLD = 15000; // 15 seconds sitting triggers alert

// State variables
bool sitting = false;
unsigned long sitStartTime = 0;
unsigned long lastSample = 0;

void setup() {
  Serial.begin(115200);
  delay(200);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void sendToServer(const String &payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected; skipping POST");
    return;
  }
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  if (code > 0) {
    Serial.printf("POST %d: %s\n", code, http.getString().c_str());
  } else {
    Serial.printf("POST failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

void loop() {
  unsigned long now = millis();
  if (now - lastSample >= SAMPLE_INTERVAL) {
    lastSample = now;

    int forceVal = analogRead(FSR_PIN);
    Serial.printf("Force reading: %d\n", forceVal);

    bool isSitting = (forceVal > FORCE_THRESHOLD);
    unsigned long sittingTime = 0;
    bool alert = false;

    if (isSitting) {
      if (!sitting) {
        sitting = true;
        sitStartTime = now;
        Serial.println("🪑 Person sat down, timer started.");
      }
      sittingTime = (now - sitStartTime) / 1000; // seconds
      if (sittingTime * 1000 > ALERT_THRESHOLD) {
        // Send alert to server
        HTTPClient http;
        http.begin(ALERT_URL);
        http.addHeader("Content-Type", "application/json");
        http.POST("{}");  // Empty JSON payload since we just need to trigger the alert
        http.end();
        Serial.println("🚨 Alert sent to server - sitting too long!");
      }
    } else {
      if (sitting) {
        Serial.println("🚶 Person stood up, timer reset.");
      }
      sitting = false;
      sitStartTime = 0;
    }

    // build JSON
    String payload = "{";
    payload += "\"force_value\":" + String(forceVal);
    payload += ",\"sitting\":" + String(isSitting ? "true" : "false");
    payload += ",\"sitting_time\":" + String(sittingTime);
    payload += ",\"alert\":" + String(alert ? "true" : "false");
    payload += "}";

    Serial.println("Sending payload: " + payload);
    sendToServer(payload);
  }
}
